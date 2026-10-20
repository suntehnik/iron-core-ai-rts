import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { loadEnv } from 'vite';
import { AIDirector } from '../src/ai/AIDirector';
import { levelConfig } from '../src/config/levels';
import { GameState } from '../src/engine/GameState';
import { RobotBuilder } from '../src/engine/RobotBuilder';
import { LLMSettings, ProductionProposal } from '../src/types/agent';
import { ProductionAction, Team } from '../src/types/game';

// Live campaign check against the OpenAI-compatible endpoint from .env.local. Runs only with LLM_LIVE=1.
// CAMPAIGN_LIVE_LEVELS=3,5,6 picks the AI-vs-AI levels; CAMPAIGN_LIVE_SEC the game seconds per match;
// CAMPAIGN_LIVE_REPORT a JSON file for the full report.
const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
const live = env.LLM_LIVE === '1';
const settings: LLMSettings = {
  provider: 'custom',
  apiKey: env.LLM_API_KEY || '',
  model: env.LLM_MODEL || '',
  baseUrl: env.LLM_PROXY_TARGET || '',
  enemyUsesLLM: true, autonomousTactics: true, chargeEnemyToPlayer: false,
  autoSpeakResponse: false, matchCoinLimit: 400, soundMuted: true,
};
const levels = (env.CAMPAIGN_LIVE_LEVELS || '3,5,6').split(',').map(Number);
const matchSec = Number(env.CAMPAIGN_LIVE_SEC || 360);

const until = async (cond: () => boolean, ms = 120000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 50));
};

/** One engineer order on a level: what the model proposes and which actions it asks for. */
async function engineerOrder(level: number, order: string, prepare?: (s: GameState) => void) {
  const state = new GameState({ level: levelConfig(level) });
  state.teams.player.economy.metal = 1500;
  state.teams.player.economy.components = 400;
  for (let i = 0; i < 20 * 30; i++) state.update(1 / 20);
  prepare?.(state);
  let proposal: ProductionProposal | null = null;
  const chats: string[] = [];
  const d = new AIDirector(settings, {
    chat: m => chats.push(`${m.role}[${m.source}, ${m.latencyMs}ms]: ${m.text}`),
    proposal: p => (proposal = p),
    tactical() {},
    intercept() {},
    changed() {},
  });
  await d.sendEngineerOrder(state, order);
  const p = proposal as ProductionProposal | null;
  console.log(`\nL${level} «${order}»\n${chats.join('\n')}\nactions: ${JSON.stringify(p?.actions)}\ndesign: ${p?.design ? `${p.design.chassisId}/${p.design.modules.join('+')}` : '-'}\nwarnings: ${JSON.stringify(p?.warnings)}`);
  return { proposal: p, state };
}

describe.runIf(live)('live LLM on campaign levels', () => {
  it('the engineer uses the new mechanics: pad buildings, the crystal reserve, the laboratory', async () => {
    const turret = await engineerOrder(2, 'Поставь турель у базы');
    expect(turret.proposal?.source).toBe('llm');
    expect(turret.proposal?.actions).toContainEqual(expect.objectContaining({ type: 'build', building: 'turret' }));

    const radar = await engineerOrder(4, 'Построй радарную вышку и держи в резерве 100 кристаллов', s => (s.teams.player.economy.crystals = 40));
    expect(radar.proposal?.actions).toContainEqual(expect.objectContaining({ type: 'build', building: 'radar' }));
    expect(radar.proposal?.actions).toContainEqual({ type: 'set_crystal_reserve', amount: 100 });

    const depot = await engineerOrder(5, 'Поставь пункт приёма на передовой у центра');
    expect(depot.proposal?.actions).toContainEqual(expect.objectContaining({ type: 'build', building: 'depot' }));

    // without a laboratory on level 6: either a plasma design with the game's warning, or the model builds a lab first
    const plasma = await engineerOrder(6, 'Хочу машины с плазменными пушками', s => (s.teams.player.economy.crystals = 200));
    const p = plasma.proposal!;
    const asksLab = p.actions.some(a => a.type === 'build' && a.building === 'lab');
    const warned = p.warnings.some(w => w.includes('лаборатор'));
    expect(asksLab || warned || !p.design?.modules.includes('plasma_blasters')).toBe(true);

    // level 1 has no turrets: the action must not slip through
    const locked = await engineerOrder(1, 'Поставь турель у базы');
    for (const a of locked.proposal?.actions ?? []) {
      const text = locked.state.applyProductionAction('player', a);
      if (a.type === 'build') expect(text).toContain('Откроется на уровне');
    }
  }, 300000);

  it('LLM commanders play AI-vs-AI matches on the levels', async () => {
    const report: Record<string, unknown>[] = [];
    for (const level of levels) {
      const state = new GameState({ level: levelConfig(level), fair: false });
      const applied: Record<Team, ProductionAction[]> = { player: [], enemy: [] };
      const results: Record<Team, string[]> = { player: [], enemy: [] };
      const original = state.applyProductionAction.bind(state);
      state.applyProductionAction = (team: Team, a: ProductionAction) => {
        const text = original(team, a);
        applied[team].push(a);
        results[team].push(text);
        return text;
      };
      const taunts: string[] = [];
      const d = new AIDirector(settings, { chat() {}, proposal() {}, tactical() {}, intercept: (t, src, team) => taunts.push(`${team}/${src}: ${t}`), changed() {} });
      d.setMode('spectator');
      const waits = { player: { lab: 0, crystals: 0 }, enemy: { lab: 0, crystals: 0 } };
      const designs: Record<Team, string[]> = { player: [], enemy: [] };
      const t0 = Date.now();
      for (let sec = 0; sec < matchSec && !state.gameOver; sec++) {
        for (let k = 0; k < 10; k++) {
          state.update(0.1);
          d.update(state, 0.1);
        }
        await until(() => !d.busy.enemy && !d.busy.ally);
        for (const team of ['player', 'enemy'] as Team[]) {
          const f = state.buildings.find(b => b.team === team && b.type === 'factory');
          const status = f ? state.factoryStatus(f) : '';
          if (status === 'Нужна лаборатория') waits[team].lab++;
          if (status === 'Ждёт кристаллов') waits[team].crystals++;
          const sig = `${state.teams[team].design.chassisId}/${state.teams[team].design.modules.join('+')}`;
          if (designs[team][designs[team].length - 1] !== sig) designs[team].push(sig);
        }
      }
      const b = d.billing.snapshot();
      const entry = {
        level,
        gameSec: Math.round(state.gameTime),
        realSec: Math.round((Date.now() - t0) / 1000),
        outcome: state.gameOver,
        llm: { ally: b.ally, enemy: b.enemy },
        lastCall: d.lastCall,
        actions: applied,
        actionResults: results,
        designs,
        designValid: (['player', 'enemy'] as Team[]).map(team => RobotBuilder.calculateStats(state.teams[team].design).isValid),
        factoryWaitsSec: waits,
        padBuildings: state.buildings.filter(x => x.padId).map(x => `${x.team}:${x.type}:${Math.round(x.built * 100)}%`),
        crystals: { player: Math.round(state.teams.player.economy.totals.crystalsMined), enemy: Math.round(state.teams.enemy.economy.totals.crystalsMined) },
        hq: { player: state.baseHpPct('player'), enemy: state.baseHpPct('enemy') },
        taunts: taunts.slice(-6),
      };
      report.push(entry);
      console.log(`\n=== L${level}: ${entry.outcome ?? 'no winner'} at ${entry.gameSec}s game / ${entry.realSec}s real; calls ally ${b.ally.calls} (err ${b.ally.errors}) enemy ${b.enemy.calls} (err ${b.enemy.errors}); tokens in/out ally ${b.ally.tokensIn}/${b.ally.tokensOut} enemy ${b.enemy.tokensIn}/${b.enemy.tokensOut}`);
      console.log('designs', JSON.stringify(designs), '\nactions', JSON.stringify(applied), '\nwaits', JSON.stringify(waits), '\npads', entry.padBuildings.join(' '));
      expect(b.enemy.calls).toBeGreaterThan(0);
      expect(entry.designValid).toEqual([true, true]);
    }
    if (env.CAMPAIGN_LIVE_REPORT) writeFileSync(env.CAMPAIGN_LIVE_REPORT, JSON.stringify(report, null, 2));
  }, 3600000);
});
