export type ChassisType = 'light_biped' | 'medium_tracked' | 'heavy_quad';

export type ModuleCategory = 'armor' | 'weapon' | 'engine' | 'utility';

export type WeaponKind = 'kinetic' | 'energy' | 'explosive' | 'melee';

export type TacticalRole = 'frontline' | 'skirmisher' | 'artillery' | 'anti_armor' | 'balanced';

export interface RobotModule {
  id: string;
  name: string;
  category: ModuleCategory;
  mass: number;         // kg
  powerDraw: number;    // kW (positive = consumes, negative = generates)
  heatGen: number;      // heat generated per sec while the module works (firing / moving)
  heatDissipation: number; // heat dissipated per sec
  metalCost: number;
  componentCost: number;
  /** crystals, charged only on maps with crystals */
  crystalCost?: number;
  /** 2 — an advanced part: on late campaign levels it needs a laboratory */
  tier?: 2;
  buildTimeSec: number;

  // Specific stat bonuses
  armorRating?: number;     // damage reduction share
  hpBonus?: number;         // extra health points
  weaponDamage?: number;    // damage per shot
  weaponRange?: number;     // meters
  weaponFireRate?: number;  // shots per second
  weaponType?: WeaponKind;
  weaponRecoil?: number;    // kickback strain on chassis
  requiresDeploy?: boolean; // must stop and deploy before firing
  splashRadius?: number;    // explosive area damage
  armorPierce?: number;     // share of target armor ignored
  speedMultiplier?: number; // modifier on mobility
  accelBonus?: number;      // extra acceleration
  powerOutput?: number;     // generator capacity
  rangeMultiplier?: number; // sensor bonus
}

export interface ChassisConfig {
  id: ChassisType;
  name: string;
  baseHp: number;
  baseMass: number;
  maxMass: number;
  maxSlots: number;
  basePowerOutput: number;
  baseSpeed: number;
  baseAccel: number;
  recoilResistance: number;
  metalCost: number;
  componentCost: number;
  /** crystals, charged only on maps with crystals */
  crystalCost?: number;
  buildTimeSec: number;
}

export interface RobotDesign {
  id: string;
  name: string;
  chassisId: ChassisType;
  modules: string[]; // module IDs
  color: string;
  version: number;
  createdAt: number;
  tacticalRole: TacticalRole;
}

export interface CalculatedRobotStats {
  hp: number;
  mass: number;
  maxMass: number;
  slotsUsed: number;
  maxSlots: number;
  speed: number;
  effectiveSpeed: number;
  accel: number;
  powerDraw: number;
  powerOutput: number;
  isPowerSurplus: boolean;
  heatGenFiring: number;      // heat per second while firing
  heatDissipation: number;    // heat removed per second
  heatDissipationNet: number; // >0 means it cools down while firing, <0 means it overheats
  dps: number;
  effectiveRange: number;
  fireInterval: number;       // seconds between volleys
  volleyDamage: number;       // damage per volley
  weaponKind: WeaponKind | null;
  requiresDeploy: boolean;
  splashRadius: number;
  armorPierce: number;
  armorRating: number;
  recoilStability: number; // 0..1, 1 is perfectly stable
  /** recoil makes the platform unusable (one of the validation errors) */
  recoilUnstable: boolean;
  metalCost: number;
  componentCost: number;
  /** crystals the robot costs where the map has crystals */
  crystalCost: number;
  /** advanced (tier 2) parts in the design: on late levels they need a laboratory */
  labParts: string[];
  buildTimeSec: number;
  isValid: boolean;
  validationErrors: string[];
  tradeoffsSummaryRu: string;
}

/** 0..1 normalised bars shown in the constructor panel (Броня / Мощь / Скорость / Дальность). */
export interface DesignBars {
  armor: number;
  power: number;
  speed: number;
  range: number;
}
