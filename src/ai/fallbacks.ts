import { GAME_BALANCE, PAD_BUILDINGS } from '../config/balance';
import { commanderDesignName, commanderTaunt } from '../config/commanders';
import { Doctrine } from '../config/levels';
import { GameState, opposite } from '../engine/GameState';
import { RobotBuilder } from '../engine/RobotBuilder';
import { PadBuildingType, ProductionAction, TacticalPlan, Team } from '../types/game';
import { ChassisType, RobotDesign, TacticalRole } from '../types/robot';
import { describePlan } from './parsing';
import { MessageKey, t as tr } from '../i18n';

/**
 * Local heuristics used when the cloud LLM is unavailable (no key, offline, error, or the
 * coin limit is exhausted). They keep the game playable and honest: the UI labels every
 * such answer as coming from the local co-processor. Orders are matched by word stems in
 * Russian, English and Italian; replies come in the game language.
 */

const has = (text: string, ...keys: string[]) => keys.some(k => text.includes(k));

function numberIn(text: string): number | null {
  const m = text.match(/\d+/);
  return m ? Number(m[0]) : null;
}

export interface EngineerDraft {
  reply: string;
  design: RobotDesign | null;
  actions: ProductionAction[];
  compromise: string;
}

export function localEngineer(order: string, current: RobotDesign): EngineerDraft {
  const p = order.toLowerCase();
  const actions: ProductionAction[] = [];
  const replies: string[] = [];

  // Stop / resume the factories ("останови производство, копим на электростанцию")
  const aboutProduction = has(p, 'производств', 'завод', 'конвейер', 'выпуск', 'сборк', 'production', 'factor', 'assembly', 'produzion', 'fabbric', 'catena', 'assembl');
  const stop =
    aboutProduction &&
    has(p, 'останов', 'стоп', 'пауз', 'прекрат', 'приостанов', 'не выпуска', 'хватит', 'stop', 'pause', 'halt', 'ferma', 'pausa', 'sospend', 'interromp');
  const resume =
    aboutProduction &&
    !stop &&
    has(p, 'возобнов', 'продолж', 'запусти', 'включи', 'сними с пауз', 'сними паузу', 'resume', 'restart', 'continue', 'start', 'unpause', 'riprend', 'riavvi', 'continu', 'avvia', 'ripart');
  if (stop || resume) {
    actions.push({ type: 'set_production', paused: stop });
    replies.push(stop ? tr('le.stop') : tr('le.resume'));
  }

  if (has(p, 'добытчик', 'сборщик', 'харвест', 'шахтёр', 'шахтер', 'harvester', 'miner', 'raccoglitor', 'minator')) {
    const n = Math.max(1, Math.min(4, numberIn(p) ?? 1));
    actions.push({ type: 'build_harvester', count: n });
    replies.push(tr('le.harvesters', { count: n }));
  }
  if (
    has(p, 'электростанц', 'генератор баз', 'энергостанц', 'power plant', 'power station', 'centrale') ||
    (has(p, 'энерг', 'power', 'energ') && has(p, 'построй', 'добавь', 'нужн', 'build', 'add', 'need', 'costruisci', 'aggiung', 'serve'))
  ) {
    actions.push({ type: 'build_power_plant' });
    replies.push(tr('le.powerPlant'));
  }
  if (
    !stop &&
    !resume &&
    has(p, 'завод', 'factory', 'fabbrica') &&
    has(p, 'построй', 'втор', 'ещё', 'еще', 'нов', 'build', 'second', 'another', 'new', 'costruisci', 'second', 'altra', 'nuova')
  ) {
    actions.push({ type: 'build_factory' });
    replies.push(tr('le.factory'));
  }
  // pad buildings by name ("поставь турель у базы", "build a repair dock")
  const padWords: [PadBuildingType, string[]][] = [
    ['turret', ['турел', 'turret', 'torrett']],
    ['repair_dock', ['ремонтный док', 'ремонтн', 'repair dock', 'officina']],
    ['radar', ['радарную вышк', 'радарная вышк', 'вышк', 'radar tower', 'torre radar']],
    ['depot', ['пункт приём', 'пункт прием', 'drop-off', 'depot', 'punto di raccolta']],
  ];
  for (const [building, words] of padWords) {
    if (!has(p, ...words)) continue;
    const forward = has(p, 'передов', 'фронт', 'forward', 'front', 'avanzat');
    actions.push({ type: 'build', building, ...(forward || building === 'depot' ? { where: 'forward' as const } : { where: 'base' as const }) });
    replies.push(tr('le.padBuilding', { name: tr(`building.${building}` as MessageKey) }));
  }
  if (has(p, 'парти', 'batch', 'lotto', 'lotti') && numberIn(p) !== null) {
    actions.push({ type: 'set_batch_size', size: numberIn(p)! });
    replies.push(tr('le.batch', { n: numberIn(p)! }));
  }

  let chassisId: ChassisType = current.chassisId;
  let modules = [...current.modules];
  let role: TacticalRole = current.tacticalRole;
  let name = '';
  let compromise = '';
  let designIntent = true;

  if (has(p, 'тяж', 'осад', '120', 'артил', 'heavy', 'siege', 'artiller', 'pesant', 'assedio', 'artiglier')) {
    chassisId = 'heavy_quad';
    modules = ['reinforced_steel', 'heavy_siege_cannon', 'diesel_electric', 'radar_sensor'];
    role = 'artillery';
    name = tr('design.hammer');
    compromise = tr('le.c.hammer');
  } else if (has(p, 'снайпер', 'рельс', 'дальнобой', 'издалека', 'sniper', 'rail', 'long range', 'long-range', 'from afar', 'cecchin', 'lunga gittata', 'lontano')) {
    chassisId = 'medium_tracked';
    modules = ['reinforced_steel', 'sniper_railgun', 'diesel_electric', 'radar_sensor'];
    role = 'anti_armor';
    name = tr('design.phantom');
    compromise = tr('le.c.phantom');
  } else if (has(p, 'пил', 'ближн', 'в упор', 'потрошит', 'saw', 'melee', 'point-blank', 'sega', 'corpo a corpo', 'bruciapelo')) {
    chassisId = 'light_biped';
    modules = ['light_composite', 'melee_buzzsaw', 'micro_turbine'];
    role = 'skirmisher';
    name = tr('design.whirlwind');
    compromise = tr('le.c.whirlwind');
  } else if (has(p, 'дешев', 'дёшев', 'массов', 'эконом', 'рой', 'cheap', 'swarm', 'mass', 'economic', 'sciame', 'massa')) {
    chassisId = 'light_biped';
    modules = ['light_composite', 'autocannon_20mm'];
    role = 'frontline';
    name = tr('design.locust');
    compromise = tr('le.c.locust');
  } else if (has(p, 'плазм', 'plasma')) {
    chassisId = chassisId === 'light_biped' ? 'medium_tracked' : chassisId;
    modules = ['reinforced_steel', 'plasma_blasters', 'heat_radiator'];
    role = 'anti_armor';
    name = tr('design.smelter');
    compromise = tr('le.c.smelter');
  } else if (has(p, 'брон', 'защит', 'крепч', 'живуч', 'armor', 'armour', 'protect', 'tough', 'durab', 'corazz', 'protez', 'resistent', 'robust')) {
    const upgraded = modules.map(m => (m === 'light_composite' ? 'reinforced_steel' : m === 'reinforced_steel' ? 'sloped_reactive' : m));
    if (!upgraded.some(m => m.includes('composite') || m.includes('steel') || m.includes('reactive'))) upgraded.unshift('reinforced_steel');
    modules = upgraded;
    const slower = has(p, 'меньше скорост', 'скоростью можно', 'пожертв', 'less speed', 'sacrific', 'slower', 'meno velocit', 'più lent');
    if (slower && chassisId === 'light_biped') chassisId = 'medium_tracked';
    role = 'frontline';
    name = tr('design.bastion');
    compromise = tr('le.c.bastion');
  } else if (has(p, 'быстр', 'скорост', 'манёвр', 'маневр', 'фланг', 'fast', 'speed', 'quick', 'manoeuv', 'maneuv', 'flank', 'veloc', 'rapid', 'manovr', 'fianc')) {
    modules = modules.map(m => (m === 'sloped_reactive' ? 'reinforced_steel' : m === 'reinforced_steel' ? 'light_composite' : m));
    if (!modules.includes('micro_turbine')) modules.push('micro_turbine');
    role = 'skirmisher';
    name = tr('design.swift');
    compromise = tr('le.c.swift');
  } else if (has(p, 'охлажд', 'радиатор', 'перегрев', 'cool', 'radiator', 'overheat', 'raffredd', 'radiatore', 'surriscald')) {
    if (!modules.includes('heat_radiator')) modules.push('heat_radiator');
    name = current.name.replace(/ Mk-.*$/, '');
    compromise = tr('le.c.radiator');
  } else if (has(p, 'радар', 'дальност', 'radar', 'range', 'gittata')) {
    if (!modules.includes('radar_sensor')) modules.push('radar_sensor');
    name = current.name.replace(/ Mk-.*$/, '');
    compromise = tr('le.c.radar');
  } else if (has(p, 'баланс', 'универс', 'улучш', 'модерн', 'сильн', 'balanc', 'universal', 'improve', 'upgrade', 'modern', 'strong', 'bilanc', 'miglior', 'potenz', 'fort')) {
    chassisId = 'medium_tracked';
    modules = ['reinforced_steel', 'autocannon_20mm', 'plasma_blasters', 'heat_radiator'];
    role = 'balanced';
    name = tr('design.centurion');
    compromise = tr('le.c.centurion');
  } else {
    designIntent = false;
  }

  let design: RobotDesign | null = null;
  if (designIntent) {
    const draft: RobotDesign = {
      ...current,
      id: `local_${Date.now().toString(36)}`,
      name: `${name || current.name.replace(/ Mk-.*$/, '')} Mk-${current.version + 1}`,
      chassisId,
      modules,
      tacticalRole: role,
      version: current.version + 1,
      createdAt: Date.now(),
    };
    const repaired = RobotBuilder.repairDesign(draft);
    design = repaired.design;
    if (repaired.notes.length) compromise = [compromise, ...repaired.notes].filter(Boolean).join('; ');
    replies.unshift(tr('le.built', { name: design.name, tradeoffs: RobotBuilder.calculateStats(design).tradeoffsSummaryRu }));
  }

  if (!design && actions.length === 0) {
    replies.push(tr('le.unclear'));
  }

  return { reply: replies.join(' '), design, actions, compromise };
}

export function localTactician(order: string, prev: TacticalPlan): { reply: string; plan: TacticalPlan } {
  const p = order.toLowerCase();
  const plan: TacticalPlan = { ...prev, source: 'fallback' };
  const notes: string[] = [];

  if (has(p, 'не отступ', 'без отступ', 'до последнего', "don't retreat", 'no retreat', 'never retreat', 'to the last', 'non ritirar', 'senza ritirat', "fino all'ultimo", 'fino all’ultimo')) {
    plan.retreatHpThreshold = 0;
    notes.push(tr('lt.noRetreat'));
  } else if (has(p, 'отступ', 'ремонт', 'чини', 'береги', 'сохран', 'retreat', 'repair', 'fix', 'preserve', 'ritir', 'ripar', 'preserv')) {
    const n = numberIn(p);
    plan.retreatHpThreshold = n !== null && n <= 60 ? n : 35;
    notes.push(tr('lt.retreat', { n: plan.retreatHpThreshold }));
  }
  if (has(p, 'рейд', 'добыч врага', 'добытчиков врага', 'сборщиков врага', 'экономик врага', 'raid', 'enemy harvester', 'enemy mining', 'enemy economy', 'incursion', 'raccoglitori nemici', 'economia nemica')) {
    plan.stance = 'raid_economy';
    plan.targetPriority = 'scouts_harvesters';
    notes.push(tr('lt.raid'));
  } else if (has(p, 'защищ баз', 'оборон баз', 'к базе', 'домой', 'defend the base', 'defend base', 'back to base', 'fall back', 'home', 'difendi la base', 'difesa della base', 'alla base', 'a casa')) {
    plan.stance = 'defend_base';
    notes.push(tr('lt.defend'));
  } else if (has(p, 'держ', 'центр', 'линию', 'стой', 'оборон', 'hold', 'centre', 'center', 'the line', 'stand', 'tenete', 'tieni', 'centro', 'linea')) {
    plan.stance = 'hold_center';
    notes.push(tr('lt.hold'));
  } else if (has(p, 'атак', 'наступ', 'вперёд', 'вперед', 'штурм', 'дави', 'в атаку', 'attack', 'advance', 'forward', 'assault', 'push', 'charge', 'attacc', 'avanz', 'avanti', 'assalto', 'carica')) {
    plan.stance = 'advance';
    notes.push(tr('lt.advance'));
  }
  if (has(p, 'дальн', 'дистанц', 'издалека', 'кайт', 'long range', 'distance', 'from afar', 'kite', 'max range', 'distanza', 'lontano', 'gittata')) {
    plan.engagementRange = 'max_range';
    notes.push(tr('lt.maxRange'));
  } else if (has(p, 'вплотную', 'ближн', 'в упор', 'сблиз', 'close', 'point-blank', 'melee', 'brawl', 'vicino', 'ravvicin', 'corpo a corpo', 'bruciapelo')) {
    plan.engagementRange = 'close_brawl';
    notes.push(tr('lt.close'));
  }
  if (has(p, 'тяжёл', 'тяжел', 'опасн', 'heav', 'dangerous', 'threat', 'pesant', 'pericolos', 'minacc')) plan.targetPriority = 'high_threat_heavies';
  if (has(p, 'фокус', 'по одному', 'сосредоточ', 'focus', 'one by one', 'concentrat', 'concentr', 'uno alla volta')) plan.targetPriority = 'focus_fire';
  if (has(p, 'здани', 'построй', 'завод врага', 'базу врага', 'штаб врага', 'building', 'structure', 'enemy factory', 'enemy base', 'enemy hq', 'edific', 'struttur', 'fabbrica nemica', 'base nemica', 'qg nemico')) {
    plan.targetPriority = 'buildings';
  }
  if (has(p, 'охран', 'прикр', 'защищай добыт', 'защищай сбор', 'guard', 'cover', 'escort', 'protect the harvest', 'proteggi', 'copri', 'scorta')) {
    plan.guardHarvesters = true;
    notes.push(tr('lt.guard'));
  }
  plan.summaryRu = describePlan(plan);
  const reply = notes.length ? tr('lt.accepted', { notes: notes.join(', ') }) : tr('lt.unclear');
  return { reply, plan };
}

export interface EnemyDraft {
  taunt: string;
  design: RobotDesign | null;
  plan: TacticalPlan;
  actions: ProductionAction[];
}

/**
 * The rule-based commander plays by the fog of war too: it counts the enemy machines in sight, or
 * the last contact if it was recent; with no recent contact it assumes parity and stays careful.
 */
function estimateEnemyArmy(state: GameState, team: Team, mine: number): number {
  const i = state.enemyIntel(team);
  if (i.radar) return i.radar.total;
  if (i.visible) return i.visible;
  if (i.lastContactAgo !== null && i.lastContactAgo < 90) return i.lastCount;
  return mine;
}

/**
 * Army stance by the level's doctrine: a defensive general holds its base and counter-attacks only
 * with a clear edge; an aggressive one pushes early.
 */
function doctrineStance(doctrine: Doctrine, mine: number, theirs: number, time: number): TacticalPlan['stance'] {
  switch (doctrine) {
    case 'defensive':
      // holds the line in front of its wall, falls back home early, counter-attacks only with a clear edge
      if (mine >= theirs * 1.4 + 3 || time > 600) return 'advance';
      return mine + 2 < theirs ? 'defend_base' : 'hold_center';
    case 'aggressive':
      if (mine >= theirs + 1 || time > 120) return 'advance';
      return mine + 4 < theirs ? 'defend_base' : 'hold_center';
    default:
      if (mine >= theirs * 1.3 + 2) return 'advance';
      if (mine + 3 < theirs) return 'defend_base';
      return time > 240 ? 'advance' : 'hold_center';
  }
}

/** Rule-based counter-building commander (the classic game AI) for either side. */
export function localCommanderDecision(state: GameState, team: Team): EnemyDraft {
  const t = state.teams[team];
  const foe = opposite(team);
  const seen = state.observedEnemyDesigns(team);
  const top = seen[0]?.design;
  let design: RobotDesign | null = null;
  const next = (name: string, chassisId: ChassisType, modules: string[], role: TacticalRole): RobotDesign => ({
    ...t.design,
    id: `${team}_${Date.now().toString(36)}`,
    name: commanderDesignName(team, name, t.design.version + 1),
    chassisId,
    modules,
    tacticalRole: role,
    version: t.design.version + 1,
    createdAt: Date.now(),
  });

  const plan: TacticalPlan = { ...t.plan, source: 'fallback' };
  if (top) {
    const mods = top.modules;
    if (top.chassisId === 'heavy_quad' || mods.includes('heavy_siege_cannon') || mods.includes('sniper_railgun')) {
      design = next(tr('design.hound'), 'light_biped', ['light_composite', 'melee_buzzsaw', 'micro_turbine'], 'skirmisher');
      plan.engagementRange = 'close_brawl';
      plan.targetPriority = 'focus_fire';
    } else if (mods.includes('sloped_reactive') || (mods.includes('reinforced_steel') && top.chassisId !== 'light_biped')) {
      design = next(tr('design.smelter'), 'medium_tracked', ['reinforced_steel', 'plasma_blasters', 'heat_radiator'], 'anti_armor');
      plan.engagementRange = 'balanced';
      plan.targetPriority = 'high_threat_heavies';
    } else if (mods.includes('melee_buzzsaw')) {
      design = next(tr('design.warden'), 'medium_tracked', ['reinforced_steel', 'autocannon_20mm', 'heat_radiator'], 'frontline');
      plan.engagementRange = 'max_range';
    } else if (top.chassisId === 'light_biped') {
      design = next(tr('design.crusher'), 'medium_tracked', ['light_composite', 'autocannon_20mm', 'autocannon_20mm'], 'frontline');
      plan.engagementRange = 'balanced';
      plan.targetPriority = 'closest';
    }
    if (design && design.chassisId === t.design.chassisId && design.modules.join() === t.design.modules.join()) design = null;
  }

  const mine = state.armySummary(team).combatUnits;
  const theirs = estimateEnemyArmy(state, team, mine);
  plan.stance = doctrineStance(state.doctrine[team] ?? 'balanced', mine, theirs, state.gameTime);
  plan.guardHarvesters = state.recentEvents(team, 5).some(e => e.type === 'harvester_attacked');
  plan.summaryRu = describePlan(plan);

  const actions: ProductionAction[] = [];
  const econ = t.economy;
  const harvesters = state.harvesterCount(team) + state.harvestersInProduction(team);
  if (harvesters < 5 && mine >= 3 && econ.metal >= GAME_BALANCE.HARVESTER_COST_METAL) actions.push({ type: 'build_harvester', count: 1 });
  // a harvester builds and stops mining meanwhile: only with enough miners and a quiet base
  const canBuild = state.harvesterCount(team) >= 3 && !state.baseUnderFire(team) && state.constructionSites(team).length === 0;
  const padOk = (type: PadBuildingType, extra = 0) => {
    const spec = PAD_BUILDINGS[type];
    return state.canBuildOnPad(team, type, type === 'depot' ? undefined : 'base').ok && econ.metal >= spec.metal + extra;
  };
  const raided = state.recentEvents(team, 5, 60).some(e => e.type === 'base_attack');
  if (canBuild && econ.powerEfficiency < 0.95 && econ.metal >= GAME_BALANCE.POWER_PLANT_COST_METAL) actions.push({ type: 'build_power_plant' });
  else if (canBuild && raided && state.buildingCount(team, 'turret') < 2 && padOk('turret', 100)) actions.push({ type: 'build', building: 'turret', where: 'base' });
  else if (canBuild && state.gameTime > 240 && state.buildingCount(team, 'repair_dock') === 0 && padOk('repair_dock', 150)) {
    actions.push({ type: 'build', building: 'repair_dock', where: 'base' });
  } else if (canBuild && state.gameTime > 300 && state.buildingCount(team, 'radar') === 0 && padOk('radar', 200)) {
    actions.push({ type: 'build', building: 'radar', where: 'base' });
  } else if (canBuild && econ.metal > 750 && state.buildingCount(team, 'factory') < GAME_BALANCE.MAX_FACTORIES) actions.push({ type: 'build_factory' });

  return { taunt: commanderTaunt(team, Math.random()), design, plan, actions };
}

export function localEnemyDecision(state: GameState): EnemyDraft {
  return localCommanderDecision(state, 'enemy');
}
