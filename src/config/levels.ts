import { MapSpec } from '../engine/terrain/MapGenerator';
import { PadBuildingType } from '../types/game';
import { ChassisType } from '../types/robot';

/** How the enemy general plays: the rule-based AI follows it and the LLM gets it as a line of its report. */
export type Doctrine = 'balanced' | 'defensive' | 'aggressive';

/** The enemy's edge on a level. The player's side never changes: difficulty comes from the enemy and the map. */
export interface EnemyModifiers {
  /** multiplier on the metal its harvesters bring home (ore and scrap) */
  incomeMul: number;
  /** chassis its designs may use; others are downgraded to the heaviest allowed one */
  chassis: ChassisType[];
  /** a second factory from the start */
  extraFactory?: boolean;
  /** harvesters on top of the usual two */
  extraHarvesters?: number;
  /** combat robots of its starting design guarding the HQ for the whole match (they never join a wave) */
  garrison?: number;
  /** HQ durability multiplier */
  hqHpMul?: number;
  /** ready pad buildings at its base from the start */
  fortifications?: PadBuildingType[];
}

export interface LevelConfig {
  /** 1-based level number */
  n: number;
  /** key of the level's name and description in the dictionaries */
  id: LevelId;
  map: MapSpec;
  enemy: EnemyModifiers;
  doctrine: Doctrine;
}

export type LevelId = 'polygon' | 'copse' | 'marsh' | 'thicket' | 'gorge' | 'fortress' | 'laststand' | 'endless';

const ALL_CHASSIS: ChassisType[] = ['light_biped', 'medium_tracked', 'heavy_quad'];

/** Bands of forest that split the middle of the map into north, centre and south corridors. */
const CORRIDORS: MapSpec['bands'] = [
  { y: 21, x0: 37, x1: 62, thickness: 3 },
  { y: 39, x0: 37, x1: 62, thickness: 3 },
];

/** The enemy's fortress line: a wall of trees in front of its base with one gate at the rally point. */
const FORTRESS_LINE: MapSpec['fortress'] = { x0: 64, x1: 66, gateY: 30, gate: 10 };

/**
 * The campaign. Each level adds one new thing and a stronger enemy. Numbers are tuned with headless
 * matches where the rule-based commander plays teal (tests/campaign.test.ts): it wins nearly every
 * match on level 1 and about one in ten on level 7. Economy and the garrison are gentle levers; an
 * extra harvester or factory from the start snowballs, so the campaign does not use them early.
 */
export const CAMPAIGN: LevelConfig[] = [
  {
    n: 1,
    id: 'polygon',
    map: { id: 'polygon', seed: 101, groves: 3, groveSize: [3, 4.5], ridges: 0, swamps: 0, symmetric: true },
    enemy: { incomeMul: 0.7, chassis: ['light_biped'] },
    doctrine: 'balanced',
  },
  {
    n: 2,
    id: 'copse',
    map: { id: 'copse', seed: 202, groves: 4, groveSize: [3, 4.5], ridges: 1, swamps: 0, symmetric: true, bands: CORRIDORS },
    enemy: { incomeMul: 0.85, chassis: ['light_biped', 'medium_tracked'] },
    doctrine: 'balanced',
  },
  {
    n: 3,
    id: 'marsh',
    map: { id: 'marsh', seed: 303, groves: 5, groveSize: [3.5, 5.5], ridges: 1, swamps: 2, symmetric: true, centerSwamp: 9 },
    enemy: { incomeMul: 0.95, chassis: ['light_biped', 'medium_tracked'] },
    doctrine: 'balanced',
  },
  {
    n: 4,
    id: 'thicket',
    map: { id: 'thicket', seed: 404, groves: 12, groveSize: [4.5, 7], ridges: 1, swamps: 1, symmetric: true },
    enemy: { incomeMul: 1.0, chassis: ALL_CHASSIS },
    doctrine: 'balanced',
  },
  {
    n: 5,
    id: 'gorge',
    map: { id: 'gorge', seed: 505, groves: 6, groveSize: [3.5, 5.5], ridges: 5, swamps: 0, symmetric: true, fortress: FORTRESS_LINE },
    enemy: { incomeMul: 1.1, chassis: ALL_CHASSIS, garrison: 2 },
    doctrine: 'defensive',
  },
  {
    n: 6,
    id: 'fortress',
    map: { id: 'fortress', seed: 606, groves: 8, groveSize: [4, 6], ridges: 2, swamps: 1, symmetric: true, fortress: FORTRESS_LINE },
    enemy: { incomeMul: 1.05, chassis: ALL_CHASSIS, hqHpMul: 1.25, fortifications: ['artillery'] },
    doctrine: 'balanced',
  },
  {
    n: 7,
    id: 'laststand',
    map: { id: 'laststand', seed: 707, groves: 10, groveSize: [4, 6.5], ridges: 3, swamps: 2, symmetric: false },
    enemy: { incomeMul: 1.15, chassis: ALL_CHASSIS, garrison: 3, hqHpMul: 1.25 },
    doctrine: 'aggressive',
  },
];

/** From this level on the campaign is endless: a new map every time and a stronger enemy. */
export const ENDLESS_FROM = CAMPAIGN.length + 1;

/** The level config; levels past the campaign are generated (endless mode). */
export function levelConfig(n: number): LevelConfig {
  const level = Math.max(1, Math.floor(n));
  if (level < ENDLESS_FROM) return CAMPAIGN[level - 1];
  const k = level - ENDLESS_FROM + 1;
  return {
    n: level,
    id: 'endless',
    map: {
      id: `endless${level}`,
      seed: 1000 + level * 7919,
      groves: 8 + (level % 5),
      groveSize: [4, 6.5],
      ridges: 1 + (level % 4),
      swamps: level % 3,
      symmetric: level % 2 === 0,
      ...(level % 3 === 0 ? { fortress: FORTRESS_LINE } : {}),
    },
    enemy: {
      // +5% economy per level past the campaign; a second factory from the fourth endless level
      incomeMul: Math.round(1.15 * (1 + 0.05 * k) * 100) / 100,
      chassis: ALL_CHASSIS,
      extraHarvesters: 1,
      garrison: Math.min(8, 2 + Math.floor(k / 2)),
      hqHpMul: Math.min(1.5, 1 + 0.1 * k),
      ...(k >= 4 ? { extraFactory: true } : {}),
    },
    doctrine: 'aggressive',
  };
}

/** Doctrine line for the enemy general's report, in the prompt language. */
export const DOCTRINE_TEXT: Record<Doctrine, { ru: string; en: string }> = {
  balanced: {
    ru: 'играй сбалансированно: держи центр и наступай, когда армия сильнее',
    en: 'play a balanced game: hold the centre and push when your army is stronger',
  },
  defensive: {
    ru: 'твоя база прикрыта лесом: обороняйся, копи армию и контратакуй, когда противник выдохнется',
    en: 'your base is behind a forest wall: defend, build up and counter-attack once the enemy is spent',
  },
  aggressive: {
    ru: 'атакуй рано и постоянно, не давай противнику развернуть экономику',
    en: 'attack early and keep attacking, do not let the enemy grow its economy',
  },
};
