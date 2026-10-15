import { GAME_BALANCE, INITIAL_ENEMY_DESIGN } from '../config/balance';
import { CombatUnit, TacticalPlan, Team } from '../types/game';
import { RobotDesign } from '../types/robot';
import { DEFAULT_PLAN, GameState } from './GameState';
import { RobotBuilder, designSignature } from './RobotBuilder';

/**
 * Design test bench (brief §9 open decision: "доступность испытания конструкции до производства").
 *
 * Runs short headless skirmishes on an empty arena with the real combat code (armour, heat,
 * deployment, recoil, range), so the result reflects exactly what the factory would build.
 * Seeded randomness keeps the verdict stable for the same pair of designs.
 */

export interface TrialRun {
  distance: number;
  winner: Team | 'draw';
  duration: number;
  /** remaining HP of the tested side as a share of its starting HP, 0..1 */
  hpLeft: number;
  alive: number;
}

export interface TrialSummary {
  design: RobotDesign;
  count: number;
  runs: TrialRun[];
  winRate: number; // 0..1, draws count as half
  avgDuration: number;
  avgHpLeft: number; // 0..1
}

export interface TrialReport {
  key: string;
  opponent: RobotDesign;
  opponentSource: 'observed' | 'baseline';
  opponentCount: number;
  candidate: TrialSummary;
  serial: TrialSummary | null;
  /** Same metal budget as the opponent squad: several cheap vs one expensive (brief §4) */
  equalBudget: TrialSummary | null;
  candidateCost: number;
  opponentCost: number;
  computeMs: number;
}

export interface TrialOptions {
  count?: number;
  distances?: number[];
  seedsPerDistance?: number;
  maxSec?: number;
  /** tactical plan of the tested side (the player's current doctrine) */
  plan?: TacticalPlan;
  /** the current serial design, for the "проект vs серия" comparison */
  serial?: RobotDesign | null;
}

const DT = 1 / 20;

/** Metal-equivalent cost: a component costs two metal at the HQ fabricator. */
export function unitCost(design: RobotDesign): number {
  const s = RobotBuilder.calculateStats(design);
  return s.metalCost + s.componentCost * GAME_BALANCE.FABRICATOR_METAL_PER_COMPONENT;
}

/** Opponent for the bench: the most common enemy model our scouts have seen, otherwise the enemy's baseline model. */
export function pickTrialOpponent(state: GameState): { design: RobotDesign; source: 'observed' | 'baseline' } {
  const seen = state.observedEnemyDesigns('player');
  if (seen.length) return { design: seen[0].design, source: 'observed' };
  return { design: INITIAL_ENEMY_DESIGN, source: 'baseline' };
}

/** Cache key of a bench report: everything the report depends on, the serial model for the comparison included. */
export function trialKey(candidate: RobotDesign, opponent: RobotDesign, plan?: TacticalPlan, serial?: RobotDesign | null): string {
  const doctrine = `${plan?.engagementRange ?? 'balanced'}|${plan?.targetPriority ?? 'closest'}`;
  return `${designSignature(candidate)}|${designSignature(opponent)}|${doctrine}|${serial ? designSignature(serial) : '-'}`;
}

/** One skirmish: `aCount` tested robots (player side) vs `bCount` opponents. */
export function simulateSkirmish(
  a: RobotDesign,
  aCount: number,
  b: RobotDesign,
  bCount: number,
  distance: number,
  seed: number,
  plan: TacticalPlan = DEFAULT_PLAN,
  maxSec = 75,
  flankOffset = 0,
): TrialRun {
  return withSeededRandom(seed, () => {
    const arena = new GameState({ arena: true });
    arena.setPlan('player', { ...plan, stance: 'advance', retreatHpThreshold: 0, guardHarvesters: false });
    arena.setPlan('enemy', { ...DEFAULT_PLAN, stance: 'advance' });
    const cx = GAME_BALANCE.FRONTLINE_CENTER_X;
    const cy = GAME_BALANCE.MAP_HEIGHT / 2;
    spawnSquad(arena, 'player', a, aCount, cx - distance / 2, cy);
    spawnSquad(arena, 'enemy', b, bCount, cx + distance / 2, cy + flankOffset);
    const startHp = squadHp(arena, 'player');
    const startEnemyHp = squadHp(arena, 'enemy');

    let t = 0;
    while (t < maxSec) {
      arena.update(DT);
      t += DT;
      if (alive(arena, 'player') === 0 || alive(arena, 'enemy') === 0) break;
    }

    const pAlive = alive(arena, 'player');
    const eAlive = alive(arena, 'enemy');
    const hpLeft = startHp > 0 ? squadHp(arena, 'player') / startHp : 0;
    let winner: TrialRun['winner'];
    if (pAlive > 0 && eAlive === 0) winner = 'player';
    else if (eAlive > 0 && pAlive === 0) winner = 'enemy';
    else if (pAlive === 0 && eAlive === 0) winner = 'draw';
    else {
      // Timeout: decide by the remaining share of HP
      const enemyLeft = startEnemyHp > 0 ? squadHp(arena, 'enemy') / startEnemyHp : 0;
      winner = Math.abs(hpLeft - enemyLeft) < 0.1 ? 'draw' : hpLeft > enemyLeft ? 'player' : 'enemy';
    }
    return { distance, winner, duration: Number(t.toFixed(1)), hpLeft: Number(hpLeft.toFixed(3)), alive: pAlive };
  });
}

function summarize(design: RobotDesign, count: number, runs: TrialRun[]): TrialSummary {
  const score = runs.reduce((s, r) => s + (r.winner === 'player' ? 1 : r.winner === 'draw' ? 0.5 : 0), 0);
  return {
    design,
    count,
    runs,
    winRate: runs.length ? score / runs.length : 0,
    avgDuration: runs.length ? runs.reduce((s, r) => s + r.duration, 0) / runs.length : 0,
    avgHpLeft: runs.length ? runs.reduce((s, r) => s + r.hpLeft, 0) / runs.length : 0,
  };
}

function series(design: RobotDesign, count: number, opponent: RobotDesign, opponentCount: number, o: Required<Omit<TrialOptions, 'serial'>>): TrialSummary {
  const runs: TrialRun[] = [];
  o.distances.forEach((d, i) => {
    for (let k = 0; k < o.seedsPerDistance; k++) {
      // each seed also shifts the opponent sideways, so runs differ in approach angle
      const flank = (k - (o.seedsPerDistance - 1) / 2) * 8;
      runs.push(simulateSkirmish(design, count, opponent, opponentCount, d, 1000 + i * 97 + k * 13, o.plan, o.maxSec, flank));
    }
  });
  return summarize(design, count, runs);
}

/** Full bench report: the proposal, the current serial model and an equal-budget squad vs the same opponent. */
export function runDesignTrial(candidate: RobotDesign, opponent: RobotDesign, opponentSource: TrialReport['opponentSource'], opts: TrialOptions = {}): TrialReport {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const o = {
    count: opts.count ?? 4,
    distances: opts.distances ?? [14, 24, 34],
    seedsPerDistance: opts.seedsPerDistance ?? 3,
    maxSec: opts.maxSec ?? 75,
    plan: opts.plan ?? DEFAULT_PLAN,
  };
  const candidateCost = unitCost(candidate);
  const opponentCost = unitCost(opponent);

  const cand = series(candidate, o.count, opponent, o.count, o);

  const serialDesign = opts.serial ?? null;
  const sameAsCandidate = !!serialDesign && designSignature(serialDesign) === designSignature(candidate);
  const serial = serialDesign && !sameAsCandidate ? series(serialDesign, o.count, opponent, o.count, o) : null;

  const budgetCount = Math.max(1, Math.min(8, Math.round((o.count * opponentCost) / Math.max(1, candidateCost))));
  const equalBudget = budgetCount !== o.count ? series(candidate, budgetCount, opponent, o.count, o) : null;

  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    key: trialKey(candidate, opponent, o.plan, serialDesign),
    opponent,
    opponentSource,
    opponentCount: o.count,
    candidate: cand,
    serial,
    equalBudget,
    candidateCost,
    opponentCost,
    computeMs: Math.round(ended - started),
  };
}

/** One-line verdict for chat and voice. */
export function trialVerdict(r: TrialReport): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const parts = [`Стенд: «${r.candidate.design.name}» против «${r.opponent.name}» — побед ${pct(r.candidate.winRate)}`];
  if (r.serial) {
    const diff = r.candidate.winRate - r.serial.winRate;
    parts.push(
      Math.abs(diff) < 0.1
        ? `на уровне текущей серии (${pct(r.serial.winRate)})`
        : diff > 0
          ? `лучше текущей серии (${pct(r.serial.winRate)})`
          : `хуже текущей серии (${pct(r.serial.winRate)})`,
    );
  }
  if (r.equalBudget) {
    parts.push(`на равный бюджет (${r.equalBudget.count} против ${r.opponentCount}) — ${pct(r.equalBudget.winRate)}`);
  }
  return `${parts.join(', ')}.`;
}

function spawnSquad(arena: GameState, team: Team, design: RobotDesign, count: number, x: number, cy: number) {
  const dir = team === 'player' ? 1 : -1;
  const perRow = 4;
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const col = i % perRow;
    const y = cy + (col - (inRow - 1) / 2) * 3.4;
    arena.spawnCombatBot(team, { x: x - dir * row * 3.4, y }, design, 1);
  }
  for (const u of arena.units) {
    if (u.team !== team || u.kind !== 'combat') continue;
    u.committed = true;
    u.lane = (u.pos.y - cy) / 17;
  }
}

function alive(arena: GameState, team: Team): number {
  let n = 0;
  for (const u of arena.units) if (u.team === team && u.kind === 'combat' && u.state !== 'dead') n++;
  return n;
}

function squadHp(arena: GameState, team: Team): number {
  let hp = 0;
  for (const u of arena.units) if (u.team === team && u.kind === 'combat' && u.state !== 'dead') hp += Math.max(0, (u as CombatUnit).hp);
  return hp;
}

/** Deterministic Math.random for the duration of fn (mulberry32). */
function withSeededRandom<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}
