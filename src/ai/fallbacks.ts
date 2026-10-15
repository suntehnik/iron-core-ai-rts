import { GAME_BALANCE } from '../config/balance';
import { COMMANDERS } from '../config/commanders';
import { GameState, opposite } from '../engine/GameState';
import { RobotBuilder } from '../engine/RobotBuilder';
import { ProductionAction, TacticalPlan, Team } from '../types/game';
import { ChassisType, RobotDesign, TacticalRole } from '../types/robot';
import { describePlan } from './parsing';

/**
 * Local heuristics used when the cloud LLM is unavailable (no key, offline, error, or the
 * coin limit is exhausted). They keep the game playable and honest: the UI labels every
 * such answer as coming from the local co-processor.
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
  const aboutProduction = has(p, 'производств', 'завод', 'конвейер', 'выпуск', 'сборк');
  const stop = aboutProduction && has(p, 'останов', 'стоп', 'пауз', 'прекрат', 'приостанов', 'не выпуска', 'хватит');
  const resume = aboutProduction && !stop && has(p, 'возобнов', 'продолж', 'запусти', 'включи', 'сними с пауз', 'сними паузу');
  if (stop || resume) {
    actions.push({ type: 'set_production', paused: stop });
    replies.push(stop ? 'Глушу конвейеры: металл копится, энергия свободна.' : 'Конвейеры снова в работе.');
  }

  if (has(p, 'добытчик', 'сборщик', 'харвест', 'шахтёр', 'шахтер')) {
    const n = numberIn(p) ?? 1;
    actions.push({ type: 'build_harvester', count: Math.max(1, Math.min(4, n)) });
    replies.push(`Выпущу ${Math.max(1, Math.min(4, n))} добытчик(а) — экономика скажет спасибо.`);
  }
  if (has(p, 'электростанц', 'генератор баз', 'энергостанц') || (has(p, 'энерг') && has(p, 'построй', 'добавь', 'нужн'))) {
    actions.push({ type: 'build_power_plant' });
    replies.push('Заложу электростанцию: +300 кВт в сеть базы.');
  }
  if (!stop && !resume && has(p, 'завод') && has(p, 'построй', 'втор', 'ещё', 'еще', 'нов')) {
    actions.push({ type: 'build_factory' });
    replies.push('Второй завод удвоит выпуск, но съест металл и энергию.');
  }
  if (has(p, 'парти') && numberIn(p) !== null) {
    actions.push({ type: 'set_batch_size', size: numberIn(p)! });
    replies.push(`Размер партии — ${numberIn(p)}.`);
  }

  let chassisId: ChassisType = current.chassisId;
  let modules = [...current.modules];
  let role: TacticalRole = current.tacticalRole;
  let name = '';
  let compromise = '';
  let designIntent = true;

  if (has(p, 'тяж', 'осад', '120', 'артил')) {
    chassisId = 'heavy_quad';
    modules = ['reinforced_steel', 'heavy_siege_cannon', 'diesel_electric', 'radar_sensor'];
    role = 'artillery';
    name = 'Молот';
    compromise = 'скорость упадёт, а для стрельбы машине нужно остановиться и развернуться';
  } else if (has(p, 'снайпер', 'рельс', 'дальнобой', 'издалека')) {
    chassisId = 'medium_tracked';
    modules = ['reinforced_steel', 'sniper_railgun', 'diesel_electric', 'radar_sensor'];
    role = 'anti_armor';
    name = 'Призрак';
    compromise = 'рельсотрону нужен генератор и время на развёртывание — в упор он беспомощен';
  } else if (has(p, 'пил', 'ближн', 'в упор', 'потрошит')) {
    chassisId = 'light_biped';
    modules = ['light_composite', 'melee_buzzsaw', 'micro_turbine'];
    role = 'skirmisher';
    name = 'Вихрь';
    compromise = 'брони почти нет — живут, пока бегут';
  } else if (has(p, 'дешев', 'дёшев', 'массов', 'эконом', 'рой')) {
    chassisId = 'light_biped';
    modules = ['light_composite', 'autocannon_20mm'];
    role = 'frontline';
    name = 'Саранча';
    compromise = 'по одному слабые, берут числом';
  } else if (has(p, 'плазм')) {
    chassisId = chassisId === 'light_biped' ? 'medium_tracked' : chassisId;
    modules = ['reinforced_steel', 'plasma_blasters', 'heat_radiator'];
    role = 'anti_armor';
    name = 'Плавильщик';
    compromise = 'плазма жрёт энергию и греет корпус, поэтому радиатор обязателен';
  } else if (has(p, 'брон', 'защит', 'крепч', 'живуч')) {
    const upgraded = modules.map(m => (m === 'light_composite' ? 'reinforced_steel' : m === 'reinforced_steel' ? 'sloped_reactive' : m));
    if (!upgraded.some(m => m.includes('composite') || m.includes('steel') || m.includes('reactive'))) upgraded.unshift('reinforced_steel');
    modules = upgraded;
    if (has(p, 'меньше скорост', 'скоростью можно', 'пожертв') && chassisId === 'light_biped') chassisId = 'medium_tracked';
    role = 'frontline';
    name = 'Бастион';
    compromise = 'броня тяжёлая: скорость и разгон заметно упадут';
  } else if (has(p, 'быстр', 'скорост', 'манёвр', 'маневр', 'фланг')) {
    modules = modules.map(m => (m === 'sloped_reactive' ? 'reinforced_steel' : m === 'reinforced_steel' ? 'light_composite' : m));
    if (!modules.includes('micro_turbine')) modules.push('micro_turbine');
    role = 'skirmisher';
    name = 'Стриж';
    compromise = 'облегчил броню ради скорости';
  } else if (has(p, 'охлажд', 'радиатор', 'перегрев')) {
    if (!modules.includes('heat_radiator')) modules.push('heat_radiator');
    name = current.name.replace(/ Mk-.*$/, '');
    compromise = 'радиатор занимает слот';
  } else if (has(p, 'радар', 'дальност')) {
    if (!modules.includes('radar_sensor')) modules.push('radar_sensor');
    name = current.name.replace(/ Mk-.*$/, '');
    compromise = 'радар потребляет энергию';
  } else if (has(p, 'баланс', 'универс', 'улучш', 'модерн', 'сильн')) {
    chassisId = 'medium_tracked';
    modules = ['reinforced_steel', 'autocannon_20mm', 'plasma_blasters', 'heat_radiator'];
    role = 'balanced';
    name = 'Центурион';
    compromise = 'дороже и дольше в сборке, чем лёгкие машины';
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
    replies.unshift(`Собрал «${design.name}»: ${RobotBuilder.calculateStats(design).tradeoffsSummaryRu}`);
  }

  if (!design && actions.length === 0) {
    replies.push('Не разобрал приказ, командир. Скажите, что усилить: броню, скорость, дальность или огневую мощь — или что построить.');
  }

  return { reply: replies.join(' '), design, actions, compromise };
}

export function localTactician(order: string, prev: TacticalPlan): { reply: string; plan: TacticalPlan } {
  const p = order.toLowerCase();
  const plan: TacticalPlan = { ...prev, source: 'fallback' };
  const notes: string[] = [];

  if (has(p, 'не отступ', 'без отступ', 'до последнего')) {
    plan.retreatHpThreshold = 0;
    notes.push('стоим до последнего');
  } else if (has(p, 'отступ', 'ремонт', 'чини', 'береги', 'сохран')) {
    const n = numberIn(p);
    plan.retreatHpThreshold = n !== null && n <= 60 ? n : 35;
    notes.push(`повреждённые уходят на ремонт при <${plan.retreatHpThreshold}%`);
  }
  if (has(p, 'рейд', 'добыч врага', 'добытчиков врага', 'сборщиков врага', 'экономик врага')) {
    plan.stance = 'raid_economy';
    plan.targetPriority = 'scouts_harvesters';
    notes.push('быстрые машины идут на вражескую добычу');
  } else if (has(p, 'защищ баз', 'оборон баз', 'к базе', 'домой')) {
    plan.stance = 'defend_base';
    notes.push('держим оборону у базы');
  } else if (has(p, 'держ', 'центр', 'линию', 'стой', 'оборон')) {
    plan.stance = 'hold_center';
    notes.push('держим линию у центра');
  } else if (has(p, 'атак', 'наступ', 'вперёд', 'вперед', 'штурм', 'дави', 'в атаку')) {
    plan.stance = 'advance';
    notes.push('наступаем');
  }
  if (has(p, 'дальн', 'дистанц', 'издалека', 'кайт')) {
    plan.engagementRange = 'max_range';
    notes.push('бьём с предельной дистанции');
  } else if (has(p, 'вплотную', 'ближн', 'в упор', 'сблиз')) {
    plan.engagementRange = 'close_brawl';
    notes.push('сближаемся вплотную');
  }
  if (has(p, 'тяжёл', 'тяжел', 'опасн')) plan.targetPriority = 'high_threat_heavies';
  if (has(p, 'фокус', 'по одному', 'сосредоточ')) plan.targetPriority = 'focus_fire';
  if (has(p, 'здани', 'построй', 'завод врага', 'базу врага', 'штаб врага')) plan.targetPriority = 'buildings';
  if (has(p, 'охран', 'прикр', 'защищай добыт', 'защищай сбор')) {
    plan.guardHarvesters = true;
    notes.push('прикрываем добытчиков');
  }
  plan.summaryRu = describePlan(plan);
  const reply = notes.length ? `Принято: ${notes.join(', ')}.` : 'Приказ не распознан, план без изменений. Уточните: наступать, держать центр, оборонять базу или рейд?';
  return { reply, plan };
}

export interface EnemyDraft {
  taunt: string;
  design: RobotDesign | null;
  plan: TacticalPlan;
  actions: ProductionAction[];
}

/** Rule-based counter-building commander (the classic game AI) for either side. */
export function localCommanderDecision(state: GameState, team: Team): EnemyDraft {
  const t = state.teams[team];
  const foe = opposite(team);
  const profile = COMMANDERS[team];
  const seen = state.observedEnemyDesigns(team);
  const top = seen[0]?.design;
  let design: RobotDesign | null = null;
  const next = (name: string, chassisId: ChassisType, modules: string[], role: TacticalRole): RobotDesign => ({
    ...t.design,
    id: `${team}_${Date.now().toString(36)}`,
    name: `${profile.designPrefix} ${name} Mk-${t.design.version + 1}`,
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
      design = next('Гончая', 'light_biped', ['light_composite', 'melee_buzzsaw', 'micro_turbine'], 'skirmisher');
      plan.engagementRange = 'close_brawl';
      plan.targetPriority = 'focus_fire';
    } else if (mods.includes('sloped_reactive') || (mods.includes('reinforced_steel') && top.chassisId !== 'light_biped')) {
      design = next('Плавильщик', 'medium_tracked', ['reinforced_steel', 'plasma_blasters', 'heat_radiator'], 'anti_armor');
      plan.engagementRange = 'balanced';
      plan.targetPriority = 'high_threat_heavies';
    } else if (mods.includes('melee_buzzsaw')) {
      design = next('Страж', 'medium_tracked', ['reinforced_steel', 'autocannon_20mm', 'heat_radiator'], 'frontline');
      plan.engagementRange = 'max_range';
    } else if (top.chassisId === 'light_biped') {
      design = next('Дробитель', 'medium_tracked', ['light_composite', 'autocannon_20mm', 'autocannon_20mm'], 'frontline');
      plan.engagementRange = 'balanced';
      plan.targetPriority = 'closest';
    }
    if (design && design.chassisId === t.design.chassisId && design.modules.join() === t.design.modules.join()) design = null;
  }

  const mine = state.armySummary(team).combatUnits;
  const theirs = state.armySummary(foe).combatUnits;
  if (mine >= theirs * 1.3 + 2) plan.stance = 'advance';
  else if (mine + 3 < theirs) plan.stance = 'defend_base';
  else plan.stance = state.gameTime > 240 ? 'advance' : 'hold_center';
  plan.guardHarvesters = state.recentEvents(team, 5).some(e => e.type === 'harvester_attacked');
  plan.summaryRu = describePlan(plan);

  const actions: ProductionAction[] = [];
  const econ = t.economy;
  const harvesters = state.harvesterCount(team) + state.harvestersInProduction(team);
  if (harvesters < 5 && mine >= 3 && econ.metal >= GAME_BALANCE.HARVESTER_COST_METAL) actions.push({ type: 'build_harvester', count: 1 });
  if (econ.powerEfficiency < 0.95 && econ.metal >= GAME_BALANCE.POWER_PLANT_COST_METAL) actions.push({ type: 'build_power_plant' });
  if (econ.metal > 750 && state.buildingCount(team, 'factory') < GAME_BALANCE.MAX_FACTORIES) actions.push({ type: 'build_factory' });

  return { taunt: profile.taunts[Math.floor(Math.random() * profile.taunts.length)], design, plan, actions };
}

export function localEnemyDecision(state: GameState): EnemyDraft {
  return localCommanderDecision(state, 'enemy');
}
