import { RobotDesign } from '../types/robot';
import { Team, Vector2D } from '../types/game';

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
};

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
