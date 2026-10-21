import { RobotDesign } from '../types/robot';
import { Pad, PadBuildingType, Team, Vector2D } from '../types/game';
import { t } from '../i18n';

export const GAME_BALANCE = {
  // Map dimensions (world units). Player base on the left, enemy on the right.
  MAP_WIDTH: 100,
  MAP_HEIGHT: 60,
  FRONTLINE_CENTER_X: 50,

  // Starting resources
  INITIAL_METAL: 650,
  INITIAL_COMPONENTS: 220,

  // Base buildings
  COMMAND_CENTER_HP: 6000,
  FACTORY_HP: 1500,
  POWER_PLANT_HP: 900,
  HQ_BUILTIN_POWER_KW: 100,
  POWER_PLANT_KW: 300,
  POWER_PLANT_COST_METAL: 150,
  POWER_PLANT_BUILD_SEC: 14,
  FACTORY_COST_METAL: 300,
  FACTORY_COST_COMPONENTS: 60,
  FACTORY_BUILD_SEC: 24,
  MAX_FACTORIES: 2,
  MAX_POWER_PLANTS: 3,

  // Construction by harvesters: a building rises only while a harvester works at the site, and
  // that harvester does not mine meanwhile. Power does not matter (a base without power must be
  // able to build a power plant).
  MAX_ACTIVE_SITES: 2, // more sites wait in a queue for a worker
  SECOND_WORKER_BONUS: 0.6, // two workers build 1.6× as fast
  SITE_CANCEL_REFUND: 0.75,
  SITE_REACH: 1.2, // a worker this close to the site's edge is at work

  // HQ self-defence turret (prevents instant loss to a single early rush)
  HQ_TURRET_RANGE: 16.5, // +10% (was 15)
  HQ_TURRET_DAMAGE: 36, // +20% (was 30): ~51 DPS at the 0.7 s interval
  HQ_TURRET_INTERVAL: 0.7,

  // Base power consumers (kW). When demand exceeds capacity every consumer slows down.
  POWER_FACTORY_KW: 120,
  POWER_FABRICATOR_KW: 70,
  POWER_HARVESTER_KW: 15,
  POWER_REPAIR_KW: 60,

  // Components fabricator at HQ: metal -> components
  FABRICATOR_RATE_PER_SEC: 4, // components per second at 100% power
  FABRICATOR_METAL_PER_COMPONENT: 2,
  FABRICATOR_MIN_METAL_RESERVE: 120,
  DEFAULT_COMPONENT_RESERVE: 180,

  // Repair bay around HQ
  REPAIR_RADIUS: 9,
  REPAIR_HP_PER_SEC: 18,

  // Mining & Scrap
  HARVESTER_MAX_CARRY: 50,
  HARVEST_RATE_PER_SEC: 14,
  HARVESTER_SPEED: 5.0,
  HARVESTER_COST_METAL: 60,
  HARVESTER_BUILD_SEC: 7, // assembled at a factory, competing with the combat batch for factory time
  // With no factory left the HQ's emergency bay assembles harvesters, twice as slow — otherwise
  // losing the factory and the miners would make recovery impossible (brief §9).
  HQ_EMERGENCY_HARVESTER_FACTOR: 2,
  HARVESTER_HP: 160,
  SCRAP_SALVAGE_PERCENT: 0.4, // 40% of destroyed bot metal drops as scrap
  SCRAP_DECAY_TIME_SEC: 150,

  // Production pacing
  BATCH_SIZE_DEFAULT: 3,
  BATCH_SIZE_MIN: 1,
  BATCH_SIZE_MAX: 5,
  MAX_ACTIVE_COMBAT_BOTS: 30,
  MAX_HARVESTERS: 8,

  // Combat
  OVERHEAT_THRESHOLD: 100,
  OVERHEAT_RECOVER: 40,
  DEPLOY_TIME_SEC: 1.2,
  AGGRO_EXTRA_RANGE: 9,
  BUILDING_ARMOR: 0.4,
  // Assault waves: units gather at a rally line and push together ("стенка на стенку")
  RALLY_X_OFFSET: 14, // distance from the centre line toward the own base
  WAVE_MIN_SIZE: 4,
  WAVE_MAX_SIZE: 9,
  WAVE_MAX_WAIT_SEC: 35,

  // Design test bench (brief §9): free in AI coins — it is a game simulation, not inference —
  // but it costs game time: the verdict arrives after the bench run, so testing trades tempo for information.
  TRIAL_BENCH_SEC: 5,
  TRIAL_SQUAD_SIZE: 4,

  // AI decision pacing — identical for both participants (brief §10: no pay-to-win).
  /** AI commanders' full strategic decision (design, economy, plan) on a timer */
  AI_COMMANDER_HEARTBEAT_SEC: 30,
  /** significant battle events trigger a quick plan-only re-plan, no more often than this per side */
  AI_EVENT_REPLAN_COOLDOWN_SEC: 8,
  /** a burst of events (an attack raises several) is gathered this long and sent as one call */
  AI_EVENT_BATCH_SEC: 1,
  AI_PLAYER_ORDER_COOLDOWN_SEC: 2,
  AI_FIRST_ENEMY_DECISION_SEC: 18,

  // Base-defence reflex of the game AI (no LLM): while our buildings take fire, machines near
  // home go for the attacker without waiting for the commander's re-plan.
  BASE_ALERT_SEC: 4,
  BASE_THREAT_RADIUS: 30, // attackers this close to the HQ count as a raid on the base
  BASE_DEFENSE_RECALL_RADIUS: 32, // machines this close to the HQ respond (covers the rally point)

  // An agent's building or harvester order the side cannot pay for yet waits in a short queue
  // and runs once resources allow, instead of being refused (the UI buttons still refuse at once).
  ORDER_QUEUE_MAX: 3,
  ORDER_QUEUE_TTL_SEC: 60,
};

/** Pad buildings (stage 2 of development): what they cost, do and when the campaign opens them. */
export interface PadBuildingSpec {
  hp: number;
  radius: number;
  buildSec: number;
  metal: number;
  components: number;
  /** constant base power draw once built, kW (the repair dock draws only while repairing) */
  powerKw: number;
  maxCount: number;
  /** campaign level from which both sides may build it */
  unlockLevel: number;
  /** forward pads only (the drop-off point) */
  forwardOnly?: boolean;
  /** crystals, charged only on maps with crystals */
  crystals?: number;
}

export const PAD_BUILDINGS: Record<PadBuildingType, PadBuildingSpec> = {
  turret: { hp: 900, radius: 1.8, buildSec: 12, metal: 120, components: 30, powerKw: 20, maxCount: 6, unlockLevel: 2 },
  repair_dock: { hp: 1000, radius: 2.6, buildSec: 16, metal: 140, components: 20, powerKw: 0, maxCount: 2, unlockLevel: 3 },
  radar: { hp: 700, radius: 2.2, buildSec: 18, metal: 160, components: 60, crystals: 20, powerKw: 40, maxCount: 1, unlockLevel: 4 },
  depot: { hp: 900, radius: 2.8, buildSec: 18, metal: 180, components: 0, powerKw: 10, maxCount: 2, unlockLevel: 5, forwardOnly: true },
  lab: { hp: 1200, radius: 2.8, buildSec: 30, metal: 250, components: 80, crystals: 40, powerKw: 50, maxCount: 1, unlockLevel: 6 },
  artillery: { hp: 1000, radius: 2.0, buildSec: 20, metal: 220, components: 60, crystals: 30, powerKw: 40, maxCount: 3, unlockLevel: 7 },
};

/** Rare crystals: from this campaign level on, two deposits in the middle of the map. */
export const CRYSTAL = {
  FROM_LEVEL: 4,
  CARRY: 25, // per trip (metal: 50)
  RATE_MUL: 0.5, // mined at half the metal rate
  DEFAULT_RESERVE: 60,
  DEPOSIT: 1500,
};

/** From this campaign level on, advanced (tier 2) parts need a laboratory. */
export const LAB_FROM_LEVEL = 6;

/** Artillery turret: lobs shells over the forest at targets its side spots. */
export const ARTILLERY = {
  RANGE: 28,
  MIN_RANGE: 5,
  DAMAGE: 75,
  INTERVAL: 3,
  SPLASH: 2.5,
  ARMOR_PIERCE: 0.1,
};

export const TURRET = {
  RANGE: 15,
  DAMAGE: 21, // every 0.6 s: ~35 DPS
  INTERVAL: 0.6,
  ARMOR_PIERCE: 0.2,
};

export const REPAIR_DOCK = {
  RADIUS: 6,
  HP_PER_SEC: 25,
};

export const RADAR_SIGHT = 40;

/** Building pads of the player's side (the enemy's are mirrored): 8 around the base, 3 forward. */
const PLAYER_PADS: Omit<Pad, 'id' | 'team'>[] = [
  { pos: { x: 24, y: 30 }, kind: 'base' },
  { pos: { x: 27, y: 23 }, kind: 'base' },
  { pos: { x: 27, y: 37 }, kind: 'base' },
  { pos: { x: 11, y: 21 }, kind: 'base' },
  { pos: { x: 13, y: 13 }, kind: 'base' },
  { pos: { x: 14, y: 48 }, kind: 'base' },
  { pos: { x: 31, y: 15 }, kind: 'base' },
  { pos: { x: 31, y: 45 }, kind: 'base' },
  { pos: { x: 41, y: 15 }, kind: 'forward', flank: 'north' },
  { pos: { x: 41, y: 30 }, kind: 'forward', flank: 'center' },
  { pos: { x: 41, y: 45 }, kind: 'forward', flank: 'south' },
];

export function padSlots(team: Team): Pad[] {
  return PLAYER_PADS.map((p, i) => ({
    ...p,
    id: `pad_${team}_${i}`,
    team,
    pos: team === 'player' ? { ...p.pos } : { x: GAME_BALANCE.MAP_WIDTH - p.pos.x, y: p.pos.y },
  }));
}

/** A team's starting design with its name in the game language. */
export function initialDesign(team: Team): RobotDesign {
  return team === 'enemy'
    ? { ...INITIAL_ENEMY_DESIGN, name: t('design.enemyInitial') }
    : { ...INITIAL_PLAYER_DESIGN, name: t('design.playerInitial') };
}

/** Fixed building slots per team (mirrored for the enemy). */
const PLAYER_SLOTS = {
  command_center: { x: 10, y: 30 },
  factory: [{ x: 18, y: 21 }, { x: 19, y: 39 }],
  power_plant: [{ x: 8, y: 42 }, { x: 4, y: 20 }, { x: 4, y: 33 }],
};

export function buildingSlot(team: Team, type: 'command_center'): Vector2D;
export function buildingSlot(team: Team, type: 'factory' | 'power_plant', index: number): Vector2D;
export function buildingSlot(team: Team, type: 'command_center' | 'factory' | 'power_plant', index = 0): Vector2D {
  const p = type === 'command_center' ? PLAYER_SLOTS.command_center : PLAYER_SLOTS[type][index];
  return team === 'player' ? { ...p } : { x: GAME_BALANCE.MAP_WIDTH - p.x, y: p.y };
}

export const MAX_SLOTS = {
  factory: PLAYER_SLOTS.factory.length,
  power_plant: PLAYER_SLOTS.power_plant.length,
};

// Initial Player Bot: cheap light scout with an autocannon
export const INITIAL_PLAYER_DESIGN: RobotDesign = {
  id: 'player_mk1',
  name: 'Вектор Mk-I',
  chassisId: 'light_biped',
  modules: ['light_composite', 'autocannon_20mm'],
  color: '#14b8a6',
  version: 1,
  createdAt: 0,
  tacticalRole: 'frontline',
};

// Initial Enemy Bot: mirror match to keep the first clash fair
export const INITIAL_ENEMY_DESIGN: RobotDesign = {
  id: 'enemy_mk1',
  name: 'Ржавый Шакал Mk-I',
  chassisId: 'light_biped',
  modules: ['light_composite', 'autocannon_20mm'],
  color: '#f97316',
  version: 1,
  createdAt: 0,
  tacticalRole: 'frontline',
};

export const TEAM_COLORS: Record<Team, { main: string; dark: string; glow: string; light: string }> = {
  player: { main: '#14b8a6', dark: '#0f766e', glow: '#5eead4', light: '#99f6e4' },
  enemy: { main: '#f97316', dark: '#c2410c', glow: '#fdba74', light: '#fed7aa' },
};
