import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { extractJSONObject } from '../src/ai/llm/jsonExtract';
import { chatJSON, LLMError } from '../src/ai/llm/LLMClient';
import { AIBilling, DecisionRateLimiter } from '../src/ai/AIBilling';
import { RobotBuilder } from '../src/engine/RobotBuilder';
import { normalizeActions, normalizePlan } from '../src/ai/parsing';
import { parseCostLimitPct } from '../src/ai/prompts';
import { DEFAULT_PLAN } from '../src/engine/GameState';
import { INITIAL_PLAYER_DESIGN } from '../src/config/balance';

describe('extractJSONObject', () => {
  it('handles think blocks, fences and prose', () => {
    expect(extractJSONObject('<think>hmm {"a":0}</think>```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJSONObject('Вот ответ: {"reply":"ок {скобка}","n":2} спасибо')).toEqual({ reply: 'ок {скобка}', n: 2 });
    expect(extractJSONObject('<think>never closed')).toBeNull();
    expect(extractJSONObject('нет json')).toBeNull();
  });
});

describe('AIBilling', () => {
  it('charges a request once, never charges errors, respects the match limit', () => {
    const b = new AIBilling(2);
    const before = b.snapshot().wallet;
    const c1 = b.recordLLM('req-1', 'player', 'production', 1000, 200, 900);
    const c2 = b.recordLLM('req-1', 'player', 'production', 1000, 200, 900); // technical retry of the same result
    expect(c1).toBeGreaterThan(0);
    expect(c2).toBe(0);
    b.recordError('player', 'tactical', 500);
    const s = b.snapshot();
    expect(s.services.production.calls).toBe(1);
    expect(s.services.tactical.errors).toBe(1);
    expect(s.services.tactical.coins).toBe(0);
    expect(before - s.wallet).toBeCloseTo(c1, 5);
    expect(b.canAfford('player', 5).ok).toBe(false); // limit 2 coins per match
    expect(b.canAfford('enemy', 5).ok).toBe(true); // enemy not in the player's tariff by default
  });

  it('warns in advance when the limit runs low', () => {
    const b = new AIBilling(3);
    const warnings: string[] = [];
    b.onWarning = t => warnings.push(t);
    b.recordLLM('a', 'player', 'production', 3000, 600, 100);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('uses the same decision interval for every participant', () => {
    const l = new DecisionRateLimiter(25);
    l.mark('player', 10);
    l.mark('enemy', 10);
    expect(l.ready('player', 30)).toBe(false);
    expect(l.ready('enemy', 30)).toBe(false);
    expect(l.ready('player', 35)).toBe(true);
    expect(l.ready('enemy', 35)).toBe(true);
  });
});

describe('RobotBuilder', () => {
  it('rejects physically impossible designs and repairs them with an explanation', () => {
    const bad = { ...INITIAL_PLAYER_DESIGN, chassisId: 'light_biped' as const, modules: ['sloped_reactive', 'heavy_siege_cannon', 'sniper_railgun', 'radar_sensor'] };
    expect(RobotBuilder.calculateStats(bad).isValid).toBe(false);
    const { design, notes } = RobotBuilder.repairDesign(bad);
    expect(RobotBuilder.calculateStats(design).isValid).toBe(true);
    expect(notes.length).toBeGreaterThan(0);
  });

  it('normalizes loose model output and drops unknown parts', () => {
    const n = RobotBuilder.normalizeDesign({ name: 'Тест', chassis: 'heavy', modules: ['reinforced_steel', 'laser_of_doom', 'heavy_siege_cannon'] }, INITIAL_PLAYER_DESIGN, 'p');
    expect(n?.design.chassisId).toBe('heavy_quad');
    expect(n?.design.modules).toEqual(['reinforced_steel', 'heavy_siege_cannon']);
    expect(n?.dropped).toEqual(['laser_of_doom']);
  });

  it('heavier armour makes the robot slower (brief §4 trade-off)', () => {
    const light = RobotBuilder.calculateStats({ ...INITIAL_PLAYER_DESIGN, chassisId: 'medium_tracked', modules: ['light_composite', 'autocannon_20mm'] });
    const heavy = RobotBuilder.calculateStats({ ...INITIAL_PLAYER_DESIGN, chassisId: 'medium_tracked', modules: ['sloped_reactive', 'autocannon_20mm'] });
    expect(heavy.effectiveSpeed).toBeLessThan(light.effectiveSpeed);
    expect(heavy.hp).toBeGreaterThan(light.hp);
  });
});

describe('agent output parsing', () => {
  it('keeps only whitelisted plan values', () => {
    const p = normalizePlan({ stance: 'nuke_everything', engagementRange: 'max_range', retreatHpThreshold: 400 }, DEFAULT_PLAN, 'agent');
    expect(p.stance).toBe(DEFAULT_PLAN.stance);
    expect(p.engagementRange).toBe('max_range');
    expect(p.retreatHpThreshold).toBe(60);
  });
  it('clamps production actions', () => {
    expect(normalizeActions([{ type: 'build_harvester', count: 99 }, { type: 'launch_nukes' }, { type: 'set_batch_size', size: 0 }])).toEqual([
      { type: 'build_harvester', count: 4 },
      { type: 'set_batch_size', size: 1 },
    ]);
  });
  it('extracts the cost cap from the brief example order', () => {
    expect(parseCostLimitPct('Усиль переднюю броню и поставь дальнобойную пушку. Скоростью можно пожертвовать, но не увеличивай стоимость больше чем на четверть')).toBe(25);
    expect(parseCostLimitPct('сделай быстрее')).toBeNull();
    expect(parseCostLimitPct('стоимость не больше 30%')).toBe(30);
  });
});

describe('chatJSON against a mock OpenAI-compatible server', () => {
  let server: http.Server;
  let base = '';
  const seen: { auth?: string; body: Record<string, unknown> }[] = [];
  let failFirstWith400 = false;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', c => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        seen.push({ auth: req.headers.authorization, body });
        if (failFirstWith400 && body.response_format) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'response_format unsupported' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            model: body.model,
            choices: [{ message: { content: '<think></think>{"reply":"Есть!","plan":{"stance":"hold_center"}}' } }],
            usage: { prompt_tokens: 321, completion_tokens: 12 },
          }),
        );
      });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => server.close());

  it('sends a JSON request with thinking disabled for Qwen and parses usage', async () => {
    const res = await chatJSON(
      { provider: 'custom', apiKey: 'test-key', model: 'Qwen3.6-35B-A3B', baseUrl: base },
      { system: 'sys', user: 'u', maxTokens: 50 },
    );
    expect(res.data).toEqual({ reply: 'Есть!', plan: { stance: 'hold_center' } });
    expect(res.usage).toEqual({ tokensIn: 321, tokensOut: 12, estimated: false });
    const last = seen[seen.length - 1];
    expect(last.auth).toBe('Bearer test-key');
    expect(last.body.response_format).toEqual({ type: 'json_object' });
    expect(last.body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('retries once without optional parameters after HTTP 400', async () => {
    failFirstWith400 = true;
    const res = await chatJSON({ provider: 'custom', apiKey: '', model: 'm', baseUrl: base }, { system: 's', user: 'u', maxTokens: 20 });
    failFirstWith400 = false;
    expect(res.attempts).toBe(2);
    expect(seen[seen.length - 1].body.response_format).toBeUndefined();
  });

  it('reports unconfigured providers without a network call', async () => {
    await expect(chatJSON({ provider: 'openrouter', apiKey: '', model: 'x', baseUrl: 'https://x' }, { system: '', user: '', maxTokens: 1 })).rejects.toBeInstanceOf(LLMError);
  });
});
