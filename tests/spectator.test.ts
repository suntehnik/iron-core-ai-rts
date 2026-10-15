import { describe, expect, it } from 'vitest';
import { AIBilling } from '../src/ai/AIBilling';
import { AIDirector, GameMode } from '../src/ai/AIDirector';
import { commanderSystem } from '../src/ai/prompts';
import { GameState } from '../src/engine/GameState';
import { LLMSettings } from '../src/types/agent';
import { Team } from '../src/types/game';

const offline: LLMSettings = {
  provider: 'offline', apiKey: '', model: '', baseUrl: '',
  enemyUsesLLM: true, autonomousTactics: true, chargeEnemyToPlayer: false,
  autoSpeakResponse: false, matchCoinLimit: 40, soundMuted: true,
};

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

function play(mode: GameMode, maxSec: number, seed: number) {
  const original = Math.random;
  Math.random = seeded(seed);
  try {
    const state = new GameState();
    const taunts: Team[] = [];
    const director = new AIDirector({ ...offline }, { chat() {}, proposal() {}, tactical() {}, intercept: (_t, _s, team) => taunts.push(team), changed() {} });
    director.setMode(mode);
    let maxPlayerHarvesters = 0;
    for (let t = 0; t < maxSec && !state.gameOver; t += 1 / 20) {
      state.update(1 / 20);
      director.update(state, 1 / 20);
      maxPlayerHarvesters = Math.max(maxPlayerHarvesters, state.harvesterCount('player') + state.harvestersInProduction('player'));
    }
    return { state, director, taunts, maxPlayerHarvesters };
  } finally {
    Math.random = original;
  }
}

describe('AI vs AI (spectator mode)', () => {
  it('two AI commanders play a full match to a winner without a human', () => {
    const { state, director, taunts, maxPlayerHarvesters } = play('spectator', 30 * 60, 1);
    expect(state.gameOver).not.toBeNull();
    expect(director.lastCall.ally).not.toBeNull();
    expect(director.lastCall.enemy).not.toBeNull();
    // both sides talk on the radio and run their own economy and designs
    expect(taunts).toContain('player');
    expect(taunts).toContain('enemy');
    expect(maxPlayerHarvesters).toBeGreaterThan(2);
    expect(state.teams.player.design.version).toBeGreaterThan(1);
    expect(state.teams.player.plan.source).not.toBe('default');
  });

  it('in the normal mode the AI never touches the player side', () => {
    const { state, director, taunts } = play('human', 120, 2);
    expect(director.lastCall.ally).toBeNull();
    expect(taunts.every(t => t === 'enemy')).toBe(true);
    expect(state.teams.player.design.version).toBe(1);
    expect(state.teams.player.plan.source).toBe('default');
  });

  it('the teal AI commander is never charged to the player, even with the enemy in the tariff', () => {
    const b = new AIBilling(40);
    b.chargeEnemyToPlayer = true;
    const wallet = b.snapshot().wallet;
    expect(b.canAfford('ally', 1e9).ok).toBe(true);
    expect(b.recordLLM('ally-1', 'ally', 'tactical', 2000, 300, 900)).toBe(0);
    const snap = b.snapshot();
    expect(snap.wallet).toBe(wallet);
    expect(snap.ally.calls).toBe(1);
  });

  it('each commander knows who it fights', () => {
    expect(commanderSystem('player', true)).toMatch(/Командор Бирюзов[\s\S]*Генерал Ржавый/);
    expect(commanderSystem('enemy', true)).toMatch(/Генерал Ржавый[\s\S]*Командор Бирюзов/);
    expect(commanderSystem('enemy', false)).toMatch(/игрок-командир/);
  });
});
