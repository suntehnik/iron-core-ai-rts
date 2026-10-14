import { RobotDesign } from '../types/robot';

export const GAME_BALANCE = {
  // Map dimensions (world units)
  MAP_WIDTH: 100,
  MAP_HEIGHT: 60,
  FRONTLINE_CENTER_X: 50,

  // Starting resources
  INITIAL_METAL: 450,
  INITIAL_COMPONENTS: 150,
  INITIAL_COINS: 100, // AI Coins for inference
  AI_COIN_LIMIT_DEFAULT: 500,

  // Base buildings
  COMMAND_CENTER_HP: 2500,
  FACTORY_HP: 1400,
  POWER_PLANT_HP: 900,
  POWER_PLANT_KW: 350, // kW generated per plant

  // Mining & Scrap
  HARVESTER_MAX_CARRY: 50,
  HARVEST_RATE_PER_SEC: 12,
  HARVESTER_SPEED: 4.2,
  HARVESTER_COST_METAL: 60,
  HARVESTER_HP: 120,
  SCRAP_SALVAGE_PERCENT: 0.4, // 40% of destroyed bot metal drops as scrap
  SCRAP_DECAY_TIME_SEC: 120,

  // Combat pacing
  BATCH_SIZE_DEFAULT: 3, // robots per factory batch
  MAX_ACTIVE_COMBAT_BOTS: 25,
  MAX_HARVESTERS: 6,

  // Costs in AI coins
  AI_COSTS: {
    ENGINEER_REDESIGN_BASE: 5,
    TACTICAL_COMMAND_BASE: 3,
    ASR_PER_SECOND: 0.5,
    TTS_PER_SECOND: 0.8,
  }
};

// Initial Player Bot: Balanced Light Scout
export const INITIAL_PLAYER_DESIGN: RobotDesign = {
  id: 'player_mk1',
  name: 'Вектор Mk-I',
  chassisId: 'light_biped',
  modules: ['light_composite', 'autocannon_20mm'],
  color: '#3b82f6', // Blue
  version: 1,
  createdAt: 0,
  tacticalRole: 'frontline',
};

// Initial Enemy Bot: Standard Skirmisher
export const INITIAL_ENEMY_DESIGN: RobotDesign = {
  id: 'enemy_mk1',
  name: 'Красный Шакал Mk-I',
  chassisId: 'light_biped',
  modules: ['light_composite', 'autocannon_20mm'],
  color: '#ef4444', // Red
  version: 1,
  createdAt: 0,
  tacticalRole: 'frontline',
};
