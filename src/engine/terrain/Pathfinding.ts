import { Vector2D } from '../../types/game';
import { SWAMP_PATH_COST, TERRAIN_CODE, TerrainGrid } from './TerrainGrid';

const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * A* over the terrain grid for a body of a given radius (cells whose clearance is smaller are
 * walls for it). Search buffers are allocated once and reused: matches run many searches.
 */
export class Pathfinder {
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private generation = 0;
  private heap: number[] = [];
  private f: Float32Array;

  constructor(private grid: TerrainGrid) {
    const n = grid.cols * grid.rows;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  /**
   * Smoothed waypoints from `from` to `to` (the last one is the goal or the nearest walkable point
   * to it), or null when there is no way through.
   */
  findPath(from: Vector2D, to: Vector2D, r: number): Vector2D[] | null {
    const grid = this.grid;
    const start = grid.nearestWalkable(from, r);
    const goalPt = grid.walkable(to, r) ? to : grid.nearestWalkable(to, r, 20);
    if (!start || !goalPt) return null;
    const s = grid.cellOf(start);
    const t = grid.cellOf(goalPt);
    const cells = this.search(s.cx, s.cy, t.cx, t.cy, r);
    if (!cells) return null;
    const pts = cells.map(i => ({ x: (i % grid.cols) + 0.5, y: Math.floor(i / grid.cols) + 0.5 }));
    pts[pts.length - 1] = { x: goalPt.x, y: goalPt.y };
    return this.smooth(from, pts, r);
  }

  private search(sx: number, sy: number, tx: number, ty: number, r: number): number[] | null {
    const grid = this.grid;
    const cols = grid.cols;
    const gen = ++this.generation;
    const startI = sy * cols + sx;
    const goalI = ty * cols + tx;
    const heap = this.heap;
    heap.length = 0;
    this.stamp[startI] = gen;
    this.g[startI] = 0;
    this.parent[startI] = -1;
    this.f[startI] = octile(sx, sy, tx, ty);
    this.push(startI);

    while (heap.length) {
      const cur = this.pop();
      if (cur === goalI) return this.unwind(goalI);
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      const cx = cur % cols;
      const cy = (cur - cx) / cols;
      for (const [dx, dy, step] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!grid.inBounds(nx, ny)) continue;
        const ni = ny * cols + nx;
        if (grid.clearance[ni] < r || this.closed[ni] === gen) continue;
        // no corner cutting past an obstacle
        if (dx && dy && (grid.clearance[cy * cols + nx] < r || grid.clearance[ny * cols + cx] < r)) continue;
        const cost = grid.cells[ni] === TERRAIN_CODE.swamp ? step * SWAMP_PATH_COST : step;
        const ng = this.g[cur] + cost;
        if (this.stamp[ni] === gen && ng >= this.g[ni]) continue;
        this.stamp[ni] = gen;
        this.g[ni] = ng;
        this.parent[ni] = cur;
        this.f[ni] = ng + octile(nx, ny, tx, ty);
        this.push(ni);
      }
    }
    return null;
  }

  private unwind(i: number): number[] {
    const out: number[] = [];
    for (let c = i; c !== -1; c = this.parent[c]) out.push(c);
    return out.reverse();
  }

  /**
   * String pulling: from each anchor, run along the cell path while the straight line stays clear
   * and keep only the corner where it stops. Linear in the path length.
   */
  private smooth(from: Vector2D, pts: Vector2D[], r: number): Vector2D[] {
    const out: Vector2D[] = [];
    let anchor = from;
    let i = 0;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && this.grid.segmentClear(anchor, pts[j + 1], r)) j++;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }

  private push(i: number) {
    const heap = this.heap;
    const f = this.f;
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] <= f[i]) break;
      heap[k] = heap[p];
      k = p;
    }
    heap[k] = i;
  }

  private pop(): number {
    const heap = this.heap;
    const f = this.f;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      let k = 0;
      const n = heap.length;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && f[heap[c + 1]] < f[heap[c]]) c++;
        if (f[heap[c]] >= f[last]) break;
        heap[k] = heap[c];
        k = c;
      }
      heap[k] = last;
    }
    return top;
  }
}

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

/**
 * Cells reachable from `from` for a body of radius r (flood fill). Used by the map generator to
 * guarantee that bases and deposits are connected.
 */
export function reachableCells(grid: TerrainGrid, from: Vector2D, r: number): Uint8Array {
  const seen = new Uint8Array(grid.cols * grid.rows);
  const start = grid.nearestWalkable(from, r);
  if (!start) return seen;
  const s = grid.cellOf(start);
  const queue = [grid.index(s.cx, s.cy)];
  seen[queue[0]] = 1;
  while (queue.length) {
    const cur = queue.pop()!;
    const cx = cur % grid.cols;
    const cy = (cur - cx) / grid.cols;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!grid.inBounds(nx, ny)) continue;
      const ni = ny * grid.cols + nx;
      if (seen[ni] || grid.clearance[ni] < r) continue;
      if (dx && dy && (grid.clearance[cy * grid.cols + nx] < r || grid.clearance[ny * grid.cols + cx] < r)) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return seen;
}
