import { CalculatedRobotStats, RobotDesign } from './robot';

export type Team = 'player' | 'enemy';

export interface Vector2D {
  x: number;
  y: number;
}

export interface UnitBase {
  id: string;
  team: Team;
  pos: Vector2D;
  targetPos: Vector2D | null;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  state: 'idle' | 'moving' | 'attacking' | 'harvesting' | 'delivering' | 'dead';
}

export interface CombatUnit extends UnitBase {
  kind: 'combat';
  design: RobotDesign;
  stats: CalculatedRobotStats;
  targetUnitId: string | null;
  lastShotTime: number;
  currentHeat: number;
  isOverheated: boolean;
  kills: number;
  batchNumber: number;
}

export interface HarvesterUnit extends UnitBase {
  kind: 'harvester';
  carryingMetal: number;
  maxCarryCapacity: number;
  harvestTargetId: string | null;
  targetType: 'ore' | 'scrap' | null;
}

export type GameUnit = CombatUnit | HarvesterUnit;

export interface Building {
  id: string;
  team: Team;
  type: 'command_center' | 'factory' | 'power_plant';
  pos: Vector2D;
  hp: number;
  maxHp: number;
  radius: number;
  productionQueue: {
    design: RobotDesign;
    stats: CalculatedRobotStats;
    progressSec: number;
    totalTimeSec: number;
    batchSize: number;
    batchRemaining: number;
  } | null;
}

export interface ResourcePatch {
  id: string;
  pos: Vector2D;
  metalRemaining: number;
  maxMetal: number;
  radius: number;
}

export interface ScrapWreckage {
  id: string;
  pos: Vector2D;
  metalAmount: number;
  sourceDesignName: string;
  createdAt: number;
}

export interface Projectile {
  id: string;
  sourceId: string;
  targetId: string;
  team: Team;
  startPos: Vector2D;
  currentPos: Vector2D;
  targetPos: Vector2D;
  speed: number;
  damage: number;
  type: 'kinetic' | 'energy' | 'explosive' | 'melee';
  progress: number; // 0 to 1
}

export interface TeamEconomy {
  metal: number;
  components: number;
  powerAvailable: number; // Current generation in kW
  powerConsumed: number;  // Current usage in kW
  harvestersCount: number;
  combatBotsCount: number;
  totalMetalMined: number;
  totalScrapReclaimed: number;
}

export interface TacticalDoctrine {
  engagementRange: 'max_range' | 'balanced' | 'close_brawl';
  targetPriority: 'closest' | 'high_threat_heavies' | 'scouts_harvesters' | 'focus_fire';
  retreatHpThreshold: number; // 0 to 50%
}

export interface AICoinTelemetry {
  coinBalance: number;
  coinsSpentTotal: number;
  matchLimit: number;
  totalTokensIn: number;
  totalTokensOut: number;
  asrSecondsTotal: number;
  ttsSecondsTotal: number;
  lastRequestLatencyMs: number;
  requestsCount: number;
}
