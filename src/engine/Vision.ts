import { MODULES_CATALOG } from '../config/catalog';
import { Building, GameUnit, Team } from '../types/game';
import type { GameState } from './GameState';

/** Sight radius (world units) of each observer kind. Forest blocks sight, rocks and swamp do not. */
export const SIGHT = {
  light_biped: 24,
  medium_tracked: 20,
  heavy_quad: 18,
  harvester: 16,
  building: 18,
  command_center: 24,
} as const;
/** A radar module widens the robot's sight. */
export const RADAR_SIGHT_MULT = 1.3;
/** Visibility is recomputed this often (s): fast enough for targeting, cheap for long matches. */
export const VISION_INTERVAL = 0.25;
/** Cell size of the fog grid drawn on screen and on the minimap. */
export const FOG_CELL = 2;

export function sightRadius(o: GameUnit | Building): number {
  if (!('kind' in o)) return o.type === 'command_center' ? SIGHT.command_center : SIGHT.building;
  if (o.kind === 'harvester') return SIGHT.harvester;
  const base = SIGHT[o.design.chassisId] ?? SIGHT.medium_tracked;
  return o.design.modules.some(id => MODULES_CATALOG[id]?.rangeMultiplier) ? base * RADAR_SIGHT_MULT : base;
}

/** What a side knows about the enemy army without omniscience. */
export interface EnemyIntel {
  /** enemy combat machines in sight right now */
  visible: number;
  /** seconds since an enemy combat machine was last in sight; null — never */
  lastContactAgo: number | null;
  /** how many were in sight at that last contact */
  lastCount: number;
}

export interface FogGrid {
  cols: number;
  rows: number;
  /** 1 — in sight of the team now, 0 — fogged */
  cells: Uint8Array;
  /** game time the grid was computed for */
  time: number;
}

/**
 * Fog of war: each side sees the field only through its own machines and buildings, and forest
 * hides what is behind it. Enemy units outside sight cannot be targeted, are not reported to the
 * agents and are not drawn for the human player.
 */
export class Vision {
  private visible: Record<Team, Set<string>> = { player: new Set(), enemy: new Set() };
  private contact: Record<Team, { time: number; count: number } | null> = { player: null, enemy: null };
  private timer = 0;
  private fog: Partial<Record<Team, FogGrid>> = {};

  /** Disabled vision (the design-trial arena) sees everything. */
  constructor(readonly enabled: boolean) {}

  update(state: GameState, dt: number) {
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = VISION_INTERVAL;
    this.recompute(state);
  }

  /** Recomputes which enemy units each side sees (also used by tests to skip the interval). */
  recompute(state: GameState) {
    for (const team of ['player', 'enemy'] as Team[]) {
      const observers: { x: number; y: number; r: number }[] = [];
      for (const u of state.units) if (u.team === team && u.state !== 'dead') observers.push({ x: u.pos.x, y: u.pos.y, r: sightRadius(u) });
      for (const b of state.buildings) if (b.team === team) observers.push({ x: b.pos.x, y: b.pos.y, r: sightRadius(b) });
      const seen = new Set<string>();
      let combat = 0;
      for (const e of state.units) {
        if (e.team === team || e.state === 'dead') continue;
        for (const o of observers) {
          const r = o.r + e.radius;
          const dx = e.pos.x - o.x;
          const dy = e.pos.y - o.y;
          if (dx * dx + dy * dy > r * r) continue;
          if (state.terrain.lineOfSight(o, e.pos)) {
            seen.add(e.id);
            if (e.kind === 'combat') combat++;
            break;
          }
        }
      }
      this.visible[team] = seen;
      if (combat > 0) this.contact[team] = { time: state.gameTime, count: combat };
    }
  }

  /** The unit (of the other side) is in sight of `team` now. */
  sees(team: Team, unitId: string): boolean {
    return !this.enabled || this.visible[team].has(unitId);
  }

  intel(state: GameState, team: Team): EnemyIntel {
    let visible = 0;
    for (const u of state.units) if (u.team !== team && u.kind === 'combat' && u.state !== 'dead' && this.sees(team, u.id)) visible++;
    const c = this.contact[team];
    return {
      visible,
      lastContactAgo: this.enabled ? (c ? Math.round(state.gameTime - c.time) : null) : 0,
      lastCount: this.enabled ? (c?.count ?? 0) : visible,
    };
  }

  /**
   * Cells of the map in sight of `team`, for drawing the fog. Rays are cast from every observer and
   * stop at the first tree (the edge of the forest itself is visible). Computed on demand and cached
   * for a vision interval, so headless matches never pay for it.
   */
  fogGrid(state: GameState, team: Team): FogGrid {
    const cached = this.fog[team];
    if (cached && Math.abs(state.gameTime - cached.time) < VISION_INTERVAL) return cached;
    const t = state.terrain;
    const cols = Math.ceil(t.cols / FOG_CELL);
    const rows = Math.ceil(t.rows / FOG_CELL);
    const cells = cached && cached.cols === cols && cached.rows === rows ? cached.cells.fill(0) : new Uint8Array(cols * rows);
    const mark = (x: number, y: number) => {
      const fx = Math.floor(x / FOG_CELL);
      const fy = Math.floor(y / FOG_CELL);
      if (fx >= 0 && fy >= 0 && fx < cols && fy < rows) cells[fy * cols + fx] = 1;
    };
    const cast = (ox: number, oy: number, r: number) => {
      const rays = Math.max(48, Math.round(r * 4));
      for (let k = 0; k < rays; k++) {
        const a = (k / rays) * Math.PI * 2;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        for (let s = 0; s <= r; s += 1) {
          const x = ox + dx * s;
          const y = oy + dy * s;
          if (x < 0 || y < 0 || x >= t.cols || y >= t.rows) break;
          mark(x, y);
          if (t.blocksSightCell(t.index(Math.floor(x), Math.floor(y)))) break;
        }
      }
    };
    for (const u of state.units) if (u.team === team && u.state !== 'dead') cast(u.pos.x, u.pos.y, sightRadius(u));
    for (const b of state.buildings) if (b.team === team) cast(b.pos.x, b.pos.y, sightRadius(b));
    const grid = { cols, rows, cells, time: state.gameTime };
    this.fog[team] = grid;
    return grid;
  }

  /** A world point is inside the fog grid's visible area of `team`. */
  pointVisible(state: GameState, team: Team, x: number, y: number): boolean {
    if (!this.enabled) return true;
    const g = this.fogGrid(state, team);
    const fx = Math.floor(x / FOG_CELL);
    const fy = Math.floor(y / FOG_CELL);
    if (fx < 0 || fy < 0 || fx >= g.cols || fy >= g.rows) return false;
    return g.cells[fy * g.cols + fx] === 1;
  }
}
