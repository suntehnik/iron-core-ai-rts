import {
  GAME_BALANCE,
  initialDesign,
  MAX_SLOTS,
  buildingSlot,
} from '../config/balance';
import { CHASSIS_CATALOG, MODULES_CATALOG, chassisName, partName } from '../config/catalog';
import {
  ArmySummary,
  Building,
  BuildingType,
  CombatUnit,
  GameEvent,
  GameEventType,
  GameUnit,
  HarvesterUnit,
  ProductionAction,
  Projectile,
  ResourcePatch,
  ScrapWreckage,
  TacticalPlan,
  Team,
  TeamEconomy,
  TeamState,
  Vector2D,
  VisualEffect,
} from '../types/game';
import { ChassisType, RobotDesign } from '../types/robot';
import { Doctrine, EnemyModifiers, LevelConfig } from '../config/levels';
import { RobotBuilder, designSignature } from './RobotBuilder';
import { KeepOut, MapSpec, generateTerrain } from './terrain/MapGenerator';
import { Pathfinder } from './terrain/Pathfinding';
import { TerrainGrid } from './terrain/TerrainGrid';
import { EnemyIntel, Vision } from './Vision';
import { t as tr } from '../i18n';

export const DEFAULT_PLAN: TacticalPlan = {
  stance: 'advance',
  engagementRange: 'balanced',
  targetPriority: 'closest',
  retreatHpThreshold: 0,
  guardHarvesters: false,
  summaryRu: '', // set in the game language when a team is created
  source: 'default',
  updatedAt: 0,
};

export interface SoundSink {
  shot(kind: string, team: Team): void;
  explosion(big: boolean): void;
  batchReady(team: Team): void;
}

const noopSound: SoundSink = { shot() {}, explosion() {}, batchReady() {} };

export const opposite = (t: Team): Team => (t === 'player' ? 'enemy' : 'player');
const dist = (a: Vector2D, b: Vector2D) => Math.hypot(a.x - b.x, a.y - b.y);

/** A* searches allowed per simulation tick; units over the budget keep their old route a tick longer. */
const PATH_BUDGET_PER_TICK = 6;
/** Share of the body radius that may overlap trees while moving (the route itself keeps the full radius). */
const TERRAIN_COLLISION_SLACK = 0.6;
/** Bodies pushed closer than this share of their radius to trees or rocks are moved back out. */
const TERRAIN_PUSHOUT = 0.8;

/** Stable 0..0.4 s offset per unit so route re-checks of a whole wave do not land on one tick. */
function navJitter(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 100) / 250;
}

export class GameState {
  public teams: Record<Team, TeamState>;
  public units: GameUnit[] = [];
  public buildings: Building[] = [];
  public resourcePatches: ResourcePatch[] = [];
  public scrapPiles: ScrapWreckage[] = [];
  public projectiles: Projectile[] = [];
  /** Forest, rocks and swamp; a flat field unless a map spec was given. */
  public terrain: TerrainGrid;
  private pathfinder: Pathfinder;
  private pathBudget = 0;
  /** Fog of war: which enemy units each side sees now. */
  public readonly vision: Vision;
  /** Campaign level of this match (map and the enemy's edge); null for a plain map or the arena. */
  public readonly level: LevelConfig | null;
  /** Doctrine of a side's AI commander set by the level; null — no doctrine line, balanced play. */
  public doctrine: Record<Team, Doctrine | null> = { player: null, enemy: null };
  /** Multiplier on the metal a side's harvesters bring home (the enemy's economic edge on a level). */
  private incomeMul: Record<Team, number> = { player: 1, enemy: 1 };
  /** Chassis a side's designs may use (campaign levels restrict the enemy); null — any. */
  private allowedChassis: Record<Team, ChassisType[] | null> = { player: null, enemy: null };
  public effects: VisualEffect[] = [];
  public events: GameEvent[] = [];

  public gameTime = 0;
  public isPaused = false;
  public gameOver: 'player_won' | 'enemy_won' | null = null;
  /** Increments when a significant event concerns the team — agents watch this counter. */
  public significantCounter: Record<Team, number> = { player: 0, enemy: 0 };

  public sound: SoundSink = noopSound;

  private nextId = 1;
  private nextEventId = 1;
  private nextEffectId = 1;
  private lossTimes: Record<Team, number[]> = { player: [], enemy: [] };
  private throttle: Record<string, number> = {};
  /** Enemy designs each team has seen, by signature: a re-issued design with a new id or reordered parts is not new. */
  private seenDesigns: Record<Team, Set<string>> = { player: new Set(), enemy: new Set() };
  /** Last sighting of each enemy design: the scouting report agents get instead of the live enemy army. */
  private designIntel: Record<Team, Map<string, { design: RobotDesign; lastSeenAt: number; lastCount: number }>> = {
    player: new Map(),
    enemy: new Map(),
  };
  /** Reused by target acquisition (called for every machine every tick). */
  private candidates: { target: GameUnit | Building; score: number }[] = [];
  private sightingTimer = 0;
  private combatTick = 0;
  private minedWindow: Record<Team, { t: number; amount: number }[]> = { player: [], enemy: [] };

  /** Arena mode: an empty field without bases — used by the design test bench (DesignTrial). */
  public readonly arena: boolean;

  /**
   * `level` sets the map and gives the enemy the level's edge; with `fair` (AI vs AI) only the map is
   * used and both sides play by the same rules. `map` alone is a plain map without a level.
   */
  constructor(options: { arena?: boolean; map?: MapSpec; level?: LevelConfig; fair?: boolean } = {}) {
    this.arena = !!options.arena;
    this.level = options.arena ? null : (options.level ?? null);
    this.teams = {
      player: this.createTeam('player', initialDesign('player')),
      enemy: this.createTeam('enemy', initialDesign('enemy')),
    };
    this.terrain = TerrainGrid.flat(GAME_BALANCE.MAP_WIDTH, GAME_BALANCE.MAP_HEIGHT);
    this.pathfinder = new Pathfinder(this.terrain);
    // the design-trial arena is an open test range: both squads see each other
    this.vision = new Vision(!this.arena);
    if (!this.arena) this.initMap(this.level?.map ?? options.map);
    if (this.level && !options.fair) {
      this.applyEnemyModifiers(this.level.enemy);
      this.doctrine.enemy = this.level.doctrine;
      // a defensive general holds its base from the first second, before its first decision
      if (this.level.doctrine === 'defensive') this.teams.enemy.plan = { ...this.teams.enemy.plan, stance: 'defend_base' };
    }
  }

  /** The enemy's edge on a campaign level: economy, chassis, extra factory and harvesters, an army waiting, a tougher HQ. */
  private applyEnemyModifiers(m: EnemyModifiers) {
    const team: Team = 'enemy';
    this.incomeMul[team] = m.incomeMul;
    this.allowedChassis[team] = [...m.chassis];
    const hq = this.getHQ(team);
    if (m.extraFactory) this.addBuilding(team, 'factory', buildingSlot(team, 'factory', 1), true);
    if (hq && m.hqHpMul) {
      hq.maxHp = Math.round(hq.maxHp * m.hqHpMul);
      hq.hp = hq.maxHp;
    }
    if (hq) {
      for (let i = 0; i < (m.extraHarvesters ?? 0); i++) this.spawnHarvester(team, { x: hq.pos.x - 4, y: hq.pos.y + (i % 2 ? 7 : -7) });
      const n = m.garrison ?? 0;
      for (let i = 0; i < n; i++) {
        const lane = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
        this.spawnCombatBot(team, { x: hq.pos.x - 9, y: hq.pos.y + lane * 8 }, this.teams[team].design, 0);
        const g = this.units[this.units.length - 1] as CombatUnit;
        g.garrison = true;
        g.lane = lane;
        this.teams[team].economy.totals.unitsBuilt--; // a garrison, not production
      }
    }
    this.recomputePower();
  }

  /** Chassis this side may use, or null when any is allowed. */
  public allowedChassisOf(team: Team): ChassisType[] | null {
    return this.allowedChassis[team];
  }

  /**
   * The design within the side's allowed chassis: unchanged when allowed, otherwise moved to the
   * heaviest allowed chassis and repaired; null when it cannot be made to fit (keep the current one).
   */
  public fitDesign(team: Team, design: RobotDesign): RobotDesign | null {
    const allowed = this.allowedChassis[team];
    if (!allowed || allowed.includes(design.chassisId)) return design;
    const order: ChassisType[] = ['heavy_quad', 'medium_tracked', 'light_biped'];
    const chassisId = order.find(c => allowed.includes(c)) ?? allowed[0];
    const swapped: RobotDesign = { ...design, chassisId };
    const fitted = RobotBuilder.calculateStats(swapped).isValid ? swapped : RobotBuilder.repairDesign(swapped).design;
    return allowed.includes(fitted.chassisId) && RobotBuilder.calculateStats(fitted).isValid ? fitted : null;
  }

  private createTeam(team: Team, design: RobotDesign): TeamState {
    const economy: TeamEconomy = {
      metal: GAME_BALANCE.INITIAL_METAL,
      components: GAME_BALANCE.INITIAL_COMPONENTS,
      powerCapacity: 0,
      powerDemand: 0,
      powerEfficiency: 1,
      componentReserve: GAME_BALANCE.DEFAULT_COMPONENT_RESERVE,
      fabricatorActive: false,
      batchSize: GAME_BALANCE.BATCH_SIZE_DEFAULT,
      miningRatePerMin: 0,
      totals: {
        metalMined: 0,
        scrapReclaimed: 0,
        componentsMade: 0,
        unitsBuilt: 0,
        unitsLost: 0,
        kills: 0,
        harvestersLost: 0,
      },
    };
    return {
      team,
      economy,
      design: { ...design, createdAt: Date.now() },
      plan: { ...DEFAULT_PLAN, summaryRu: tr('plan.default') },
      batchCounter: 1,
      designsFielded: [design.name],
      harvesterQueue: 0,
    };
  }

  private initMap(map?: MapSpec) {
    for (const team of ['player', 'enemy'] as Team[]) {
      this.addBuilding(team, 'command_center', buildingSlot(team, 'command_center'), true);
      this.addBuilding(team, 'factory', buildingSlot(team, 'factory', 0), true);
      this.addBuilding(team, 'power_plant', buildingSlot(team, 'power_plant', 0), true);
    }

    const W = GAME_BALANCE.MAP_WIDTH;
    const patch = (id: string, x: number, y: number, metal: number, radius: number, zone: ResourcePatch['zone']) =>
      this.resourcePatches.push({ id, pos: { x, y }, metalRemaining: metal, maxMetal: metal, radius, zone });
    patch('res_p_safe_n', 22, 9, 3200, 3, 'player_safe');
    patch('res_p_safe_s', 24, 51, 2400, 3, 'player_safe');
    patch('res_e_safe_n', W - 22, 9, 3200, 3, 'enemy_safe');
    patch('res_e_safe_s', W - 24, 51, 2400, 3, 'enemy_safe');
    patch('res_mid_n', 50, 12, 4500, 4, 'contested');
    patch('res_mid_c', 50, 30, 6500, 4.5, 'contested');
    patch('res_mid_s', 50, 48, 4500, 4, 'contested');

    if (map) this.generateMapTerrain(map);

    for (const team of ['player', 'enemy'] as Team[]) {
      const hq = buildingSlot(team, 'command_center');
      const dx = team === 'player' ? 4 : -4;
      this.spawnHarvester(team, { x: hq.x + dx, y: hq.y - 3 });
      this.spawnHarvester(team, { x: hq.x + dx, y: hq.y + 3 });
    }
    this.recomputePower();
  }

  /** Replaces the battlefield terrain (hand-made maps, tests) and the router that walks it. */
  public setTerrain(grid: TerrainGrid) {
    this.terrain = grid;
    this.pathfinder = new Pathfinder(grid);
    for (const u of this.units) u.nav = undefined;
  }

  /**
   * Grows forest, rocks and swamp around the fixed base layout: building slots, deposits and rally
   * points stay free, and bases, deposits and rally points are connected by passages wide enough
   * for a heavy chassis.
   */
  private generateMapTerrain(map: MapSpec) {
    const keepOut: KeepOut[] = [];
    const connect: Vector2D[] = [];
    for (const team of ['player', 'enemy'] as Team[]) {
      const dir = team === 'player' ? 1 : -1;
      const hq = buildingSlot(team, 'command_center');
      keepOut.push({ pos: hq, radius: 13 });
      connect.push({ x: hq.x + dir * 8, y: hq.y });
      for (let i = 0; i < MAX_SLOTS.factory; i++) {
        const f = buildingSlot(team, 'factory', i);
        keepOut.push({ pos: f, radius: 8 });
        connect.push({ x: f.x + dir * 5.5, y: f.y });
      }
      for (let i = 0; i < MAX_SLOTS.power_plant; i++) keepOut.push({ pos: buildingSlot(team, 'power_plant', i), radius: 5.5 });
      const rally = this.rallyPoint(team);
      keepOut.push({ pos: rally, radius: 6, soft: true });
      connect.push(rally);
    }
    for (const p of this.resourcePatches) {
      keepOut.push({ pos: p.pos, radius: p.radius + 4.5, soft: true });
      connect.push(p.pos);
    }
    this.setTerrain(generateTerrain(map, GAME_BALANCE.MAP_WIDTH, GAME_BALANCE.MAP_HEIGHT, keepOut, connect));
  }

  // ───────────────────────────── Construction ─────────────────────────────

  private addBuilding(team: Team, type: BuildingType, pos: Vector2D, instant: boolean): Building {
    const maxHp =
      type === 'command_center'
        ? GAME_BALANCE.COMMAND_CENTER_HP
        : type === 'factory'
          ? GAME_BALANCE.FACTORY_HP
          : GAME_BALANCE.POWER_PLANT_HP;
    const b: Building = {
      id: `${type}_${team}_${this.nextId++}`,
      team,
      type,
      pos: { ...pos },
      hp: instant ? maxHp : maxHp * 0.15,
      maxHp,
      radius: type === 'command_center' ? 5 : type === 'factory' ? 4 : 3.2,
      job: null,
      harvesterBuild: null,
      paused: false,
      built: instant ? 1 : 0,
      buildTimeSec:
        type === 'factory' ? GAME_BALANCE.FACTORY_BUILD_SEC : type === 'power_plant' ? GAME_BALANCE.POWER_PLANT_BUILD_SEC : 1,
      turretCooldown: 0,
      lastDamagedAt: -999,
    };
    this.buildings.push(b);
    return b;
  }

  public getHQ(team: Team): Building | undefined {
    return this.buildings.find(b => b.team === team && b.type === 'command_center');
  }

  public buildingCount(team: Team, type: BuildingType): number {
    return this.buildings.filter(b => b.team === team && b.type === type).length;
  }

  public canBuild(team: Team, type: 'factory' | 'power_plant'): { ok: boolean; reason?: string } {
    const econ = this.teams[team].economy;
    const max = type === 'factory' ? GAME_BALANCE.MAX_FACTORIES : GAME_BALANCE.MAX_POWER_PLANTS;
    if (this.buildingCount(team, type) >= Math.min(max, MAX_SLOTS[type])) {
      return { ok: false, reason: type === 'factory' ? tr('build.factoryLimit') : tr('build.noPlantSlot') };
    }
    const metal = type === 'factory' ? GAME_BALANCE.FACTORY_COST_METAL : GAME_BALANCE.POWER_PLANT_COST_METAL;
    const comps = type === 'factory' ? GAME_BALANCE.FACTORY_COST_COMPONENTS : 0;
    if (econ.metal < metal) return { ok: false, reason: tr('build.needMetal', { n: metal }) };
    if (econ.components < comps) return { ok: false, reason: tr('build.needComponents', { n: comps }) };
    return { ok: true };
  }

  public buildStructure(team: Team, type: 'factory' | 'power_plant'): { ok: boolean; text: string } {
    const check = this.canBuild(team, type);
    if (!check.ok) return { ok: false, text: check.reason || tr('build.impossible') };
    const occupied = this.buildings.filter(b => b.team === team && b.type === type).map(b => b.pos);
    let slot: Vector2D | null = null;
    for (let i = 0; i < MAX_SLOTS[type]; i++) {
      const s = buildingSlot(team, type, i);
      if (!occupied.some(p => dist(p, s) < 1)) {
        slot = s;
        break;
      }
    }
    if (!slot) return { ok: false, text: tr('build.noSlot') };
    const econ = this.teams[team].economy;
    econ.metal -= type === 'factory' ? GAME_BALANCE.FACTORY_COST_METAL : GAME_BALANCE.POWER_PLANT_COST_METAL;
    econ.components -= type === 'factory' ? GAME_BALANCE.FACTORY_COST_COMPONENTS : 0;
    this.addBuilding(team, type, slot, false);
    this.pushEvent(team, 'info', tr(type === 'factory' ? 'build.startedFactory' : 'build.startedPlant'), false);
    return { ok: true, text: tr(type === 'factory' ? 'build.buildingFactory' : 'build.buildingPlant') };
  }

  public harvesterCount(team: Team): number {
    let n = 0;
    for (const u of this.units) if (u.team === team && u.kind === 'harvester') n++;
    return n;
  }

  /** Harvesters ordered but not yet out of the factory (queued + being assembled). */
  public harvestersInProduction(team: Team): number {
    let n = this.teams[team].harvesterQueue;
    for (const b of this.buildings) if (b.team === team && b.harvesterBuild) n++;
    return n;
  }

  /**
   * Harvesters are built at a factory: the metal is paid when ordered, the machine rolls out
   * after HARVESTER_BUILD_SEC of factory time — time the combat batch does not get.
   */
  public orderHarvester(team: Team): { ok: boolean; text: string } {
    const t = this.teams[team];
    const econ = t.economy;
    if (this.harvesterCount(team) + this.harvestersInProduction(team) >= GAME_BALANCE.MAX_HARVESTERS) {
      return { ok: false, text: tr('harv.limit', { n: GAME_BALANCE.MAX_HARVESTERS }) };
    }
    const hasFactory = this.buildings.some(b => b.team === team && b.type === 'factory');
    if (!hasFactory && !this.getHQ(team)) {
      return { ok: false, text: tr('harv.nowhere') };
    }
    // No miners at all (none alive, none on order): the HQ issues an emergency harvester for free,
    // otherwise "no metal → no harvester → no metal" would lock the economy forever.
    const emergency = this.harvesterCount(team) + this.harvestersInProduction(team) === 0;
    if (!emergency && econ.metal < GAME_BALANCE.HARVESTER_COST_METAL) {
      return { ok: false, text: tr('build.needMetal', { n: GAME_BALANCE.HARVESTER_COST_METAL }) };
    }
    if (!emergency) econ.metal -= GAME_BALANCE.HARVESTER_COST_METAL;
    t.harvesterQueue++;
    if (emergency) this.pushEvent(team, 'info', tr('harv.emergencyEvent'), false);
    if (!hasFactory) {
      const sec = GAME_BALANCE.HARVESTER_BUILD_SEC * GAME_BALANCE.HQ_EMERGENCY_HARVESTER_FACTOR;
      return { ok: true, text: tr('harv.hqBay', { n: sec }) };
    }
    const paused = this.buildings.filter(b => b.team === team && b.type === 'factory').every(b => b.paused);
    return {
      ok: true,
      text: paused
        ? tr('harv.orderedPaused')
        : tr('harv.ordered', { n: GAME_BALANCE.HARVESTER_BUILD_SEC }),
    };
  }

  /** Stop or resume one factory (null id = every factory of the team). */
  public setFactoryPaused(team: Team, factoryId: string | null, paused: boolean): number {
    let n = 0;
    for (const b of this.buildings) {
      if (b.team !== team || b.type !== 'factory') continue;
      if (factoryId && b.id !== factoryId) continue;
      b.paused = paused;
      n++;
    }
    return n;
  }

  public applyProductionAction(team: Team, action: ProductionAction): string {
    const econ = this.teams[team].economy;
    switch (action.type) {
      case 'build_harvester': {
        const n = Math.max(1, Math.min(4, Math.round(action.count || 1)));
        let ordered = 0;
        let lastFail = '';
        for (let i = 0; i < n; i++) {
          const r = this.orderHarvester(team);
          if (r.ok) ordered++;
          else {
            lastFail = r.text;
            break;
          }
        }
        if (!ordered) return tr('act.harvNotOrdered', { why: lastFail });
        const factories = this.buildings.filter(b => b.team === team && b.type === 'factory');
        const where = !factories.length
          ? tr('act.harvByHq')
          : factories.every(b => b.paused)
            ? tr('act.harvWaitPaused')
            : tr('act.harvByFactory', { n: ordered * GAME_BALANCE.HARVESTER_BUILD_SEC });
        return `${tr('act.harvOrdered', { n: ordered, where })}${lastFail ? ` (${lastFail})` : ''}`;
      }
      case 'set_production': {
        const n = this.setFactoryPaused(team, null, action.paused);
        if (!n) return tr('act.noFactories');
        return tr(action.paused ? 'act.productionStopped' : 'act.productionResumed', { n });
      }
      case 'build_power_plant':
        return this.buildStructure(team, 'power_plant').text;
      case 'build_factory':
        return this.buildStructure(team, 'factory').text;
      case 'set_batch_size': {
        econ.batchSize = Math.max(GAME_BALANCE.BATCH_SIZE_MIN, Math.min(GAME_BALANCE.BATCH_SIZE_MAX, Math.round(action.size)));
        return tr('act.batchSize', { n: econ.batchSize });
      }
      case 'set_component_reserve': {
        econ.componentReserve = Math.max(0, Math.min(600, Math.round(action.amount)));
        return tr('act.componentReserve', { n: econ.componentReserve });
      }
    }
  }

  // ───────────────────────────── Design & plan ─────────────────────────────

  public setDesign(team: Team, design: RobotDesign) {
    const t = this.teams[team];
    t.design = { ...design };
    if (!t.designsFielded.includes(design.name)) t.designsFielded.push(design.name);
    this.pushEvent(team, 'design_changed', tr('event.designChanged', { name: design.name }), false);
  }

  public setPlan(team: Team, plan: TacticalPlan) {
    this.teams[team].plan = { ...plan, updatedAt: this.gameTime };
  }

  // ───────────────────────────── Spawning ─────────────────────────────

  public spawnHarvester(team: Team, pos: Vector2D) {
    const harv: HarvesterUnit = {
      id: `harv_${this.nextId++}_${team}`,
      team,
      kind: 'harvester',
      pos: { ...pos },
      hp: GAME_BALANCE.HARVESTER_HP,
      maxHp: GAME_BALANCE.HARVESTER_HP,
      speed: GAME_BALANCE.HARVESTER_SPEED,
      radius: 1.3,
      state: 'idle',
      facing: team === 'player' ? 0 : Math.PI,
      vel: 0,
      lastDamagedAt: -999,
      carrying: 0,
      capacity: GAME_BALANCE.HARVESTER_MAX_CARRY,
      targetId: null,
      targetType: null,
    };
    this.units.push(harv);
  }

  public spawnCombatBot(team: Team, pos: Vector2D, design: RobotDesign, batchNumber: number) {
    const stats = RobotBuilder.calculateStats(design);
    const bot: CombatUnit = {
      id: `bot_${this.nextId++}_${team}`,
      team,
      kind: 'combat',
      design: { ...design },
      stats,
      pos: { ...pos },
      hp: stats.hp,
      maxHp: stats.hp,
      speed: stats.effectiveSpeed,
      radius: design.chassisId === 'heavy_quad' ? 2.1 : design.chassisId === 'medium_tracked' ? 1.7 : 1.3,
      state: 'moving',
      facing: team === 'player' ? 0 : Math.PI,
      vel: 0,
      lastDamagedAt: -999,
      targetId: null,
      cooldown: Math.random() * 0.5,
      heat: 0,
      isOverheated: false,
      deployTimer: 0,
      kills: 0,
      batchNumber,
      lane: Math.random() * 2 - 1,
      lastShotAt: -999,
      committed: false,
      rallySince: this.gameTime,
    };
    this.units.push(bot);
    this.teams[team].economy.totals.unitsBuilt++;
  }

  // ───────────────────────────── Main loop ─────────────────────────────

  public update(dt: number) {
    if (this.isPaused || this.gameOver) return;
    this.gameTime += dt;
    this.pathBudget = PATH_BUDGET_PER_TICK;

    this.recomputePower();
    this.updateConstruction(dt);
    this.updateFabricators(dt);
    this.updateProduction(dt);
    this.vision.update(this, dt);
    this.updateHarvesters(dt);
    this.updateCombatUnits(dt);
    this.updateTurrets(dt);
    this.updateProjectiles(dt);
    this.updateSightings(dt);
    this.updateScrap();
    this.checkVictory();
    this.cleanup();
  }

  private recomputePower() {
    for (const team of ['player', 'enemy'] as Team[]) {
      const econ = this.teams[team].economy;
      let capacity = 0;
      let demand = 0;
      for (const b of this.buildings) {
        if (b.team !== team || b.built < 1) continue;
        if (b.type === 'command_center') capacity += GAME_BALANCE.HQ_BUILTIN_POWER_KW;
        if (b.type === 'power_plant') capacity += GAME_BALANCE.POWER_PLANT_KW;
        if (b.type === 'factory' && !b.paused && (b.harvesterBuild || (b.job && !this.isArmyCapped(team)))) {
          demand += GAME_BALANCE.POWER_FACTORY_KW;
        }
      }
      if (econ.fabricatorActive) demand += GAME_BALANCE.POWER_FABRICATOR_KW;
      let repairing = false;
      for (const u of this.units) {
        if (u.team !== team) continue;
        if (u.kind === 'harvester') demand += GAME_BALANCE.POWER_HARVESTER_KW;
        else if (u.state === 'repairing') repairing = true;
      }
      if (repairing) demand += GAME_BALANCE.POWER_REPAIR_KW;
      econ.powerCapacity = capacity;
      econ.powerDemand = demand;
      econ.powerEfficiency = demand <= capacity ? 1 : Math.max(0.15, capacity / demand);
      if (econ.powerEfficiency < 0.85 && this.throttled(`power_${team}`, 45)) {
        this.pushEvent(
          team,
          'power_shortage',
          tr('event.powerShortage', { demand: Math.round(demand), capacity }),
          false,
        );
      }
    }
  }

  private updateConstruction(dt: number) {
    for (const b of this.buildings) {
      if (b.built >= 1) continue;
      const before = b.built;
      b.built = Math.min(1, b.built + dt / b.buildTimeSec);
      b.hp = Math.min(b.maxHp, b.hp + (b.built - before) * b.maxHp * 0.85);
      if (b.built >= 1) {
        this.addEffect('build_complete', b.pos, b.team, b.radius);
        this.pushEvent(b.team, 'build_complete', tr(b.type === 'factory' ? 'event.factoryOnline' : 'event.plantOnline'), false);
      }
    }
  }

  private updateFabricators(dt: number) {
    for (const team of ['player', 'enemy'] as Team[]) {
      const econ = this.teams[team].economy;
      const hq = this.getHQ(team);
      const wants = econ.components < econ.componentReserve && econ.metal > GAME_BALANCE.FABRICATOR_MIN_METAL_RESERVE;
      econ.fabricatorActive = !!hq && wants;
      if (!econ.fabricatorActive) continue;
      const made = Math.min(
        GAME_BALANCE.FABRICATOR_RATE_PER_SEC * econ.powerEfficiency * dt,
        (econ.metal - GAME_BALANCE.FABRICATOR_MIN_METAL_RESERVE) / GAME_BALANCE.FABRICATOR_METAL_PER_COMPONENT,
      );
      if (made <= 0) continue;
      econ.components += made;
      econ.metal -= made * GAME_BALANCE.FABRICATOR_METAL_PER_COMPONENT;
      econ.totals.componentsMade += made;
    }
  }

  public isArmyCapped(team: Team): boolean {
    return this.combatCount(team) >= GAME_BALANCE.MAX_ACTIVE_COMBAT_BOTS;
  }

  public combatCount(team: Team): number {
    let n = 0;
    for (const u of this.units) if (u.team === team && u.kind === 'combat') n++;
    return n;
  }

  /** Combat machines the side can send into the field: the campaign garrison guards its HQ and does not count. */
  public fieldArmyCount(team: Team): number {
    let n = 0;
    for (const u of this.units) if (u.team === team && u.kind === 'combat' && !u.garrison) n++;
    return n;
  }

  /** Factory status for the HUD */
  public factoryStatus(b: Building): string {
    if (b.built < 1) return tr('factory.building', { pct: Math.round(b.built * 100) });
    if (b.paused) return tr('factory.paused');
    if (b.harvesterBuild) return tr('factory.harvester');
    if (!b.job) return tr('factory.waitingResources');
    if (this.isArmyCapped(b.team)) return tr('factory.armyCap');
    if (!b.job.unitPaid && !this.canAffordUnit(b.team, b.job.stats.metalCost, b.job.stats.componentCost)) {
      return tr('factory.needResources');
    }
    return tr('factory.assembling');
  }

  private canAffordUnit(team: Team, metal: number, comps: number) {
    const econ = this.teams[team].economy;
    return econ.metal >= metal && econ.components >= comps;
  }

  private updateProduction(dt: number) {
    this.updateEmergencyHarvesterBay(dt);
    for (const b of this.buildings) {
      if (b.type !== 'factory' || b.built < 1 || b.paused) continue;
      const t = this.teams[b.team];
      const econ = t.economy;
      const dir = b.team === 'player' ? 1 : -1;

      // 1. A harvester on the line is finished first
      if (b.harvesterBuild) {
        b.harvesterBuild.progressSec += dt * econ.powerEfficiency;
        if (b.harvesterBuild.progressSec >= b.harvesterBuild.totalSec) {
          b.harvesterBuild = null;
          this.spawnHarvester(b.team, { x: b.pos.x + dir * (b.radius + 1.5), y: b.pos.y + (Math.random() - 0.5) * 3 });
          this.pushEvent(b.team, 'info', tr('event.harvesterBuilt'), false);
        }
        continue;
      }

      // 2. Ordered harvesters go in between combat units (economy orders have priority)
      if (t.harvesterQueue > 0 && (!b.job || !b.job.unitPaid)) {
        t.harvesterQueue--;
        b.harvesterBuild = { progressSec: 0, totalSec: GAME_BALANCE.HARVESTER_BUILD_SEC };
        continue;
      }

      // 3. The combat batch
      if (!b.job) {
        const stats = RobotBuilder.calculateStats(t.design);
        if (!stats.isValid) continue;
        if (!this.canAffordUnit(b.team, stats.metalCost, stats.componentCost)) continue;
        b.job = {
          design: { ...t.design },
          stats,
          progressSec: 0,
          unitTimeSec: stats.buildTimeSec,
          batchSize: econ.batchSize,
          remaining: econ.batchSize,
          batchNumber: t.batchCounter++,
          unitPaid: false,
        };
        this.pushEvent(b.team, 'batch_started', tr('event.batchStarted', { n: b.job.batchNumber, name: t.design.name, size: econ.batchSize }), false);
      }

      const job = b.job;
      if (this.isArmyCapped(b.team)) continue;

      // Pay for each unit when its assembly starts (keeps the factory busy without locking a whole batch)
      if (!job.unitPaid) {
        if (!this.canAffordUnit(b.team, job.stats.metalCost, job.stats.componentCost)) continue;
        econ.metal -= job.stats.metalCost;
        econ.components -= job.stats.componentCost;
        job.unitPaid = true;
      }

      job.progressSec += dt * econ.powerEfficiency;
      if (job.progressSec >= job.unitTimeSec) {
        const spawnPos = { x: b.pos.x + dir * (b.radius + 1.5), y: b.pos.y + (Math.random() - 0.5) * 3 };
        this.spawnCombatBot(b.team, spawnPos, job.design, job.batchNumber);
        job.remaining--;
        job.progressSec = 0;
        job.unitPaid = false;
        if (job.remaining <= 0) {
          this.pushEvent(b.team, 'batch_complete', tr('event.batchComplete', { n: job.batchNumber, name: job.design.name }), false);
          this.sound.batchReady(b.team);
          b.job = null;
        }
      }
    }
  }

  /** No factory at all: the HQ assembles ordered harvesters, slower, so the economy can always recover. */
  private updateEmergencyHarvesterBay(dt: number) {
    for (const team of ['player', 'enemy'] as Team[]) {
      const t = this.teams[team];
      const hq = this.getHQ(team);
      if (!hq) continue;
      if (!hq.harvesterBuild) {
        // Only a team without factories starts an HQ build; one already started always finishes,
        // otherwise founding a factory would freeze it forever (a lost harvester holding a cap slot).
        if (t.harvesterQueue <= 0 || this.buildings.some(b => b.team === team && b.type === 'factory')) continue;
        t.harvesterQueue--;
        hq.harvesterBuild = {
          progressSec: 0,
          totalSec: GAME_BALANCE.HARVESTER_BUILD_SEC * GAME_BALANCE.HQ_EMERGENCY_HARVESTER_FACTOR,
        };
      }
      hq.harvesterBuild.progressSec += dt * t.economy.powerEfficiency;
      if (hq.harvesterBuild.progressSec >= hq.harvesterBuild.totalSec) {
        hq.harvesterBuild = null;
        const dir = team === 'player' ? 1 : -1;
        this.spawnHarvester(team, { x: hq.pos.x + dir * (hq.radius + 1.5), y: hq.pos.y + (Math.random() - 0.5) * 4 });
        this.pushEvent(team, 'info', tr('event.hqBayBuilt'), false);
      }
    }
  }

  private updateHarvesters(dt: number) {
    for (const u of this.units) {
      if (u.kind !== 'harvester' || u.state === 'dead') continue;
      const hq = this.getHQ(u.team);
      const econ = this.teams[u.team].economy;
      if (!hq) continue;

      // Flee home when attacked and an enemy is close
      const threatened = this.gameTime - u.lastDamagedAt < 4 && this.nearestEnemyCombat(u.team, u.pos, 14);
      if (u.carrying >= u.capacity || (threatened && u.carrying > 0) || (threatened && u.state !== 'delivering')) {
        u.state = 'delivering';
        if (dist(u.pos, hq.pos) < hq.radius + u.radius + 0.4) {
          if (u.carrying > 0) {
            const income = u.carrying * this.incomeMul[u.team];
            econ.metal += income;
            if (u.targetType === 'scrap') econ.totals.scrapReclaimed += income;
            else econ.totals.metalMined += income;
            this.minedWindow[u.team].push({ t: this.gameTime, amount: income });
          }
          u.carrying = 0;
          u.targetId = null;
          u.state = threatened ? 'idle' : 'moving';
        } else {
          this.steer(u, hq.pos, u.speed, dt);
        }
        continue;
      }

      if (!u.targetId) this.pickHarvestTarget(u);
      if (!u.targetId) {
        u.state = 'idle';
        continue;
      }

      if (u.targetType === 'scrap') {
        const scrap = this.scrapPiles.find(s => s.id === u.targetId);
        if (!scrap) {
          u.targetId = null;
          continue;
        }
        if (dist(u.pos, scrap.pos) > 1.4) {
          this.steer(u, scrap.pos, u.speed, dt);
          u.state = 'moving';
        } else {
          u.state = 'harvesting';
          const gather = Math.min(scrap.metal, GAME_BALANCE.HARVEST_RATE_PER_SEC * 1.5 * econ.powerEfficiency * dt, u.capacity - u.carrying);
          scrap.metal -= gather;
          u.carrying += gather;
          if (scrap.metal <= 0.5) {
            this.scrapPiles = this.scrapPiles.filter(s => s.id !== scrap.id);
            u.targetId = null;
          }
        }
        continue;
      }

      const patch = this.resourcePatches.find(p => p.id === u.targetId);
      if (!patch || patch.metalRemaining <= 0) {
        u.targetId = null;
        continue;
      }
      if (dist(u.pos, patch.pos) > patch.radius * 0.8 + 0.6) {
        this.steer(u, patch.pos, u.speed, dt);
        u.state = 'moving';
      } else {
        u.state = 'harvesting';
        const gather = Math.min(patch.metalRemaining, GAME_BALANCE.HARVEST_RATE_PER_SEC * econ.powerEfficiency * dt, u.capacity - u.carrying);
        patch.metalRemaining -= gather;
        u.carrying += gather;
      }
    }

    // Mining rate over the last 60 s for the HUD
    for (const team of ['player', 'enemy'] as Team[]) {
      const w = this.minedWindow[team];
      while (w.length && this.gameTime - w[0].t > 60) w.shift();
      const sum = w.reduce((a, b) => a + b.amount, 0);
      const window = Math.min(60, Math.max(15, this.gameTime));
      this.teams[team].economy.miningRatePerMin = Math.round((sum * 60) / window);
    }
  }

  private pickHarvestTarget(u: HarvesterUnit) {
    const hq = this.getHQ(u.team)!;
    let best: { id: string; type: 'ore' | 'scrap'; score: number } | null = null;
    for (const s of this.scrapPiles) {
      const d = dist(u.pos, s.pos);
      if (d > 28) continue;
      const danger = this.nearestEnemyCombat(u.team, s.pos, 14) ? 60 : 0;
      const score = d + dist(s.pos, hq.pos) * 0.5 + danger - 8;
      if (!best || score < best.score) best = { id: s.id, type: 'scrap', score };
    }
    for (const p of this.resourcePatches) {
      if (p.metalRemaining <= 0) continue;
      const crowd = this.units.filter(o => o.kind === 'harvester' && o.team === u.team && o.targetId === p.id).length;
      const danger = this.nearestEnemyCombat(u.team, p.pos, 15) ? 70 : 0;
      const score = dist(p.pos, hq.pos) * 1.2 + dist(u.pos, p.pos) * 0.3 + crowd * 7 + danger;
      if (!best || score < best.score) best = { id: p.id, type: 'ore', score };
    }
    if (best) {
      u.targetId = best.id;
      u.targetType = best.type;
    }
  }

  private nearestEnemyCombat(team: Team, pos: Vector2D, radius: number): CombatUnit | null {
    let best: CombatUnit | null = null;
    let bestD = radius;
    for (const o of this.units) {
      if (o.team === team || o.kind !== 'combat' || o.state === 'dead' || !this.vision.sees(team, o.id)) continue;
      const d = dist(o.pos, pos);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  // ───────────────────────────── Combat AI (executes the agent plan) ─────────────────────────────

  private updateCombatUnits(dt: number) {
    const W = GAME_BALANCE.MAP_WIDTH;
    const H = GAME_BALANCE.MAP_HEIGHT;

    // Front-most non-artillery ally per team (artillery stays behind it)
    const front: Record<Team, number | null> = { player: null, enemy: null };
    for (const u of this.units) {
      if (u.kind !== 'combat' || u.state === 'dead' || u.state === 'retreating' || u.state === 'repairing') continue;
      if (u.design.tacticalRole === 'artillery' || u.stats.requiresDeploy) continue;
      const f = front[u.team];
      front[u.team] = f === null ? u.pos.x : u.team === 'player' ? Math.max(f, u.pos.x) : Math.min(f, u.pos.x);
    }

    this.updateWaves();
    const raider: Record<Team, CombatUnit | null> = { player: this.baseRaider('player'), enemy: this.baseRaider('enemy') };

    // Alternate the processing order every tick: whoever acts first in a tick gets the first
    // shot, so a fixed order (player units are older) would quietly favour one side.
    this.combatTick++;
    const order = this.combatTick % 2 === 0 ? this.units : [...this.units].reverse();
    for (const u of order) {
      if (u.kind !== 'combat' || u.state === 'dead') continue;
      const team = this.teams[u.team];
      const plan = team.plan;
      const dir = u.team === 'player' ? 1 : -1;
      const ownHQ = this.getHQ(u.team);
      const enemyHQ = this.getHQ(opposite(u.team));
      const hpPct = (u.hp / u.maxHp) * 100;
      let engaging = false;

      // Retreat & repair cycle: below the plan's threshold → walk to the HQ → repair to ~full → rejoin.
      // Order matters: a unit that arrives this tick must start repairing this tick, otherwise the
      // combat code below overwrites its state and it never heals.
      if (
        plan.retreatHpThreshold > 0 &&
        hpPct < plan.retreatHpThreshold &&
        u.state !== 'retreating' &&
        u.state !== 'repairing' &&
        ownHQ
      ) {
        u.state = 'retreating';
        u.targetId = null;
      }
      if (u.state === 'retreating') {
        if (!ownHQ) {
          u.state = 'moving';
        } else if (dist(u.pos, ownHQ.pos) <= GAME_BALANCE.REPAIR_RADIUS) {
          u.state = 'repairing';
        } else {
          this.steer(u, ownHQ.pos, u.stats.effectiveSpeed, dt);
          this.coolDown(u, dt, false);
          continue;
        }
      }
      if (u.state === 'repairing') {
        if (!ownHQ || hpPct >= 96) {
          u.state = 'moving';
          u.committed = false;
          u.rallySince = this.gameTime;
        } else {
          const d = dist(u.pos, ownHQ.pos);
          if (d > GAME_BALANCE.REPAIR_RADIUS) this.steer(u, ownHQ.pos, u.stats.effectiveSpeed, dt);
          else this.brake(u, dt);
          u.hp = Math.min(u.maxHp, u.hp + GAME_BALANCE.REPAIR_HP_PER_SEC * team.economy.powerEfficiency * dt);
          this.coolDown(u, dt, false);
          continue;
        }
      }

      // Target acquisition: only what our side sees; direct fire also needs the shooter's own line of sight
      const acquired = this.acquireTarget(u);
      const target = acquired?.target ?? null;
      const los = acquired?.los ?? false;
      u.targetId = target ? target.id : null;

      let goal: Vector2D | null = null;
      let desired = 0;
      if (target) {
        const range = u.stats.effectiveRange + (target as { radius: number }).radius;
        const d = dist(u.pos, target.pos);
        if (u.stats.weaponKind === 'melee') desired = range * 0.8;
        else if (plan.engagementRange === 'max_range') desired = range * 0.92;
        else if (plan.engagementRange === 'close_brawl') desired = Math.max(2.2, Math.min(range * 0.5, 6));
        else desired = range * 0.8;

        if (d > desired || !los) {
          // out of range, or trees in the way: close in (the route goes around the grove)
          goal = target.pos;
        } else if (
          plan.engagementRange === 'max_range' &&
          !u.stats.requiresDeploy &&
          u.stats.weaponKind !== 'melee' &&
          'kind' in target &&
          target.kind === 'combat' &&
          d < range * 0.55
        ) {
          // Kite: step back while keeping the gun on target
          goal = { x: u.pos.x - (target.pos.x - u.pos.x), y: u.pos.y - (target.pos.y - u.pos.y) };
        }
        engaging = d <= range && !u.isOverheated && los;
      } else {
        // Reflex, no LLM: machines near home go for a raider at the base while the commander re-plans
        const r = raider[u.team];
        const home = r && ownHQ && dist(u.pos, ownHQ.pos) <= GAME_BALANCE.BASE_DEFENSE_RECALL_RADIUS;
        goal = home ? { x: r.pos.x, y: r.pos.y } : this.stanceGoal(u, plan.stance, ownHQ, enemyHQ, front[u.team], dir);
      }

      // Artillery holds behind the front line (needs cover)
      const isArtillery = u.design.tacticalRole === 'artillery' || u.stats.requiresDeploy;
      if (isArtillery && goal && front[u.team] !== null && !(target && dist(u.pos, target.pos) <= desired)) {
        const limit = front[u.team]! - dir * 6;
        if ((dir > 0 && goal.x > limit) || (dir < 0 && goal.x < limit)) goal = { x: limit, y: goal.y };
      }

      // Movement
      let moving = false;
      if (goal && dist(u.pos, goal) > 1.2) {
        moving = this.steer(u, goal, u.stats.effectiveSpeed, dt, true);
      } else {
        this.brake(u, dt);
      }
      u.pos.x = Math.max(1, Math.min(W - 1, u.pos.x));
      u.pos.y = Math.max(1, Math.min(H - 1, u.pos.y));

      // Facing the target while fighting
      if (target && engaging) u.facing = Math.atan2(target.pos.y - u.pos.y, target.pos.x - u.pos.x);

      // Deployment for siege weapons: only after stopping
      if (u.stats.requiresDeploy) {
        if (moving || u.vel > 0.4) u.deployTimer = 0;
        else u.deployTimer += dt;
      }
      const deployed = !u.stats.requiresDeploy || u.deployTimer >= GAME_BALANCE.DEPLOY_TIME_SEC;

      u.cooldown -= dt;
      if (target && engaging && deployed && u.cooldown <= 0) {
        this.fire(u, target);
        u.cooldown = u.stats.fireInterval;
      }

      if (target && engaging) u.state = deployed ? 'attacking' : 'deploying';
      else u.state = moving ? 'moving' : 'idle';

      this.coolDown(u, dt, engaging && deployed);
    }

    this.applySeparation(dt);
  }

  /** The enemy machine nearest to our HQ while our buildings are under fire, if one is close to the base. */
  private baseRaider(team: Team): CombatUnit | null {
    const hq = this.getHQ(team);
    if (!hq) return null;
    const underFire = this.buildings.some(b => b.team === team && this.gameTime - b.lastDamagedAt < GAME_BALANCE.BASE_ALERT_SEC);
    return underFire ? this.nearestEnemyCombat(team, hq.pos, GAME_BALANCE.BASE_THREAT_RADIUS) : null;
  }

  public rallyPoint(team: Team): Vector2D {
    const dir = team === 'player' ? 1 : -1;
    return { x: GAME_BALANCE.FRONTLINE_CENTER_X - dir * GAME_BALANCE.RALLY_X_OFFSET, y: GAME_BALANCE.MAP_HEIGHT / 2 };
  }

  public waveSize(): number {
    return Math.min(GAME_BALANCE.WAVE_MAX_SIZE, GAME_BALANCE.WAVE_MIN_SIZE + Math.floor(this.gameTime / 150));
  }

  /** Launches an assault wave once enough machines gathered at the rally point. */
  private updateWaves() {
    for (const team of ['player', 'enemy'] as Team[]) {
      if (this.teams[team].plan.stance !== 'advance') continue;
      const rally = this.rallyPoint(team);
      const waiting = this.units.filter(
        (u): u is CombatUnit =>
          u.kind === 'combat' && u.team === team && !u.committed && !u.garrison && u.state !== 'dead' && u.state !== 'retreating' && u.state !== 'repairing',
      );
      if (!waiting.length) continue;
      const gathered = waiting.filter(u => dist(u.pos, rally) < 16);
      const oldest = Math.min(...waiting.map(u => u.rallySince));
      const enough = gathered.length >= this.waveSize();
      const waitedTooLong = this.gameTime - oldest > GAME_BALANCE.WAVE_MAX_WAIT_SEC && gathered.length >= 2;
      if (enough || waitedTooLong) {
        for (const u of waiting) u.committed = true;
        this.pushEvent(team, 'info', tr('event.waveLaunched', { count: waiting.length }), false);
      }
    }
  }

  private stanceGoal(
    u: CombatUnit,
    stance: TacticalPlan['stance'],
    ownHQ: Building | undefined,
    enemyHQ: Building | undefined,
    frontX: number | null,
    dir: number,
  ): Vector2D {
    const H = GAME_BALANCE.MAP_HEIGHT;
    const laneY = Math.max(6, Math.min(H - 6, H / 2 + u.lane * 17));
    const center = GAME_BALANCE.FRONTLINE_CENTER_X;
    const enemyTeam = opposite(u.team);
    // the garrison stands guard in front of its HQ whatever the plan says
    if (u.garrison && ownHQ) return { x: ownHQ.pos.x + dir * 9, y: ownHQ.pos.y + u.lane * 8 };
    switch (stance) {
      case 'hold_center':
        return { x: center - dir * 6, y: laneY };
      case 'defend_base': {
        const base = ownHQ?.pos.x ?? (dir > 0 ? 10 : 90);
        return { x: base + dir * 15, y: H / 2 + u.lane * 13 };
      }
      case 'raid_economy': {
        const fast = u.design.tacticalRole === 'skirmisher' || u.stats.effectiveSpeed >= 4.4;
        if (fast) {
          const harv = this.units
            .filter(o => o.team === enemyTeam && o.kind === 'harvester' && this.vision.sees(u.team, o.id))
            .sort((a, b) => dist(a.pos, u.pos) - dist(b.pos, u.pos))[0];
          if (harv) return harv.pos;
          const patch = this.resourcePatches.find(p => p.zone === (enemyTeam === 'enemy' ? 'enemy_safe' : 'player_safe') && p.metalRemaining > 0);
          if (patch) return { x: patch.pos.x, y: patch.pos.y };
        }
        break;
      }
      default:
        break;
    }
    // Arena (test bench): no bases, close in on the nearest opponent
    if (this.arena) {
      const foe = this.nearestEnemyUnit(u.team, u.pos, Infinity);
      return foe ? { x: foe.pos.x, y: foe.pos.y } : { x: u.pos.x + dir * 10, y: u.pos.y };
    }
    // advance (also the fallback): gather into a wave, then march in lanes toward the enemy HQ
    if (!u.committed && stance === 'advance') {
      const rally = this.rallyPoint(u.team);
      return { x: rally.x - dir * Math.abs(u.lane) * 3, y: rally.y + u.lane * 14 };
    }
    if (!enemyHQ) return { x: u.pos.x + dir * 10, y: laneY };
    const remaining = Math.abs(enemyHQ.pos.x - u.pos.x);
    const y = remaining < 22 ? enemyHQ.pos.y + u.lane * 5 : laneY;
    void frontX;
    return { x: enemyHQ.pos.x, y };
  }

  /**
   * Picks a target by the plan's priority among enemies our side sees. Direct-fire weapons prefer a
   * target in their own line of sight (a slightly worse one beats one behind trees); the siege
   * cannon lobs shells over the forest at anything an ally spots.
   */
  private acquireTarget(u: CombatUnit): { target: GameUnit | Building; los: boolean } | null {
    const plan = this.teams[u.team].plan;
    const enemyTeam = opposite(u.team);
    const aggro = u.stats.effectiveRange + GAME_BALANCE.AGGRO_EXTRA_RANGE;
    const myHarvesters = plan.guardHarvesters ? this.units.filter(o => o.team === u.team && o.kind === 'harvester') : [];

    const cands = this.candidates;
    cands.length = 0;
    for (const e of this.units) {
      if (e.team !== enemyTeam || e.state === 'dead' || !this.vision.sees(u.team, e.id)) continue;
      const d = dist(u.pos, e.pos);
      if (d > aggro) continue;
      let score = d;
      switch (plan.targetPriority) {
        case 'high_threat_heavies':
          if (e.kind === 'combat') score -= e.stats.dps * 0.1 + (e.maxHp > 700 ? 10 : 0);
          else score += 6;
          break;
        case 'scouts_harvesters':
          if (e.kind === 'harvester') score -= 22;
          else if (e.design.chassisId === 'light_biped') score -= 8;
          break;
        case 'focus_fire': {
          let allies = 0;
          for (const a of this.units) if (a.team === u.team && a.kind === 'combat' && a.targetId === e.id) allies++;
          score = d * 0.5 + (e.hp / e.maxHp) * 15 - allies * 4;
          break;
        }
        case 'buildings':
          score += e.kind === 'harvester' ? 4 : 0;
          break;
        default:
          if (e.kind === 'harvester') score += 3;
      }
      if (myHarvesters.length && myHarvesters.some(h => dist(h.pos, e.pos) < 13)) score -= 15;
      cands.push({ target: e, score });
    }
    for (const b of this.buildings) {
      if (b.team !== enemyTeam) continue;
      const d = dist(u.pos, b.pos) - b.radius;
      if (d > aggro) continue;
      let score = d + 6;
      if (plan.targetPriority === 'buildings') score -= 25;
      if (b.type === 'command_center') score -= 2;
      cands.push({ target: b, score });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.score - b.score);
    const best = cands[0];
    if (u.stats.weaponKind === 'explosive' || !this.terrain.hasSightBlockers) return { target: best.target, los: true };
    for (let i = 0; i < Math.min(4, cands.length); i++) {
      const c = cands[i];
      if (c.score - best.score > 8) break;
      if (this.terrain.lineOfSight(u.pos, c.target.pos)) return { target: c.target, los: true };
    }
    return { target: best.target, los: false };
  }

  private coolDown(u: CombatUnit, dt: number, firing: boolean) {
    const gen = firing ? u.stats.heatGenFiring : 0;
    u.heat = Math.max(0, u.heat + (gen - u.stats.heatDissipation) * dt);
    if (u.heat >= GAME_BALANCE.OVERHEAT_THRESHOLD && !u.isOverheated) {
      u.isOverheated = true;
    } else if (u.isOverheated && u.heat <= GAME_BALANCE.OVERHEAT_RECOVER) {
      u.isOverheated = false;
    }
  }

  /**
   * Moves a unit toward a goal: straight while the line is clear (as on an open field), otherwise
   * along an A* route around trees and rocks. Swamp slows the step down.
   */
  private steer(u: GameUnit, goal: Vector2D, maxSpeed: number, dt: number, accelModel = false): boolean {
    const heavy = u.kind === 'combat' && u.design.chassisId === 'heavy_quad';
    const speed = maxSpeed * this.terrain.speedFactor(u.pos, heavy);
    const next = this.terrain.hasObstacles ? this.waypoint(u, goal) : goal;
    return this.moveToward(u, next, speed, dt, accelModel);
  }

  /** The point to head for now: the goal itself, or the current waypoint of a detour. */
  private waypoint(u: GameUnit, goal: Vector2D): Vector2D {
    const now = this.gameTime;
    const r = u.radius;
    let nav = u.nav;
    if (!nav || now - nav.lastSteerAt > 1) {
      nav = u.nav = { goal: { ...goal }, path: null, idx: 0, recheckAt: 0, plannedAt: -999, stuckPos: { ...u.pos }, stuckAt: now, lastSteerAt: now };
    }
    nav.lastSteerAt = now;

    // Stuck detector: barely moved for 2 s while the goal is still far away → plan a fresh route
    let stuck = false;
    if (now - nav.stuckAt > 2) {
      stuck = dist(u.pos, nav.stuckPos) < 0.6 && dist(u.pos, goal) > 3;
      nav.stuckPos = { ...u.pos };
      nav.stuckAt = now;
    }

    const goalMoved = dist(nav.goal, goal) > 2.5;
    if (stuck || goalMoved || now >= nav.recheckAt) {
      const jitter = navJitter(u.id);
      if (!stuck && this.terrain.segmentClear(u.pos, goal, r * 0.9)) {
        nav.path = null;
        nav.goal = { ...goal };
        nav.recheckAt = now + 0.35 + jitter;
      } else if (stuck || goalMoved || !nav.path || now - nav.plannedAt > 4) {
        if (this.pathBudget > 0) {
          this.pathBudget--;
          nav.path = this.pathfinder.findPath(u.pos, goal, r);
          nav.idx = 0;
          nav.plannedAt = now;
          nav.goal = { ...goal };
          nav.recheckAt = now + 0.8 + jitter;
        } else {
          nav.recheckAt = now; // over the tick's search budget: try again next tick
        }
      } else {
        nav.recheckAt = now + 0.8 + jitter;
        // skip waypoints that are already in a clear straight line
        const path = nav.path;
        while (nav.idx < path.length - 1 && this.terrain.segmentClear(u.pos, path[nav.idx + 1], r * 0.9)) nav.idx++;
      }
    }
    const path = nav.path;
    if (!path) return goal;
    while (nav.idx < path.length - 1 && dist(u.pos, path[nav.idx]) < 1.2) nav.idx++;
    return path[nav.idx];
  }

  /** Acceleration-limited movement that slides along trees and rocks. Returns true when the unit actually moved. */
  private moveToward(u: GameUnit, goal: Vector2D, maxSpeed: number, dt: number, accelModel = false): boolean {
    const dx = goal.x - u.pos.x;
    const dy = goal.y - u.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) return false;
    const accel = accelModel && u.kind === 'combat' ? u.stats.accel : 12;
    u.vel = Math.min(maxSpeed, u.vel + accel * dt);
    const step = Math.min(d, u.vel * dt);
    const nx = u.pos.x + (dx / d) * step;
    const ny = u.pos.y + (dy / d) * step;
    const targetFacing = Math.atan2(dy, dx);
    u.facing = lerpAngle(u.facing, targetFacing, Math.min(1, dt * 6));
    if (!this.terrain.hasObstacles) {
      u.pos.x = nx;
      u.pos.y = ny;
      return step > 0.001;
    }
    const r = u.radius * TERRAIN_COLLISION_SLACK;
    const here = this.terrain.clearanceAt(u.pos);
    // a step is allowed when it keeps the body clear of trees, or at least gets it further from them
    const ok = (x: number, y: number) => {
      const c = this.terrain.clearanceAt({ x, y });
      return c >= r || c > here;
    };
    if (ok(nx, ny)) {
      u.pos.x = nx;
      u.pos.y = ny;
    } else if (ok(nx, u.pos.y)) {
      u.pos.x = nx;
    } else if (ok(u.pos.x, ny)) {
      u.pos.y = ny;
    } else {
      u.vel *= 0.5;
      return false;
    }
    return step > 0.001;
  }

  private brake(u: GameUnit, dt: number) {
    const decel = u.kind === 'combat' ? u.stats.accel * 1.5 : 12;
    u.vel = Math.max(0, u.vel - decel * dt);
  }

  private applySeparation(dt: number) {
    const list = this.units;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.state === 'dead') continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.state === 'dead') continue;
        const minD = a.radius + b.radius;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = Math.min(0.5, (minD - d) * 0.5) * Math.min(1, dt * 12);
        const nx = dx / d;
        const ny = dy / d;
        a.pos.x -= nx * push;
        a.pos.y -= ny * push;
        b.pos.x += nx * push;
        b.pos.y += ny * push;
      }
      // keep units out of buildings
      for (const bld of this.buildings) {
        const dx = a.pos.x - bld.pos.x;
        const dy = a.pos.y - bld.pos.y;
        const d = Math.hypot(dx, dy);
        const minD = bld.radius + a.radius * 0.6;
        if (d < minD && d > 1e-4) {
          a.pos.x = bld.pos.x + (dx / d) * minD;
          a.pos.y = bld.pos.y + (dy / d) * minD;
        }
      }
      // the crowd must not shove a machine into the trees
      this.terrain.pushOut(a.pos, a.radius * TERRAIN_PUSHOUT);
    }
  }

  private fire(shooter: CombatUnit, target: GameUnit | Building) {
    const s = shooter.stats;
    shooter.lastShotAt = this.gameTime;
    if (s.weaponKind === 'melee') {
      this.addEffect('melee', target.pos, shooter.team, 1);
      this.applyDamage(target, s.volleyDamage, s.armorPierce, shooter.team, shooter.id);
      this.sound.shot('melee', shooter.team);
      return;
    }
    const kind = s.weaponKind || 'kinetic';
    const speed = kind === 'explosive' ? 26 : kind === 'energy' ? 40 : s.effectiveRange > 25 ? 95 : 48;
    const muzzle = {
      x: shooter.pos.x + Math.cos(shooter.facing) * shooter.radius,
      y: shooter.pos.y + Math.sin(shooter.facing) * shooter.radius,
    };
    this.projectiles.push({
      id: `proj_${this.nextId++}`,
      team: shooter.team,
      sourceId: shooter.id,
      targetId: target.id,
      from: { ...muzzle },
      to: { x: target.pos.x + (Math.random() - 0.5) * 0.8, y: target.pos.y + (Math.random() - 0.5) * 0.8 },
      pos: { ...muzzle },
      progress: 0,
      speed,
      damage: s.volleyDamage,
      kind,
      splash: s.splashRadius,
      armorPierce: s.armorPierce,
    });
    this.addEffect('muzzle', muzzle, shooter.team, kind === 'explosive' ? 1.6 : 0.8);
    this.sound.shot(kind, shooter.team);
  }

  private updateTurrets(dt: number) {
    for (const b of this.buildings) {
      if (b.type !== 'command_center') continue;
      b.turretCooldown -= dt;
      if (b.turretCooldown > 0) continue;
      const target = this.nearestEnemyUnit(b.team, b.pos, GAME_BALANCE.HQ_TURRET_RANGE + b.radius, true);
      if (!target) continue;
      b.turretCooldown = GAME_BALANCE.HQ_TURRET_INTERVAL;
      const from = { x: b.pos.x, y: b.pos.y };
      this.projectiles.push({
        id: `proj_${this.nextId++}`,
        team: b.team,
        sourceId: b.id,
        targetId: target.id,
        from,
        to: { ...target.pos },
        pos: { ...from },
        progress: 0,
        speed: 55,
        damage: GAME_BALANCE.HQ_TURRET_DAMAGE,
        kind: 'turret',
        splash: 0,
        armorPierce: 0.2,
      });
      this.sound.shot('turret', b.team);
    }
  }

  /** Nearest enemy unit; with `needSight` only one our side sees and in a clear line from `pos` (turrets). */
  private nearestEnemyUnit(team: Team, pos: Vector2D, radius: number, needSight = false): GameUnit | null {
    let best: GameUnit | null = null;
    let bestD = radius;
    for (const o of this.units) {
      if (o.team === team || o.state === 'dead') continue;
      const d = dist(o.pos, pos);
      if (needSight && d < bestD && (!this.vision.sees(team, o.id) || !this.terrain.lineOfSight(pos, o.pos))) continue;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      // Home on moving targets so projectiles visibly connect
      const t = this.units.find(u => u.id === p.targetId);
      if (t && t.state !== 'dead') p.to = { x: t.pos.x, y: t.pos.y };
      const dx = p.to.x - p.from.x;
      const dy = p.to.y - p.from.y;
      const total = Math.max(0.1, Math.hypot(dx, dy));
      p.progress = Math.min(1, p.progress + (p.speed * dt) / total);
      p.pos.x = p.from.x + dx * p.progress;
      p.pos.y = p.from.y + dy * p.progress;
      if (p.progress >= 1) this.impact(p);
    }
    this.projectiles = this.projectiles.filter(p => p.progress < 1);
  }

  private impact(p: Projectile) {
    const target: GameUnit | Building | undefined =
      this.units.find(u => u.id === p.targetId && u.state !== 'dead') ?? this.buildings.find(b => b.id === p.targetId);
    if (target) this.applyDamage(target, p.damage, p.armorPierce, p.team, p.sourceId);
    this.addEffect(p.kind === 'explosive' ? 'explosion' : 'hit', p.pos, p.team, p.kind === 'explosive' ? p.splash : 0.7);
    if (p.splash > 0) {
      for (const u of this.units) {
        if (u.team === p.team || u.state === 'dead' || u.id === p.targetId) continue;
        if (dist(u.pos, p.pos) <= p.splash) this.applyDamage(u, p.damage * 0.5, p.armorPierce, p.team, p.sourceId);
      }
    }
  }

  private applyDamage(target: GameUnit | Building, raw: number, pierce: number, sourceTeam: Team, sourceId: string) {
    if (target.team === sourceTeam) return;
    if ('kind' in target) {
      if (target.state === 'dead') return;
      let dmg = raw;
      if (target.kind === 'combat') dmg *= 1 - target.stats.armorRating * (1 - pierce);
      target.hp -= Math.max(1, dmg);
      target.lastDamagedAt = this.gameTime;
      if (target.kind === 'harvester' && this.throttled(`harv_attack_${target.team}`, 25)) {
        this.pushEvent(target.team, 'harvester_attacked', tr('event.harvestersAttacked'), true);
      }
      if (target.hp <= 0) this.killUnit(target, sourceTeam, sourceId);
      return;
    }

    // Building
    const b = target;
    if (b.hp <= 0) return;
    b.hp -= Math.max(1, raw * (1 - GAME_BALANCE.BUILDING_ARMOR * (1 - pierce)));
    b.lastDamagedAt = this.gameTime;
    if (this.throttled(`base_attack_${b.team}`, 25)) {
      const what = b.type === 'command_center' ? 'event.attackHq' : b.type === 'factory' ? 'event.attackFactory' : 'event.attackPlant';
      this.pushEvent(b.team, 'base_attack', tr(what), true);
    }
    if (b.hp <= 0) {
      this.addEffect('big_explosion', b.pos, b.team, b.radius * 1.4);
      this.sound.explosion(true);
      if (b.type !== 'command_center') {
        this.buildings = this.buildings.filter(x => x.id !== b.id);
        this.pushEvent(b.team, 'base_attack', tr(b.type === 'factory' ? 'event.factoryDestroyed' : 'event.plantDestroyed'), true);
      }
    }
  }

  private killUnit(u: GameUnit, killerTeam: Team, killerId: string) {
    u.state = 'dead';
    u.hp = 0;
    this.sound.explosion(false);
    this.addEffect(u.kind === 'combat' && u.design.chassisId === 'heavy_quad' ? 'big_explosion' : 'explosion', u.pos, u.team, u.radius);
    const metal = u.kind === 'combat' ? Math.round(u.stats.metalCost * GAME_BALANCE.SCRAP_SALVAGE_PERCENT) : 25;
    this.scrapPiles.push({ id: `scrap_${this.nextId++}`, pos: { ...u.pos }, metal, createdAt: this.gameTime });

    const killer = this.units.find(k => k.id === killerId);
    if (killer && killer.kind === 'combat') killer.kills++;
    this.teams[killerTeam].economy.totals.kills++;

    const econ = this.teams[u.team].economy;
    if (u.kind === 'harvester') {
      econ.totals.harvestersLost++;
      this.pushEvent(u.team, 'loss', tr('event.harvesterLost'), false);
    } else {
      econ.totals.unitsLost++;
      const times = this.lossTimes[u.team];
      times.push(this.gameTime);
      while (times.length && this.gameTime - times[0] > 20) times.shift();
      if (times.length >= 4 && this.throttled(`heavy_losses_${u.team}`, 20)) {
        this.pushEvent(u.team, 'heavy_losses', tr('event.heavyLosses', { count: times.length }), true);
      }
    }
  }

  /** Detects when a new enemy design shows up near our forces (a significant event). */
  private updateSightings(dt: number) {
    this.sightingTimer -= dt;
    if (this.sightingTimer > 0) return;
    this.sightingTimer = 1;
    for (const u of this.units) {
      if (u.kind !== 'combat' || u.state === 'dead') continue;
      const observer = opposite(u.team);
      if (!this.vision.sees(observer, u.id)) continue;
      const seen = this.seenDesigns[observer];
      const signature = designSignature(u.design);
      const memo = this.designIntel[observer].get(signature);
      if (memo && memo.lastSeenAt === this.gameTime) memo.lastCount++;
      else this.designIntel[observer].set(signature, { design: u.design, lastSeenAt: this.gameTime, lastCount: 1 });
      if (seen.has(signature)) continue;
      seen.add(signature);
      const chassis = CHASSIS_CATALOG[u.design.chassisId] ? chassisName(u.design.chassisId) : u.design.chassisId;
      const weapons = u.design.modules
        .map(id => MODULES_CATALOG[id])
        .filter(m => m && m.category === 'weapon')
        .map(m => partName(m.id))
        .join(', ');
      const first = seen.size === 1;
      this.pushEvent(
        observer,
        'enemy_new_design',
        first
          ? tr('event.firstSighting', { name: u.design.name, chassis, weapons: weapons || tr('event.noWeapons') })
          : tr('event.newEnemyModel', { name: u.design.name, chassis, weapons: weapons || tr('event.noWeapons') }),
        !first,
      );
    }
  }

  private updateScrap() {
    this.scrapPiles = this.scrapPiles.filter(s => this.gameTime - s.createdAt < GAME_BALANCE.SCRAP_DECAY_TIME_SEC && s.metal > 0.5);
  }

  private checkVictory() {
    if (this.arena) return;
    const p = this.getHQ('player');
    const e = this.getHQ('enemy');
    if (!e || e.hp <= 0) this.gameOver = 'player_won';
    else if (!p || p.hp <= 0) this.gameOver = 'enemy_won';
  }

  private cleanup() {
    this.units = this.units.filter(u => u.state !== 'dead');
    this.effects = this.effects.filter(e => this.gameTime - e.time < 2);
    if (this.events.length > 120) this.events.length = 120;
  }

  // ───────────────────────────── Events & effects ─────────────────────────────

  public pushEvent(team: Team | 'neutral', type: GameEventType, text: string, significant: boolean) {
    this.events.unshift({ id: this.nextEventId++, team, type, text, time: this.gameTime, significant });
    if (significant && team !== 'neutral') this.significantCounter[team]++;
  }

  private addEffect(type: VisualEffect['type'], pos: Vector2D, team: Team | 'neutral', size: number) {
    this.effects.push({ id: this.nextEffectId++, type, pos: { ...pos }, team, size, time: this.gameTime });
  }

  private throttled(key: string, intervalSec: number): boolean {
    const last = this.throttle[key] ?? -Infinity;
    if (this.gameTime - last < intervalSec) return false;
    this.throttle[key] = this.gameTime;
    return true;
  }

  // ───────────────────────────── Compact summaries for agents (short context, brief §10) ─────────────────────────────

  public armySummary(team: Team): ArmySummary {
    const units = this.units.filter(u => u.team === team && u.state !== 'dead');
    // the campaign garrison never leaves its HQ: it is not part of the army the commander plans with
    const combat = units.filter((u): u is CombatUnit => u.kind === 'combat' && !u.garrison);
    const byRole: Record<string, number> = {};
    const designs = new Map<string, number>();
    let hpSum = 0;
    let frontX: number | null = null;
    for (const c of combat) {
      byRole[c.design.tacticalRole] = (byRole[c.design.tacticalRole] || 0) + 1;
      designs.set(c.design.name, (designs.get(c.design.name) || 0) + 1);
      hpSum += c.hp / c.maxHp;
      frontX = frontX === null ? c.pos.x : team === 'player' ? Math.max(frontX, c.pos.x) : Math.min(frontX, c.pos.x);
    }
    return {
      combatUnits: combat.length,
      harvesters: units.filter(u => u.kind === 'harvester').length,
      avgHpPct: combat.length ? Math.round((hpSum / combat.length) * 100) : 0,
      byRole,
      frontX: frontX === null ? null : Math.round(frontX),
      designs: [...designs.entries()].map(([name, count]) => ({ name, count })),
    };
  }

  /**
   * The scouting report: enemy designs this team has seen (no omniscience). `count` is how many are
   * in sight now, or how many were seen at the last sighting; models seen in the last minute come first.
   */
  public observedEnemyDesigns(team: Team): { design: RobotDesign; count: number; inSight: number; lastSeenSec: number }[] {
    const inSight = new Map<string, number>();
    for (const u of this.units) {
      if (u.team === team || u.kind !== 'combat' || u.state === 'dead' || !this.vision.sees(team, u.id)) continue;
      const signature = designSignature(u.design);
      inSight.set(signature, (inSight.get(signature) ?? 0) + 1);
    }
    const out = [...this.designIntel[team].entries()].map(([signature, m]) => {
      const now = inSight.get(signature) ?? 0;
      return { design: m.design, count: now || m.lastCount, inSight: now, lastSeenSec: Math.round(this.gameTime - m.lastSeenAt) };
    });
    const recent = (x: { lastSeenSec: number }) => (x.lastSeenSec <= 60 ? 0 : 1);
    return out.sort((a, b) => recent(a) - recent(b) || b.count - a.count || a.lastSeenSec - b.lastSeenSec);
  }

  /** What this team knows about the enemy army: machines in sight and the last contact. */
  public enemyIntel(team: Team): EnemyIntel {
    return this.vision.intel(this, team);
  }

  public recentEvents(team: Team, max = 5, sinceSec = 90): GameEvent[] {
    return this.events
      .filter(e => (e.team === team || e.team === 'neutral') && this.gameTime - e.time <= sinceSec && e.type !== 'intercept' && e.type !== 'ai')
      .slice(0, max);
  }

  public baseHpPct(team: Team): number {
    const hq = this.getHQ(team);
    return hq ? Math.round((hq.hp / hq.maxHp) * 100) : 0;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
