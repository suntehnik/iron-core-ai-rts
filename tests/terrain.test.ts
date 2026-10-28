import { describe, expect, it } from 'vitest';
import { GAME_BALANCE, buildingSlot } from '../src/config/balance';
import { AIDirector } from '../src/ai/AIDirector';
import { GameState } from '../src/engine/GameState';
import { DEFAULT_MAP, MapSpec, PASSAGE_CLEARANCE, mulberry32 } from '../src/engine/terrain/MapGenerator';
import { Pathfinder, reachableCells } from '../src/engine/terrain/Pathfinding';
import { TERRAIN_CODE, TerrainGrid } from '../src/engine/terrain/TerrainGrid';
import { LLMSettings } from '../src/types/agent';
import { CombatUnit, Team, Vector2D } from '../src/types/game';

const W = GAME_BALANCE.MAP_WIDTH;
const H = GAME_BALANCE.MAP_HEIGHT;
const HEAVY_RADIUS = 2.1;

function count(grid: TerrainGrid, code: number): number {
  let n = 0;
  for (const c of grid.cells) if (c === code) n++;
  return n;
}

/** Points the generator promises to connect: base exits, factory exits, deposits, rally points. */
function keyPoints(s: GameState): Vector2D[] {
  const pts: Vector2D[] = [];
  for (const team of ['player', 'enemy'] as Team[]) {
    const dir = team === 'player' ? 1 : -1;
    const hq = buildingSlot(team, 'command_center');
    pts.push({ x: hq.x + dir * 8, y: hq.y }, s.rallyPoint(team));
    for (const i of [0, 1]) {
      const f = buildingSlot(team, 'factory', i);
      pts.push({ x: f.x + dir * 5.5, y: f.y });
    }
  }
  for (const p of s.resourcePatches) pts.push(p.pos);
  return pts;
}

function allConnected(s: GameState, r: number): boolean {
  const pts = keyPoints(s);
  const seen = reachableCells(s.terrain, pts[0], r);
  return pts.every(p => {
    const { cx, cy } = s.terrain.cellOf(p);
    return seen[s.terrain.index(cx, cy)] === 1;
  });
}

/** A grid with a vertical wall of forest at x = 20 and one gap of the given width. */
function wallWithGap(gapFrom: number, gapWidth: number): TerrainGrid {
  const cells = new Uint8Array(40 * 30);
  for (let y = 0; y < 30; y++) {
    if (y >= gapFrom && y < gapFrom + gapWidth) continue;
    for (let x = 19; x <= 21; x++) cells[y * 40 + x] = TERRAIN_CODE.forest;
  }
  return new TerrainGrid(40, 30, cells);
}

describe('terrain grid', () => {
  it('a match without a map spec is a flat field, as before', () => {
    const s = new GameState();
    expect(s.terrain.hasObstacles).toBe(false);
    expect(s.terrain.segmentClear({ x: 1, y: 1 }, { x: 99, y: 59 }, 3)).toBe(true);
  });

  it('clearance grows with the distance from trees', () => {
    const g = wallWithGap(0, 0);
    expect(g.clearanceAt({ x: 20.5, y: 10.5 })).toBe(0);
    expect(g.clearanceAt({ x: 22.5, y: 10.5 })).toBeCloseTo(0.5, 5);
    expect(g.clearanceAt({ x: 25.5, y: 10.5 })).toBeCloseTo(3.5, 5);
  });

  it('pushes a body out of the trees', () => {
    const g = wallWithGap(0, 0);
    const p = { x: 22.2, y: 10 };
    for (let i = 0; i < 10 && g.pushOut(p, 1.3); i++);
    expect(g.clearanceAt(p)).toBeGreaterThanOrEqual(1.3);
  });
});

describe('pathfinding', () => {
  it('goes through a gap the body fits in, with clear straight legs', () => {
    const g = wallWithGap(12, 4);
    const path = new Pathfinder(g).findPath({ x: 5, y: 3 }, { x: 35, y: 3 }, 1.3)!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toEqual({ x: 35, y: 3 });
    let from = { x: 5, y: 3 };
    for (const wp of path) {
      expect(g.segmentClear(from, wp, 1.3)).toBe(true);
      from = wp;
    }
    // the route bends through the gap (rows 12..15)
    expect(path.some(p => p.x > 18 && p.x < 23 && p.y > 11 && p.y < 17)).toBe(true);
  });

  it('a heavy chassis does not squeeze through a gap a scout fits in', () => {
    const g = wallWithGap(12, 4);
    expect(new Pathfinder(g).findPath({ x: 5, y: 3 }, { x: 35, y: 3 }, HEAVY_RADIUS)).toBeNull();
    const wide = wallWithGap(12, 6);
    expect(new Pathfinder(wide).findPath({ x: 5, y: 3 }, { x: 35, y: 3 }, HEAVY_RADIUS)).not.toBeNull();
  });

  it('heads for the nearest reachable point when the goal is inside the trees', () => {
    const g = wallWithGap(12, 4);
    const path = new Pathfinder(g).findPath({ x: 5, y: 13 }, { x: 20.5, y: 5 }, 1.3)!;
    const end = path[path.length - 1];
    expect(g.walkable(end, 1.3)).toBe(true);
    expect(Math.hypot(end.x - 20.5, end.y - 5)).toBeLessThan(4);
  });
});

describe('map generator', () => {
  it('the default map is the same every time, mirrored, and has forest and rocks', () => {
    const a = new GameState({ map: DEFAULT_MAP }).terrain;
    const b = new GameState({ map: DEFAULT_MAP }).terrain;
    expect([...a.cells]).toEqual([...b.cells]);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) expect(a.cells[a.index(x, y)]).toBe(a.cells[a.index(W - 1 - x, y)]);
    }
    expect(count(a, TERRAIN_CODE.forest)).toBeGreaterThan(W * H * 0.06);
    expect(count(a, TERRAIN_CODE.rock)).toBeGreaterThan(10);
  });

  it('keeps building slots, deposits and rally points free', () => {
    const s = new GameState({ map: DEFAULT_MAP });
    for (const team of ['player', 'enemy'] as Team[]) {
      expect(s.terrain.clearanceAt(buildingSlot(team, 'command_center'))).toBeGreaterThan(8);
      for (const i of [0, 1]) expect(s.terrain.clearanceAt(buildingSlot(team, 'factory', i))).toBeGreaterThan(5);
      for (const i of [0, 1, 2]) expect(s.terrain.clearanceAt(buildingSlot(team, 'power_plant', i))).toBeGreaterThan(3);
    }
    for (const p of s.resourcePatches) expect(s.terrain.clearanceAt(p.pos)).toBeGreaterThanOrEqual(PASSAGE_CLEARANCE);
  });

  it('connects bases, deposits and rally points for a heavy chassis on every seed', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const spec: MapSpec = {
        id: `t${seed}`,
        seed,
        groves: 6 + (seed % 7),
        groveSize: [4, 7.5],
        ridges: seed % 4,
        swamps: seed % 3,
        symmetric: seed % 5 !== 0,
      };
      const s = new GameState({ map: spec });
      expect(allConnected(s, HEAVY_RADIUS), `seed ${seed}`).toBe(true);
    }
  });
});

describe('movement on the forest map', () => {
  const offline: LLMSettings = {
    provider: 'offline', apiKey: '', model: '', baseUrl: '',
    enemyUsesLLM: true, autonomousTactics: true, chargeEnemyToPlayer: false,
    autoSpeakResponse: false, matchCoinLimit: 40, soundMuted: true,
  };

  it('machines of every chassis march across the groves to the enemy base', () => {
    for (const chassisId of ['light_biped', 'medium_tracked', 'heavy_quad'] as const) {
      const s = new GameState({ map: DEFAULT_MAP });
      s.units = [];
      s.setFactoryPaused('enemy', null, true);
      const design = { ...s.teams.player.design, chassisId, modules: ['light_composite', 'autocannon_20mm'] };
      // start behind the northern grove, far from the straight line to the enemy HQ
      s.spawnCombatBot('player', { x: 24, y: 6 }, design, 1);
      const u = s.units[0] as CombatUnit;
      u.committed = true;
      // past the centre and the enemy rally point (it then storms the first building in range)
      let maxX = u.pos.x;
      for (let i = 0; i < 20 * 60 && maxX < 66; i++) {
        s.update(1 / 20);
        maxX = Math.max(maxX, u.pos.x);
        expect(s.terrain.clearanceAt(u.pos)).toBeGreaterThan(u.radius * 0.3);
      }
      expect(maxX, chassisId).toBeGreaterThanOrEqual(66);
    }
  });

  it('a full offline match never leaves machines inside trees and both sides keep mining', () => {
    // A seeded match: the engine rolls Math.random for spawn offsets, lanes, cooldowns and shots.
    // Unseeded, about one match in four the teal side (no AI economy here) loses its first wave,
    // then its two harvesters, and never orders new ones, so it stops mining at 400–800 metal.
    const orig = Math.random;
    Math.random = mulberry32(8);
    try {
      const s = new GameState({ map: DEFAULT_MAP });
      const director = new AIDirector(offline, { chat() {}, proposal() {}, tactical() {}, intercept() {}, changed() {} });
      let worst = Infinity;
      for (let t = 0; t < 8 * 60 && !s.gameOver; t += 1 / 20) {
        s.update(1 / 20);
        director.update(s, 1 / 20);
        for (const u of s.units) worst = Math.min(worst, s.terrain.clearanceAt(u.pos) / u.radius);
      }
      expect(worst).toBeGreaterThan(0.3);
      for (const team of ['player', 'enemy'] as Team[]) {
        expect(s.teams[team].economy.totals.metalMined).toBeGreaterThan(800);
        expect(s.teams[team].economy.totals.unitsBuilt).toBeGreaterThan(4);
      }
    } finally {
      Math.random = orig;
    }
  });
});
