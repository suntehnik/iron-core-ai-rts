import { describe, expect, it } from 'vitest';
import { GameState } from '../src/engine/GameState';
import { AIDirector } from '../src/ai/AIDirector';
import { LLMSettings } from '../src/types/agent';

const offline: LLMSettings = {
  provider: 'offline', apiKey: '', model: '', baseUrl: '',
  enemyUsesLLM: true, autonomousTactics: true, chargeEnemyToPlayer: false,
  autoSpeakResponse: false, matchCoinLimit: 40, soundMuted: true,
};

/** Deterministic Math.random for reproducible balance checks (mulberry32). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function runMatch(maxSec: number, playerScript?: (s: GameState, d: AIDirector) => void, seed = 1) {
  const original = Math.random;
  Math.random = seeded(seed);
  try {
    return simulate(maxSec, playerScript);
  } finally {
    Math.random = original;
  }
}

function simulate(maxSec: number, playerScript?: (s: GameState, d: AIDirector) => void) {
  const state = new GameState();
  const director = new AIDirector(offline, { chat() {}, proposal() {}, tactical() {}, intercept() {}, changed() {} });
  const dt = 1 / 20;
  let t = 0;
  let nextLog = 60;
  const log: string[] = [];
  while (t < maxSec && !state.gameOver) {
    state.update(dt);
    director.update(state, dt);
    playerScript?.(state, director);
    t += dt;
    if (t >= nextLog) {
      nextLog += 60;
      const p = state.teams.player.economy, e = state.teams.enemy.economy;
      log.push(`${Math.round(t)}s P: m${Math.round(p.metal)} c${Math.round(p.components)} pw${Math.round(p.powerDemand)}/${p.powerCapacity} army${state.combatCount('player')} built${p.totals.unitsBuilt} lost${p.totals.unitsLost} mine${p.miningRatePerMin}/m hq${state.baseHpPct('player')}% | E: m${Math.round(e.metal)} c${Math.round(e.components)} army${state.combatCount('enemy')} built${e.totals.unitsBuilt} lost${e.totals.unitsLost} hq${state.baseHpPct('enemy')}% design=${state.teams.enemy.design.name}`);
    }
  }
  return { state, log, t };
}

describe('headless match simulation', () => {
  it('runs a full offline match without errors and produces armies', async () => {
    const { state, log, t } = runMatch(20 * 60);
    console.log(log.join('\n'));
    console.log('ended at', Math.round(t), 's, outcome', state.gameOver);
    expect(state.teams.player.economy.totals.unitsBuilt).toBeGreaterThan(5);
    expect(state.teams.enemy.economy.totals.unitsBuilt).toBeGreaterThan(5);
    expect(state.teams.player.economy.totals.metalMined).toBeGreaterThan(500);
  });

  it('player who expands economy and adapts beats the rule-based AI more often than not', async () => {
    let wins = 0;
    for (let i = 0; i < 4; i++) {
      const { state, t } = runMatch(25 * 60, (s, d) => {
        // scripted "good player": armours up early and grows mining only once the army can hold
        // (harvesters take factory time, so greedy early mining loses the first clash)
        if (s.gameTime > 40 && s.harvesterCount('player') + s.harvestersInProduction('player') < 4 && s.combatCount('player') >= 3) {
          s.orderHarvester('player');
        }
        if (s.gameTime > 30 && s.teams.player.design.version === 1) {
          s.setDesign('player', { ...s.teams.player.design, id: 'p2', name: 'Бастион Mk-2', chassisId: 'medium_tracked', modules: ['reinforced_steel', 'autocannon_20mm', 'autocannon_20mm'], version: 2, tacticalRole: 'frontline' });
        }
        void d;
      }, i + 1);
      console.log(`match ${i}: ${state.gameOver} at ${Math.round(t)}s`);
      if (state.gameOver === 'player_won') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(3);
  });
});

describe('balance', () => {
  it('a passive player does not win against the rule-based AI', () => {
    const { state, t, log } = runMatch(20 * 60);
    console.log('PASSIVE', state.gameOver, Math.round(t), '\n' + log.slice(-4).join('\n'));
    expect(state.gameOver).not.toBe('player_won');
  });
});
