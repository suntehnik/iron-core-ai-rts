import { describe, expect, it } from 'vitest';
import { GameState } from '../src/engine/GameState';
import { AIDirector } from '../src/ai/AIDirector';
import { LLMSettings, ProductionProposal } from '../src/types/agent';
import { RobotBuilder } from '../src/engine/RobotBuilder';
import { loadEnv } from 'vite';

// Live check against a real OpenAI-compatible endpoint from .env.local. Runs only with LLM_LIVE=1.
const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
const live = env.LLM_LIVE === '1';
const settings: LLMSettings = {
  provider: 'custom',
  apiKey: env.LLM_API_KEY || '',
  model: env.LLM_MODEL || '',
  baseUrl: env.LLM_PROXY_TARGET || '',
  enemyUsesLLM: true, autonomousTactics: true, chargeEnemyToPlayer: false,
  autoSpeakResponse: false, matchCoinLimit: 40, soundMuted: true,
};

describe.runIf(live)('live LLM agents', () => {
  it('engineer turns the brief example order into a valid design', async () => {
    const state = new GameState();
    for (let i = 0; i < 20 * 60; i++) state.update(1 / 20); // one minute of play for context
    let proposal: ProductionProposal | null = null;
    const chats: string[] = [];
    const d = new AIDirector(settings, { chat: m => chats.push(`${m.role}[${m.source}, ${m.latencyMs}ms, ${m.costCoins?.toFixed(2)}c]: ${m.text}`), proposal: p => (proposal = p), tactical() {}, intercept() {}, changed() {} });
    await d.sendEngineerOrder(state, 'Усиль переднюю броню и поставь дальнобойную пушку. Скоростью можно пожертвовать, но не увеличивай стоимость больше чем на четверть');
    console.log(chats.join('\n'));
    const p = proposal as ProductionProposal | null;
    expect(p).not.toBeNull();
    console.log('design:', JSON.stringify(p!.design), '\nwarnings:', p!.warnings, '\ndiff:', p!.stats && RobotBuilder.diff(p!.prevStats, p!.stats));
    expect(p!.source).toBe('llm');
    // Either a valid new design, or an honest "nothing fits the cost cap" without a design
    if (p!.design) expect(p!.stats?.isValid).toBe(true);
    else expect(p!.warnings.length + chats.length).toBeGreaterThan(0);
  }, 120000);

  it('tactician converts a spoken order into a plan', async () => {
    const state = new GameState();
    const chats: string[] = [];
    const d = new AIDirector(settings, { chat: m => chats.push(`${m.role}[${m.source}, ${m.latencyMs}ms]: ${m.text}`), proposal() {}, tactical() {}, intercept() {}, changed() {} });
    await d.sendTacticalOrder(state, 'Держите центр карты, бейте с дальней дистанции и отводите машины на ремонт при трети прочности');
    console.log(chats.join('\n'), '\nplan:', JSON.stringify(state.teams.player.plan));
    expect(state.teams.player.plan.stance).toBe('hold_center');
    expect(state.teams.player.plan.retreatHpThreshold).toBeGreaterThan(20);
  }, 120000);

  it('enemy commander decides with the cloud model', async () => {
    const state = new GameState();
    const taunts: string[] = [];
    const d = new AIDirector(settings, { chat() {}, proposal() {}, tactical() {}, intercept: (t, s) => taunts.push(`${s}: ${t}`), changed() {} });
    for (let i = 0; i < 20 * 40 && !d.lastCall.enemy; i++) {
      state.update(1 / 20);
      d.update(state, 1 / 20);
      await new Promise(r => setTimeout(r, 0));
    }
    for (let i = 0; i < 600 && !d.lastCall.enemy; i++) await new Promise(r => setTimeout(r, 100));
    console.log('enemy call:', d.lastCall.enemy, '\ntaunts:', taunts, '\nenemy design:', state.teams.enemy.design.name, state.teams.enemy.design.modules, '\nplan:', state.teams.enemy.plan.summaryRu);
    expect(d.lastCall.enemy?.source).toBe('llm');
    console.log('billing:', JSON.stringify(d.billing.snapshot().enemy));
  }, 120000);
});
