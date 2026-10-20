import { CalculatedRobotStats, RobotDesign, WeaponKind } from './robot';

export type Team = 'player' | 'enemy';

export interface Vector2D {
  x: number;
  y: number;
}

export type UnitState =
  | 'idle'
  | 'moving'
  | 'attacking'
  | 'deploying'
  | 'harvesting'
  | 'delivering'
  | 'retreating'
  | 'repairing'
  | 'dead';

export interface UnitBase {
  id: string;
  team: Team;
  pos: Vector2D;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  state: UnitState;
  facing: number; // radians, 0 = +x
  vel: number;    // current scalar speed (acceleration model)
  lastDamagedAt: number;
  /** route around trees and rocks (absent on an open field or while the way is straight) */
  nav?: UnitNav;
}

/** Per-unit navigation state: the planned detour and a stuck detector. */
export interface UnitNav {
  goal: Vector2D;
  /** waypoints of the detour; null while the goal is in a straight, clear line */
  path: Vector2D[] | null;
  idx: number;
  /** next time the straight line / route is re-checked */
  recheckAt: number;
  plannedAt: number;
  stuckPos: Vector2D;
  stuckAt: number;
  lastSteerAt: number;
}

export interface CombatUnit extends UnitBase {
  kind: 'combat';
  design: RobotDesign;
  stats: CalculatedRobotStats;
  targetId: string | null;
  cooldown: number;
  heat: number;
  isOverheated: boolean;
  deployTimer: number;
  kills: number;
  batchNumber: number;
  lane: number; // -1..1 lateral offset so the army spreads into a line
  /** joined an assault wave (until then the unit gathers at the rally point) */
  committed: boolean;
  /** a campaign garrison: guards its HQ for the whole match and never joins a wave */
  garrison?: boolean;
  rallySince: number;
  lastShotAt: number;
}

export interface HarvesterUnit extends UnitBase {
  kind: 'harvester';
  carrying: number;
  capacity: number;
  targetId: string | null;
  targetType: 'ore' | 'scrap' | null;
}

export type GameUnit = CombatUnit | HarvesterUnit;

export type BuildingType = 'command_center' | 'factory' | 'power_plant';

export interface ProductionJob {
  design: RobotDesign;
  stats: CalculatedRobotStats;
  progressSec: number;
  unitTimeSec: number;
  batchSize: number;
  remaining: number;
  batchNumber: number;
  /** the current unit has been paid for (payment happens when its assembly starts) */
  unitPaid: boolean;
}

export interface Building {
  id: string;
  team: Team;
  type: BuildingType;
  pos: Vector2D;
  hp: number;
  maxHp: number;
  radius: number;
  job: ProductionJob | null;
  /** harvester being assembled at this factory (takes priority over the combat batch between units) */
  harvesterBuild: { progressSec: number; totalSec: number } | null;
  /** production stopped by the player: no spending, no power draw, progress frozen */
  paused: boolean;
  /** 0..1 while under construction, 1 when operational */
  built: number;
  buildTimeSec: number;
  turretCooldown: number;
  lastDamagedAt: number;
}

export interface ResourcePatch {
  id: string;
  pos: Vector2D;
  metalRemaining: number;
  maxMetal: number;
  radius: number;
  zone: 'player_safe' | 'enemy_safe' | 'contested';
}

export interface ScrapWreckage {
  id: string;
  pos: Vector2D;
  metal: number;
  createdAt: number;
}

export interface Projectile {
  id: string;
  team: Team;
  sourceId: string;
  targetId: string;
  from: Vector2D;
  to: Vector2D;
  pos: Vector2D;
  progress: number; // 0 to 1
  speed: number;
  damage: number;
  kind: WeaponKind | 'turret';
  splash: number;
  armorPierce: number;
}

/** One-shot visual effects consumed by the renderer. */
export interface VisualEffect {
  id: number;
  type: 'muzzle' | 'hit' | 'explosion' | 'big_explosion' | 'melee' | 'build_complete';
  pos: Vector2D;
  team: Team | 'neutral';
  size: number;
  time: number;
}

export interface TeamEconomy {
  metal: number;
  components: number;
  powerCapacity: number;
  powerDemand: number;
  powerEfficiency: number; // 0..1
  componentReserve: number;
  fabricatorActive: boolean;
  batchSize: number;
  miningRatePerMin: number;
  totals: {
    metalMined: number;
    scrapReclaimed: number;
    componentsMade: number;
    unitsBuilt: number;
    unitsLost: number;
    kills: number;
    harvestersLost: number;
  };
}

export type Stance = 'advance' | 'hold_center' | 'defend_base' | 'raid_economy';
export type EngagementRange = 'max_range' | 'balanced' | 'close_brawl';
export type TargetPriority = 'closest' | 'high_threat_heavies' | 'scouts_harvesters' | 'focus_fire' | 'buildings';

/** Tactical plan produced by a combat-control agent and executed by the game AI. */
export interface TacticalPlan {
  stance: Stance;
  engagementRange: EngagementRange;
  targetPriority: TargetPriority;
  retreatHpThreshold: number; // 0..60 %
  guardHarvesters: boolean;
  summaryRu: string;
  source: 'default' | 'player' | 'agent' | 'fallback';
  updatedAt: number;
}

export interface TeamState {
  team: Team;
  economy: TeamEconomy;
  design: RobotDesign;
  plan: TacticalPlan;
  batchCounter: number;
  designsFielded: string[];
  /** harvesters ordered (already paid) and waiting for a free factory */
  harvesterQueue: number;
}

export type GameEventType =
  | 'kill'
  | 'loss'
  | 'batch_started'
  | 'batch_complete'
  | 'base_attack'
  | 'harvester_attacked'
  | 'design_changed'
  | 'enemy_new_design'
  | 'build_complete'
  | 'power_shortage'
  | 'heavy_losses'
  | 'ai'
  | 'intercept'
  | 'warning'
  | 'info';

export interface GameEvent {
  id: number;
  team: Team | 'neutral';
  type: GameEventType;
  text: string;
  time: number;
  /** significant events can trigger an autonomous agent re-plan (brief §10) */
  significant: boolean;
}

export type ProductionAction =
  | { type: 'build_harvester'; count: number }
  | { type: 'build_power_plant' }
  | { type: 'build_factory' }
  | { type: 'set_batch_size'; size: number }
  | { type: 'set_component_reserve'; amount: number }
  | { type: 'set_production'; paused: boolean };

export interface ArmySummary {
  combatUnits: number;
  harvesters: number;
  avgHpPct: number;
  byRole: Record<string, number>;
  frontX: number | null; // furthest advance along the x axis
  designs: { name: string; count: number }[];
}
