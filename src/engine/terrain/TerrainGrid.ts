import { Vector2D } from '../../types/game';

/**
 * Battlefield terrain. Forest and rocks are impassable; swamp is passable but slow.
 * Forest will also block sight (fog of war); rocks will not.
 */
export type TerrainType = 'open' | 'forest' | 'rock' | 'swamp';

export const TERRAIN_CODE: Record<TerrainType, number> = { open: 0, forest: 1, rock: 2, swamp: 3 };
const TERRAIN_BY_CODE: TerrainType[] = ['open', 'forest', 'rock', 'swamp'];

/** Speed multiplier in a swamp; heavy chassis sink deeper. */
export const SWAMP_SPEED = 0.5;
export const SWAMP_SPEED_HEAVY = 0.4;
/** Path cost of a swamp cell relative to open ground (A* prefers a longer dry route). */
export const SWAMP_PATH_COST = 2.2;

/** Clearance of an open field without obstacles (any radius fits). */
const OPEN_CLEARANCE = 99;

/**
 * A grid of 1×1 world-unit cells over the map. Besides the terrain type of each cell it keeps a
 * clearance map — the distance from the cell centre to the nearest impassable cell — so a heavy
 * chassis does not squeeze through a gap a scout fits in.
 */
export class TerrainGrid {
  readonly cells: Uint8Array;
  readonly clearance: Float32Array;
  private obstacles = false;
  private sightBlockers = false;

  constructor(
    readonly cols: number,
    readonly rows: number,
    cells?: Uint8Array,
  ) {
    this.cells = cells ?? new Uint8Array(cols * rows);
    this.clearance = new Float32Array(cols * rows);
    this.computeClearance();
  }

  static flat(cols: number, rows: number): TerrainGrid {
    return new TerrainGrid(cols, rows);
  }

  /** True when the map has impassable cells (on a flat map navigation is a straight line). */
  get hasObstacles(): boolean {
    return this.obstacles;
  }

  /** True when something on the map blocks line of sight (forest). */
  get hasSightBlockers(): boolean {
    return this.sightBlockers;
  }

  index(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }

  cellOf(p: Vector2D): { cx: number; cy: number } {
    return {
      cx: Math.max(0, Math.min(this.cols - 1, Math.floor(p.x))),
      cy: Math.max(0, Math.min(this.rows - 1, Math.floor(p.y))),
    };
  }

  typeAt(p: Vector2D): TerrainType {
    const { cx, cy } = this.cellOf(p);
    return TERRAIN_BY_CODE[this.cells[this.index(cx, cy)]] ?? 'open';
  }

  typeOfCell(i: number): TerrainType {
    return TERRAIN_BY_CODE[this.cells[i]] ?? 'open';
  }

  isBlockingCode(code: number): boolean {
    return code === TERRAIN_CODE.forest || code === TERRAIN_CODE.rock;
  }

  blockedCell(i: number): boolean {
    return this.isBlockingCode(this.cells[i]);
  }

  /** Only forest hides what is behind it; rocks and swamp do not. */
  blocksSightCell(i: number): boolean {
    return this.cells[i] === TERRAIN_CODE.forest;
  }

  /** No forest between a and b (scouting and direct fire). */
  lineOfSight(a: Vector2D, b: Vector2D): boolean {
    if (!this.sightBlockers) return true;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const steps = Math.ceil(Math.hypot(dx, dy) / 0.5);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const { cx, cy } = this.cellOf({ x: a.x + dx * t, y: a.y + dy * t });
      if (this.cells[cy * this.cols + cx] === TERRAIN_CODE.forest) return false;
    }
    return true;
  }

  clearanceAt(p: Vector2D): number {
    const { cx, cy } = this.cellOf(p);
    return this.clearance[this.index(cx, cy)];
  }

  /** A body of radius r can stand here. */
  walkable(p: Vector2D, r: number): boolean {
    return this.clearanceAt(p) >= r;
  }

  speedFactor(p: Vector2D, heavy: boolean): number {
    if (this.typeAt(p) !== 'swamp') return 1;
    return heavy ? SWAMP_SPEED_HEAVY : SWAMP_SPEED;
  }

  /** The straight segment a→b is walkable for radius r (the start point itself is not checked). */
  segmentClear(a: Vector2D, b: Vector2D, r: number): boolean {
    if (!this.obstacles) return true;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.ceil(len / 0.6);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.clearanceAt({ x: a.x + dx * t, y: a.y + dy * t }) < r) return false;
    }
    return true;
  }

  /** Nearest cell centre with clearance ≥ r (ring search), or null when none within maxRing cells. */
  nearestWalkable(p: Vector2D, r: number, maxRing = 14): Vector2D | null {
    const { cx, cy } = this.cellOf(p);
    if (this.clearance[this.index(cx, cy)] >= r) return { x: cx + 0.5, y: cy + 0.5 };
    let best: Vector2D | null = null;
    let bestD = Infinity;
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!this.inBounds(x, y) || this.clearance[this.index(x, y)] < r) continue;
          const d = (x + 0.5 - p.x) ** 2 + (y + 0.5 - p.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { x: x + 0.5, y: y + 0.5 };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * Moves a body that ended up too close to trees or rocks (pushed by the crowd) back out along
   * the clearance gradient. Returns true when the position changed.
   */
  pushOut(p: Vector2D, r: number): boolean {
    if (!this.obstacles) return false;
    const c = this.clearanceAt(p);
    if (c >= r) return false;
    let bx = 0;
    let by = 0;
    let best = c;
    for (const [dx, dy] of NEIGHBOURS) {
      const q = { x: p.x + dx, y: p.y + dy };
      const { cx, cy } = this.cellOf(q);
      const v = this.clearance[this.index(cx, cy)];
      if (v > best) {
        best = v;
        bx = dx;
        by = dy;
      }
    }
    if (bx === 0 && by === 0) {
      const w = this.nearestWalkable(p, r);
      if (!w) return false;
      p.x = w.x;
      p.y = w.y;
      return true;
    }
    const n = Math.hypot(bx, by);
    const step = Math.min(0.5, r - c + 0.05);
    p.x += (bx / n) * step;
    p.y += (by / n) * step;
    return true;
  }

  /**
   * Chamfer distance transform (8-neighbour, weights 1 and √2) from impassable cells.
   * The clearance of an open cell is the distance from its centre to the edge of the nearest blocked cell.
   */
  computeClearance() {
    const { cols, rows } = this;
    const d = this.clearance;
    const INF = 1e6;
    this.obstacles = false;
    this.sightBlockers = false;
    for (let i = 0; i < d.length; i++) {
      if (this.cells[i] === TERRAIN_CODE.forest) this.sightBlockers = true;
      if (this.blockedCell(i)) {
        d[i] = 0;
        this.obstacles = true;
      } else {
        d[i] = INF;
      }
    }
    if (!this.obstacles) {
      d.fill(OPEN_CLEARANCE);
      return;
    }
    const D = Math.SQRT2;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        let v = d[i];
        if (v === 0) continue;
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) {
          v = Math.min(v, d[i - cols] + 1);
          if (x > 0) v = Math.min(v, d[i - cols - 1] + D);
          if (x < cols - 1) v = Math.min(v, d[i - cols + 1] + D);
        }
        d[i] = v;
      }
    }
    for (let y = rows - 1; y >= 0; y--) {
      for (let x = cols - 1; x >= 0; x--) {
        const i = y * cols + x;
        let v = d[i];
        if (v === 0) continue;
        if (x < cols - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < rows - 1) {
          v = Math.min(v, d[i + cols] + 1);
          if (x < cols - 1) v = Math.min(v, d[i + cols + 1] + D);
          if (x > 0) v = Math.min(v, d[i + cols - 1] + D);
        }
        d[i] = v;
      }
    }
    for (let i = 0; i < d.length; i++) d[i] = d[i] === 0 ? 0 : Math.min(OPEN_CLEARANCE, d[i] - 0.5);
  }
}

const NEIGHBOURS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
];
