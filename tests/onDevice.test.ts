import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIDirector } from '../src/ai/AIDirector';
import { chatJSON, cloudReady, LLMError } from '../src/ai/llm/LLMClient';
import { markRussian, NativeGenerateRequest, refreshNativeStatus, resolveMarked, translateReadableFields } from '../src/ai/llm/nativeBridge';
import { PROMPTS_EN } from '../src/ai/promptsEn';
import { GameState } from '../src/engine/GameState';
import { DEFAULT_SETTINGS } from '../src/game/GameController';
import { LLMSettings } from '../src/types/agent';

const device = { provider: 'device' as const, apiKey: '', model: 'apple-on-device', baseUrl: '' };
const settings: LLMSettings = { ...DEFAULT_SETTINGS, ...device, autoSpeakResponse: false, soundMuted: true };

/** Installs a fake iOS bridge: `generate` answers with `reply(req)`, translation tags the text with the target language. */
function installBridge(opts: { available?: boolean; reply?: (req: NativeGenerateRequest) => unknown; translateFails?: boolean } = {}) {
  const calls = { generate: [] as NativeGenerateRequest[], translate: [] as { texts: string[]; from: string; to: string }[] };
  const postMessage = vi.fn(async (m: { op: string } & Record<string, unknown>) => {
    if (m.op === 'status') return { available: opts.available ?? true, reason: opts.available === false ? 'appleIntelligenceNotEnabled' : undefined, translation: 'installed', contextSize: 4096 };
    if (m.op === 'translate') {
      const req = m as unknown as { texts: string[]; from: string; to: string };
      calls.translate.push(req);
      if (opts.translateFails) throw new Error('notInstalled');
      return { texts: req.texts.map(t => `[${req.to}] ${t}`) };
    }
    if (m.op === 'generate') {
      const req = m as unknown as NativeGenerateRequest;
      calls.generate.push(req);
      const out = opts.reply ? opts.reply(req) : { reply: 'Roger that', plan: { stance: 'hold_center', summary: 'hold the centre' } };
      return { text: typeof out === 'string' ? out : '```json\n' + JSON.stringify(out) + '\n```', tokensIn: 321, tokensOut: 42, estimated: false };
    }
    throw new Error(`unknown op ${m.op}`);
  });
  vi.stubGlobal('webkit', { messageHandlers: { ironcoreLLM: { postMessage } } });
  return calls;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await refreshNativeStatus(); // forget the fake model
});

describe('translation marks', () => {
  it('translate each Russian fragment once and drop the marks', async () => {
    const seen: string[][] = [];
    const out = await resolveMarked(
      [`ORDER: "${markRussian('Держите центр')}"`, `EVENTS: ${markRussian('Держите центр')}; ${markRussian('Завод атакован')}`],
      async f => (seen.push(f), f.map(x => `EN(${x})`)),
    );
    expect(seen).toEqual([['Держите центр', 'Завод атакован']]);
    expect(out).toEqual(['ORDER: "EN(Держите центр)"', 'EVENTS: EN(Держите центр); EN(Завод атакован)']);
  });

  it('fall back to the original text when translation is unavailable', async () => {
    const out = await resolveMarked([`A ${markRussian('Привет')} B`], async () => {
      throw new Error('notInstalled');
    });
    expect(out).toEqual(['A Привет B']);
  });

  it('only the readable reply fields go back to Russian', async () => {
    const data = { reply: 'Done', design: { name: 'Bastion', chassis: 'heavy_quad', modules: ['reinforced_steel'] }, plan: { stance: 'advance', summary: 'push' }, costLimitPct: 25 };
    await translateReadableFields(data, async t => t.map(x => `RU(${x})`));
    expect(data).toEqual({ reply: 'RU(Done)', design: { name: 'RU(Bastion)', chassis: 'heavy_quad', modules: ['reinforced_steel'] }, plan: { stance: 'advance', summary: 'RU(push)' }, costLimitPct: 25 });
  });
});

describe('English prompts for the on-device model', () => {
  it('carry Russian only inside translation marks', () => {
    const s = new GameState();
    for (let i = 0; i < 20 * 90; i++) s.update(1 / 20); // events, sightings, Russian model names
    const order = 'Усиль переднюю броню и поставь дальнобойную пушку';
    const prompts = [
      PROMPTS_EN.engineerSystem,
      PROMPTS_EN.engineerUser(s, order, null),
      PROMPTS_EN.engineerRepair(['Перегруз: 700 кг при допустимых 650 кг']),
      PROMPTS_EN.tacticianSystem,
      PROMPTS_EN.tacticianUser(s, order, ['Держите центр'], null),
      PROMPTS_EN.tacticianUser(s, null, [], 'Противник атакует завод!'),
      PROMPTS_EN.commanderSystem('player', true, 'Играй от обороны'),
      PROMPTS_EN.commanderUser(s, 'enemy', 'Играй от обороны'),
      PROMPTS_EN.replanSystem('enemy', false),
      PROMPTS_EN.replanUser(s, 'player', 'Тяжёлые потери', 'Играй от обороны'),
    ];
    expect(s.events.length).toBeGreaterThan(0);
    for (const p of prompts) expect(p.replace(/⟦[^⟦⟧]*⟧/g, '')).not.toMatch(/[А-Яа-яЁё]/);
  });
});

describe('chatJSON with the on-device provider', () => {
  it('is ready only when the native model is available', async () => {
    installBridge({ available: false });
    await refreshNativeStatus();
    expect(cloudReady(device)).toBe(false);
    await expect(chatJSON(device, { system: 's', user: 'u', maxTokens: 10 })).rejects.toMatchObject({ kind: 'not_configured' });
  });

  it('translates marked fragments in, readable fields out, and reports native usage', async () => {
    const calls = installBridge();
    await refreshNativeStatus();
    const res = await chatJSON(device, { system: 'You are Cobra.', user: `ORDER: "${markRussian('Держите центр')}"`, maxTokens: 120, temperature: 0.3 });
    expect(calls.generate[0]).toMatchObject({ system: 'You are Cobra.', user: 'ORDER: "[en] Держите центр"', maxTokens: 120, temperature: 0.3 });
    expect(res.data).toEqual({ reply: '[ru] Roger that', plan: { stance: 'hold_center', summary: '[ru] hold the centre' } });
    expect(res.usage).toEqual({ tokensIn: 321, tokensOut: 42, estimated: false });
    expect(res.model).toBe('apple-on-device');
  });

  it('native failures and timeouts become LLM errors', async () => {
    installBridge({ reply: () => 'I cannot help with that.' });
    await refreshNativeStatus();
    await expect(chatJSON(device, { system: 's', user: 'u', maxTokens: 10 })).rejects.toMatchObject({ kind: 'parse' });

    const postMessage = vi.fn(async (m: { op: string }) => {
      if (m.op === 'status') return { available: true, translation: 'installed' };
      if (m.op === 'generate') return new Promise(() => {}); // never answers
      throw new Error('guardrailViolation');
    });
    vi.stubGlobal('webkit', { messageHandlers: { ironcoreLLM: { postMessage } } });
    await refreshNativeStatus();
    const err = await chatJSON(device, { system: 's', user: 'u', maxTokens: 10, timeoutMs: 50 }).catch(e => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.kind).toBe('timeout');
  });
});

describe('agents on the on-device model', () => {
  it('the engineer gets English prompts with the order translated, and answers the player in Russian', async () => {
    const calls = installBridge({
      reply: () => ({ reply: 'Heavier armour, slower legs.', design: { name: 'Bastion', chassis: 'medium_tracked', modules: ['reinforced_steel', 'autocannon_20mm'], role: 'frontline' }, actions: [], costLimitPct: null, compromise: 'speed' }),
    });
    await refreshNativeStatus();
    const chat: string[] = [];
    const d = new AIDirector(settings, { chat: m => chat.push(m.text), proposal() {}, tactical() {}, intercept() {}, changed() {} });
    await d.sendEngineerOrder(new GameState(), 'Поставь броню потолще');
    expect(calls.generate[0].system).toMatch(/^You are "Bolt"/);
    expect(calls.generate[0].user).toContain('COMMANDER\'S ORDER: "[en] Поставь броню потолще"');
    expect(d.pendingProposal?.design?.name).toBe('[ru] Bastion');
    expect(chat[chat.length - 1]).toMatch(/^\[ru\] Heavier armour/);
    expect(d.lastCall.engineer?.source).toBe('llm');
  });
});
