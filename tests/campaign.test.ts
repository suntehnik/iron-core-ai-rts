import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIDirector } from '../src/ai/AIDirector';
import { commanderUserPrompt } from '../src/ai/prompts';
import { englishPrompts } from '../src/ai/promptsEn';
import { GAME_BALANCE, buildingSlot } from '../src/config/balance';
import { CAMPAIGN, ENDLESS_FROM, levelConfig } from '../src/config/levels';
import { GameState } from '../src/engine/GameState';
import { reachableCells } from '../src/engine/terrain/Pathfinding';
import { TERRAIN_CODE } from '../src/engine/terrain/TerrainGrid';
import { loadCampaign, recordVictory, saveCampaign } from '../src/game/Campaign';
import { GameController } from '../src/game/GameController';
import { LLMSettings } from '../src/types/agent';
import { CombatUnit, Team, Vector2D } from '../src/types/game';

const offline: LLMSettings = {
  provider: 'offline', apiKey: '', model: '', baseUrl: '',
  enemyUsesLLM: true, autonomousTactics: true, chargeEnemyToPlayer: false,
  autoSpeakResponse: false, matchCoinLimit: 40, soundMuted: true,
};
const HEAVY_RADIUS = 2.1;

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

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

function keyPoints(s: GameState): Vector2D[] {
  const pts: Vector2D[] = [];
  for (const team of ['player', 'enemy'] as Team[]) {
    const dir = team === 'player' ? 1 : -1;
    const hq = buildingSlot(team, 'command_center');
    pts.push({ x: hq.x + dir * 8, y: hq.y }, s.rallyPoint(team));
  }
  for (const p of s.resourcePatches) pts.push(p.pos);
  return pts;
}

describe('campaign levels', () => {
  it('every level map, endless ones included, connects bases and deposits for a heavy chassis', () => {
    for (let n = 1; n <= ENDLESS_FROM + 6; n++) {
      const s = new GameState({ level: levelConfig(n) });
      const pts = keyPoints(s);
      const seen = reachableCells(s.terrain, pts[0], HEAVY_RADIUS);
      for (const p of pts) {
        const { cx, cy } = s.terrain.cellOf(p);
        expect(seen[s.terrain.index(cx, cy)], `level ${n} point ${p.x},${p.y}`).toBe(1);
      }
    }
  });

  it('each level brings its own terrain feature', () => {
    const count = (n: number, code: number) => [...new GameState({ level: levelConfig(n) }).terrain.cells].filter(c => c === code).length;
    expect(count(3, TERRAIN_CODE.swamp)).toBeGreaterThan(200); // the marsh
    expect(count(4, TERRAIN_CODE.forest)).toBeGreaterThan(count(1, TERRAIN_CODE.forest) * 3); // the thicket
    expect(count(5, TERRAIN_CODE.rock)).toBeGreaterThan(30); // the gorge's ridges
  });

  it('the enemy fortress line has a single gate: closing it cuts the enemy base off', () => {
    for (const n of [5, 6]) {
      const s = new GameState({ level: levelConfig(n) });
      const gate = levelConfig(n).map.fortress!;
      const from = { x: 18, y: 30 };
      const enemyHq = { x: 82, y: 30 };
      const open = reachableCells(s.terrain, from, HEAVY_RADIUS);
      expect(open[s.terrain.index(82, 30)], `level ${n} open`).toBe(1);
      // plant trees in the gate and try again
      for (let y = Math.floor(gate.gateY - gate.gate); y <= Math.ceil(gate.gateY + gate.gate); y++) {
        for (let x = gate.x0 - 1; x <= gate.x1 + 1; x++) s.terrain.cells[s.terrain.index(x, y)] = TERRAIN_CODE.forest;
      }
      s.terrain.computeClearance();
      const closed = reachableCells(s.terrain, from, HEAVY_RADIUS);
      expect(closed[s.terrain.index(Math.floor(enemyHq.x), enemyHq.y)], `level ${n} closed`).toBe(0);
    }
  });

  it('the enemy gets the level edge: garrison, tougher HQ, income; AI vs AI keeps the sides equal', () => {
    const s = new GameState({ level: levelConfig(6) });
    const edge = levelConfig(6).enemy;
    const garrison = s.units.filter((u): u is CombatUnit => u.kind === 'combat' && u.team === 'enemy' && !!u.garrison);
    expect(edge.garrison).toBeGreaterThan(0);
    expect(garrison).toHaveLength(edge.garrison!);
    expect(edge.hqHpMul).toBeGreaterThan(1);
    expect(s.getHQ('enemy')!.maxHp).toBe(Math.round(GAME_BALANCE.COMMAND_CENTER_HP * edge.hqHpMul!));
    expect(s.getHQ('player')!.maxHp).toBe(GAME_BALANCE.COMMAND_CENTER_HP);
    expect(s.teams.enemy.economy.totals.unitsBuilt).toBe(0); // a garrison is not production
    expect(s.armySummary('enemy').combatUnits).toBe(0); // nor part of the field army

    const fair = new GameState({ level: levelConfig(6), fair: true });
    expect(fair.units.some(u => u.kind === 'combat')).toBe(false);
    expect(fair.getHQ('enemy')!.maxHp).toBe(GAME_BALANCE.COMMAND_CENTER_HP);
    expect([...fair.terrain.cells]).toEqual([...s.terrain.cells]); // the same map
  });

  it('enemy income follows the level multiplier', () => {
    const mined = (n: number) => {
      const orig = Math.random;
      Math.random = seeded(3);
      try {
        const s = new GameState({ level: levelConfig(n) });
        for (let t = 0; t < 60; t += 0.1) s.update(0.1);
        return s.teams.enemy.economy.totals.metalMined;
      } finally {
        Math.random = orig;
      }
    };
    // the same map and timing: only the multiplier differs between a 0.7 and a 1.0 copy of level 1
    const base = mined(1);
    expect(base).toBeGreaterThan(100);
    const orig = Math.random;
    Math.random = seeded(3);
    const s = new GameState({ level: { ...levelConfig(1), enemy: { ...levelConfig(1).enemy, incomeMul: 1 } } });
    for (let t = 0; t < 60; t += 0.1) s.update(0.1);
    Math.random = orig;
    expect(base / s.teams.enemy.economy.totals.metalMined).toBeCloseTo(0.7, 2);
  });

  it('the garrison guards its HQ and never joins a wave', () => {
    const orig = Math.random;
    Math.random = seeded(4);
    try {
      const s = new GameState({ level: levelConfig(5) });
      const hq = s.getHQ('enemy')!;
      s.setPlan('enemy', { ...s.teams.enemy.plan, stance: 'advance' });
      for (let t = 0; t < 90; t += 0.1) s.update(0.1);
      const garrison = s.units.filter((u): u is CombatUnit => u.kind === 'combat' && !!u.garrison);
      expect(garrison).toHaveLength(levelConfig(5).enemy.garrison!);
      for (const g of garrison) {
        expect(g.committed).toBe(false);
        // it may chase an intruder off, but stays inside the base (the waves go 40+ units out)
        expect(Math.hypot(g.pos.x - hq.pos.x, g.pos.y - hq.pos.y)).toBeLessThan(GAME_BALANCE.BASE_DEFENSE_RECALL_RADIUS);
      }
    } finally {
      Math.random = orig;
    }
  });

  it('designs outside the allowed chassis are refitted, and the rule-based general sticks to them', () => {
    const s = new GameState({ level: levelConfig(1) });
    const medium = { ...s.teams.enemy.design, chassisId: 'medium_tracked' as const, modules: ['reinforced_steel', 'autocannon_20mm', 'autocannon_20mm'] };
    const fitted = s.fitDesign('enemy', medium);
    if (fitted) expect(fitted.chassisId).toBe('light_biped');
    expect(s.fitDesign('player', medium)).toBe(medium); // the player is never restricted

    const orig = Math.random;
    Math.random = seeded(5);
    try {
      const d = new AIDirector(offline, { chat() {}, proposal() {}, tactical() {}, intercept() {}, changed() {} });
      for (let t = 0; t < 8 * 60 && !s.gameOver; t += 0.1) {
        s.update(0.1);
        d.update(s, 0.1);
        expect(s.teams.enemy.design.chassisId).toBe('light_biped');
      }
    } finally {
      Math.random = orig;
    }
  });

  it('the general gets the doctrine and the allowed chassis in its report, in both prompt languages', () => {
    const s = new GameState({ level: levelConfig(2) });
    const ru = commanderUserPrompt(s, 'enemy');
    expect(ru).toContain('ДОКТРИНА ШТАБА:');
    expect(ru).toContain('ДОСТУПНЫЕ ШАССИ: только light_biped, medium_tracked');
    const en = englishPrompts({ replyLanguage: 'English', markForTranslation: false }).commanderUser(s, 'enemy');
    expect(en).toContain('HQ DOCTRINE:');
    expect(en).toContain('ALLOWED CHASSIS: only light_biped, medium_tracked');
    // nothing for the human's side and nothing in a fair AI-vs-AI match
    expect(commanderUserPrompt(s, 'player')).not.toContain('ДОКТРИНА');
    expect(commanderUserPrompt(new GameState({ level: levelConfig(2), fair: true }), 'enemy')).not.toContain('ДОКТРИНА');
  });

  it('difficulty grows: the rule-based commander playing teal wins level 1 almost always and level 7 rarely', () => {
    const wins = (n: number) => {
      let w = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const orig = Math.random;
        Math.random = seeded(seed);
        try {
          const s = new GameState({ level: levelConfig(n) });
          const d = new AIDirector(offline, { chat() {}, proposal() {}, tactical() {}, intercept() {}, changed() {} });
          d.setMode('spectator');
          for (let t = 0; t < 25 * 60 && !s.gameOver; t += 0.1) {
            s.update(0.1);
            d.update(s, 0.1);
          }
          if (s.gameOver === 'player_won') w++;
        } finally {
          Math.random = orig;
        }
      }
      return w;
    };
    expect(wins(1)).toBeGreaterThanOrEqual(5);
    expect(wins(CAMPAIGN.length)).toBeLessThanOrEqual(2);
  }, 60000);
});

describe('campaign progress', () => {
  it('a victory opens the next level and keeps the best time; progress survives a reload', () => {
    stubStorage();
    expect(loadCampaign()).toEqual({ unlocked: 1, best: {} });
    let p = recordVictory(loadCampaign(), 1, 420.4);
    p = recordVictory(p, 1, 500);
    expect(p).toEqual({ unlocked: 2, best: { 1: 420 } });
    saveCampaign(p);
    expect(loadCampaign()).toEqual(p);
    // replaying an old level does not lower the progress
    expect(recordVictory({ unlocked: 5, best: {} }, 2, 300).unlocked).toBe(5);
  });

  it('the controller unlocks the next level on a human victory and starts it on "next level"', () => {
    stubStorage();
    const ctrl = new GameController();
    expect(ctrl.selectedLevel).toBe(1);
    ctrl.selectLevel(3); // locked: ignored
    expect(ctrl.selectedLevel).toBe(1);
    ctrl.start('human');
    expect(ctrl.state.level?.n).toBe(1);
    ctrl.state.getHQ('enemy')!.hp = 0;
    ctrl.fastForward(0.2);
    expect(ctrl.state.gameOver).toBe('player_won');
    expect(ctrl.campaign.unlocked).toBe(2);
    expect(loadCampaign().unlocked).toBe(2);
    ctrl.nextLevel();
    expect(ctrl.state.level?.n).toBe(2);
    expect(ctrl.state.gameOver).toBeNull();
    // the start screen of a fresh visit opens on the furthest level
    expect(new GameController().selectedLevel).toBe(2);
  });

  it('an AI-vs-AI result opens nothing', () => {
    stubStorage();
    const ctrl = new GameController();
    ctrl.start('spectator');
    expect(ctrl.state.units.some(u => u.kind === 'combat' && u.team === 'enemy')).toBe(false);
    ctrl.state.getHQ('enemy')!.hp = 0;
    ctrl.fastForward(0.2);
    expect(ctrl.state.gameOver).toBe('player_won');
    expect(ctrl.campaign.unlocked).toBe(1);
  });
});
