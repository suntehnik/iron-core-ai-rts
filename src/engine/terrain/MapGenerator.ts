import { Vector2D } from '../../types/game';
import { reachableCells } from './Pathfinding';
import { TERRAIN_CODE, TerrainGrid } from './TerrainGrid';

/** Parameters of a generated battlefield. The same spec and seed always give the same map. */
export interface MapSpec {
  id: string;
  seed: number;
  /** forest groves per half of the map */
  groves: number;
  /** grove radius range, world units */
  groveSize: [number, number];
  /** rock ridges per half of the map */
  ridges: number;
  /** swamp patches per half of the map */
  swamps: number;
  /** mirror the player's half onto the enemy's (fair maps) */
  symmetric: boolean;
  /** horizontal forest strips across the middle that split it into corridors */
  bands?: { y: number; x0: number; x1: number; thickness: number }[];
  /** radius of a swamp in the middle of the map */
  centerSwamp?: number;
  /**
   * A forest wall across the whole map in front of the enemy base, between x0 and x1, with a single
   * gate centred on gateY (late campaign levels). Not mirrored: it is the defender's advantage.
   */
  fortress?: { x0: number; x1: number; gateY: number; gate: number };
}

/** Map of the regular match until the campaign brings per-level maps. */
export const DEFAULT_MAP: MapSpec = {
  id: 'groves',
  seed: 64,
  groves: 9,
  groveSize: [4, 6.5],
  ridges: 2,
  swamps: 0,
  symmetric: true,
};

/** An area that must stay free: bases, building slots, deposits, rally points. */
export interface KeepOut {
  pos: Vector2D;
  radius: number;
  /** only trees and rocks are cleared, swamp stays (deposits and rally points may lie in a swamp) */
  soft?: boolean;
}

/**
 * Clearance every connected point must have: the heaviest chassis (radius 2.1) plus a margin,
 * i.e. passages at least six cells wide.
 */
export const PASSAGE_CLEARANCE = 2.5;

/** Seeded PRNG (mulberry32): maps must not depend on Math.random. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates terrain: forest groves (unions of jittered circles with ragged edges), rock ridges and
 * swamp patches, keeps the given areas free, then guarantees that every connect point is reachable
 * from the first one through passages wide enough for a heavy chassis, carving corridors if needed.
 */
export function generateTerrain(
  spec: MapSpec,
  cols: number,
  rows: number,
  keepOut: KeepOut[],
  connect: Vector2D[],
): TerrainGrid {
  const rnd = mulberry32(spec.seed);
  const cells = new Uint8Array(cols * rows);
  const half = spec.symmetric ? Math.floor(cols / 2) : cols;
  const set = (cx: number, cy: number, code: number) => {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    cells[cy * cols + cx] = code;
    if (spec.symmetric) cells[cy * cols + (cols - 1 - cx)] = code;
  };
  const blocked = (cx: number, cy: number) => {
    const i = cy * cols + cx;
    return cells[i] === TERRAIN_CODE.forest || cells[i] === TERRAIN_CODE.rock;
  };
  // Areas are placed on the generating half (x < half); the mirror copies them across.
  const xMin = 12;
  const xMax = spec.symmetric ? half - 3 : cols - 12;

  if (spec.centerSwamp) {
    blob({ x: cols / 2, y: rows / 2 }, spec.centerSwamp, rnd, (x, y) => set(x, y, TERRAIN_CODE.swamp));
  }
  for (let s = 0; s < spec.swamps; s++) {
    const c = { x: lerp(xMin, xMax, rnd()), y: lerp(6, rows - 6, rnd()) };
    blob(c, lerp(3, 6, rnd()), rnd, (x, y) => !blocked(x, y) && set(x, y, TERRAIN_CODE.swamp));
  }
  // Groves are spread over a grid of zones (north / centre / south × depth) so the field is
  // covered evenly instead of clumping by chance.
  const bands = 3;
  const depth = Math.max(1, Math.ceil(spec.groves / bands));
  for (let g = 0; g < spec.groves; g++) {
    const band = g % bands;
    const col = Math.floor(g / bands) % depth;
    const c = {
      x: lerp(xMin + ((xMax - xMin) * col) / depth, xMin + ((xMax - xMin) * (col + 1)) / depth, rnd()),
      y: lerp(3 + ((rows - 6) * band) / bands, 3 + ((rows - 6) * (band + 1)) / bands, rnd()),
    };
    blob(c, lerp(spec.groveSize[0], spec.groveSize[1], rnd()), rnd, (x, y) => set(x, y, TERRAIN_CODE.forest));
  }
  for (const b of spec.bands ?? []) {
    const phase = rnd() * 10;
    for (let cx = Math.floor(b.x0); cx <= Math.ceil(b.x1); cx++) {
      const half = (b.thickness / 2) * (1 + 0.25 * Math.sin(cx * 0.9 + phase));
      for (let cy = Math.floor(b.y - half - 1); cy <= Math.ceil(b.y + half + 1); cy++) {
        if (Math.abs(cy + 0.5 - b.y) <= half) set(cx, cy, TERRAIN_CODE.forest);
      }
    }
  }
  for (let k = 0; k < spec.ridges; k++) {
    const a = { x: lerp(xMin, xMax, rnd()), y: lerp(6, rows - 6, rnd()) };
    const ang = rnd() * Math.PI;
    const len = lerp(5, 10, rnd());
    const b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
    const thick = lerp(0.9, 1.5, rnd());
    stroke(a, b, thick, (x, y) => set(x, y, TERRAIN_CODE.rock));
  }

  if (spec.fortress) fortressWall(spec.fortress, cols, rows, cells, rnd);

  // Keep-out areas are cleared on both halves (they are listed for both teams).
  for (const k of keepOut) {
    const r2 = k.radius * k.radius;
    for (let cy = Math.floor(k.pos.y - k.radius); cy <= Math.ceil(k.pos.y + k.radius); cy++) {
      for (let cx = Math.floor(k.pos.x - k.radius); cx <= Math.ceil(k.pos.x + k.radius); cx++) {
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
        if ((cx + 0.5 - k.pos.x) ** 2 + (cy + 0.5 - k.pos.y) ** 2 > r2) continue;
        if (k.soft && !blocked(cx, cy)) continue;
        cells[cy * cols + cx] = TERRAIN_CODE.open;
      }
    }
  }

  const grid = new TerrainGrid(cols, rows, cells);
  ensureConnected(grid, connect, spec.symmetric);
  return grid;
}

/** Carves corridors until every connect point is reachable from the first one. */
function ensureConnected(grid: TerrainGrid, connect: Vector2D[], symmetric: boolean) {
  if (!connect.length) return;
  for (let attempt = 0; attempt < 12; attempt++) {
    const seen = reachableCells(grid, connect[0], PASSAGE_CLEARANCE);
    const missing = connect.find(p => {
      const { cx, cy } = grid.cellOf(p);
      return !seen[grid.index(cx, cy)];
    });
    if (!missing) return;
    carve(grid, missing, seen, symmetric);
    grid.computeClearance();
  }
}

/**
 * Cheapest route from `from` to the reachable area, where crossing a blocked cell costs a lot,
 * then clears a corridor of PASSAGE_CLEARANCE + 1 cells around it.
 */
function carve(grid: TerrainGrid, from: Vector2D, reachable: Uint8Array, symmetric: boolean) {
  const { cols, rows } = grid;
  const n = cols * rows;
  const cost = new Float32Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const s = grid.cellOf(from);
  const start = grid.index(s.cx, s.cy);
  cost[start] = 0;
  // Dijkstra with step costs of 1 and 25: a bucket queue indexed by cost is exact and simple
  const buckets: number[][] = [[start]];
  const done = new Uint8Array(n);
  let target = -1;
  for (let b = 0; b < buckets.length && target < 0; b++) {
    const bucket = buckets[b];
    if (!bucket) continue;
    for (let q = 0; q < bucket.length; q++) {
      const cur = bucket[q];
      if (done[cur] || cost[cur] !== b) continue;
      done[cur] = 1;
      if (reachable[cur]) {
        target = cur;
        break;
      }
      const cx = cur % cols;
      const cy = (cur - cx) / cols;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        const nc = b + (grid.blockedCell(ni) ? 25 : 1);
        if (nc < cost[ni]) {
          cost[ni] = nc;
          parent[ni] = cur;
          (buckets[nc] ??= []).push(ni);
        }
      }
    }
  }
  if (target < 0) return;
  const radius = PASSAGE_CLEARANCE + 1;
  for (let c = target; c !== -1; c = parent[c]) {
    const cx = c % cols;
    const cy = (c - cx) / cols;
    for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) {
      for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!grid.inBounds(x, y)) continue;
        grid.cells[grid.index(x, y)] = TERRAIN_CODE.open;
        if (symmetric) grid.cells[grid.index(cols - 1 - x, y)] = TERRAIN_CODE.open;
      }
    }
  }
}

/** A forest wall from the top edge to the bottom one with a single gate (the enemy's fortress line). */
function fortressWall(f: NonNullable<MapSpec['fortress']>, cols: number, rows: number, cells: Uint8Array, rnd: () => number) {
  const phase = rnd() * 10;
  for (let cy = 0; cy < rows; cy++) {
    if (Math.abs(cy + 0.5 - f.gateY) < f.gate / 2) continue;
    const wobble = 0.7 * Math.sin(cy * 0.7 + phase);
    for (let cx = Math.floor(f.x0 + wobble); cx <= Math.ceil(f.x1 + wobble); cx++) {
      if (cx >= 0 && cx < cols) cells[cy * cols + cx] = TERRAIN_CODE.forest;
    }
  }
}

/** Fills an organic blob: a few overlapping jittered circles with ragged edges. */
function blob(c: Vector2D, radius: number, rnd: () => number, fill: (cx: number, cy: number) => void) {
  const lobes = 2 + Math.floor(rnd() * 3);
  const circles: { x: number; y: number; r: number }[] = [{ x: c.x, y: c.y, r: radius }];
  for (let i = 0; i < lobes; i++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * lerp(0.35, 0.8, rnd());
    circles.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, r: radius * lerp(0.45, 0.8, rnd()) });
  }
  const reach = radius * 2;
  const phase = rnd() * 10;
  for (let cy = Math.floor(c.y - reach); cy <= Math.ceil(c.y + reach); cy++) {
    for (let cx = Math.floor(c.x - reach); cx <= Math.ceil(c.x + reach); cx++) {
      const px = cx + 0.5;
      const py = cy + 0.5;
      for (const k of circles) {
        const ang = Math.atan2(py - k.y, px - k.x);
        const ragged = k.r * (1 + 0.14 * Math.sin(ang * 5 + phase) + 0.08 * Math.sin(ang * 9 - phase));
        if ((px - k.x) ** 2 + (py - k.y) ** 2 <= ragged * ragged) {
          fill(cx, cy);
          break;
        }
      }
    }
  }
}

/** Fills cells within `thick` of the segment a→b. */
function stroke(a: Vector2D, b: Vector2D, thick: number, fill: (cx: number, cy: number) => void) {
  const minX = Math.floor(Math.min(a.x, b.x) - thick - 1);
  const maxX = Math.ceil(Math.max(a.x, b.x) + thick + 1);
  const minY = Math.floor(Math.min(a.y, b.y) - thick - 1);
  const maxY = Math.ceil(Math.max(a.y, b.y) + thick + 1);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = Math.max(1e-6, dx * dx + dy * dy);
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const px = cx + 0.5;
      const py = cy + 0.5;
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
      if ((px - a.x - dx * t) ** 2 + (py - a.y - dy * t) ** 2 <= thick * thick) fill(cx, cy);
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
