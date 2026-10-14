export type ChassisType = 'light_biped' | 'medium_tracked' | 'heavy_quad';

export type ModuleCategory = 'armor' | 'weapon' | 'engine' | 'utility';

export interface RobotModule {
  id: string;
  name: string;
  nameRu: string;
  category: ModuleCategory;
  mass: number;         // kg
  powerDraw: number;    // kW (positive = consumes, negative = generates)
  heatGen: number;      // heat generated per sec during action
  heatDissipation: number; // heat dissipated per sec
  metalCost: number;
  componentCost: number;
  buildTimeSec: number;
  descriptionRu: string;

  // Specific stat bonuses
  armorRating?: number;     // damage reduction %
  hpBonus?: number;         // extra health points
  weaponDamage?: number;    // damage per shot
  weaponRange?: number;     // meters
  weaponFireRate?: number;  // shots per second
  weaponType?: 'kinetic' | 'energy' | 'explosive' | 'melee';
  weaponRecoil?: number;    // kickback strain on chassis
  speedMultiplier?: number; // modifier on mobility
  powerOutput?: number;     // generator capacity
  salvageBonus?: number;    // % faster scrap harvesting
}

export interface ChassisConfig {
  id: ChassisType;
  name: string;
  nameRu: string;
  baseHp: number;
  maxMass: number;
  maxSlots: number;
  basePowerOutput: number;
  baseSpeed: number;
  recoilResistance: number;
  metalCost: number;
  buildTimeSec: number;
  descriptionRu: string;
}

export interface RobotDesign {
  id: string;
  name: string;
  chassisId: ChassisType;
  modules: string[]; // module IDs
  color: string;
  version: number;
  createdAt: number;
  tacticalRole: 'frontline' | 'skirmisher' | 'artillery' | 'anti_armor' | 'balanced';
}

export interface CalculatedRobotStats {
  hp: number;
  mass: number;
  maxMass: number;
  speed: number;
  effectiveSpeed: number;
  powerDraw: number;
  powerOutput: number;
  isPowerSurplus: boolean;
  heatDissipationNet: number; // >0 means it cools down easily, <0 means it overheats
  dps: number;
  effectiveRange: number;
  armorRating: number;
  recoilStability: number; // 0..1, 1 is perfectly stable
  metalCost: number;
  componentCost: number;
  buildTimeSec: number;
  isValid: boolean;
  validationErrors: string[];
  tradeoffsSummaryRu: string;
}
