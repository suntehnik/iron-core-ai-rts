import { CHASSIS_CATALOG, MODULES_CATALOG } from '../config/catalog';
import { GAME_BALANCE } from '../config/balance';
import { COMMANDERS } from '../config/commanders';
import { DOCTRINE_TEXT } from '../config/levels';
import { GameState, opposite } from '../engine/GameState';
import { RobotBuilder } from '../engine/RobotBuilder';
import { TacticalPlan, Team } from '../types/game';
import { ProductionProposal } from '../types/agent';
import { RobotDesign } from '../types/robot';

const CATEGORY_RU: Record<string, string> = { armor: 'броня', weapon: 'оружие', engine: 'привод', utility: 'система' };

let catalogCache: string | null = null;

/** Compact catalog: every number the model needs to respect physical limits. */
export function compactCatalog(): string {
  if (catalogCache) return catalogCache;
  const chassis = Object.values(CHASSIS_CATALOG)
    .map(
      c =>
        `${c.id}: ${c.maxSlots} слота, масса базы ${c.baseMass}/макс ${c.maxMass} кг, источник ${c.basePowerOutput} кВт, ${c.baseSpeed} м/с, держит отдачу ≤${c.recoilResistance}, ${c.metalCost}м/${c.componentCost}к`,
    )
    .join('\n');
  const modules = Object.values(MODULES_CATALOG)
    .map(m => {
      const parts: string[] = [`${m.mass}кг`];
      if (m.powerDraw > 0) parts.push(`−${m.powerDraw}кВт`);
      if (m.powerOutput) parts.push(`+${m.powerOutput}кВт`);
      if (m.heatGen) parts.push(`тепло ${m.heatGen}`);
      if (m.heatDissipation > 0) parts.push(`охлаждение ${m.heatDissipation}`);
      parts.push(`${m.metalCost}м/${m.componentCost}к`);
      const fx: string[] = [];
      if (m.hpBonus) fx.push(`+${m.hpBonus}HP`);
      if (m.armorRating) fx.push(`броня ${Math.round(m.armorRating * 100)}%`);
      if (m.weaponDamage && m.weaponFireRate) {
        fx.push(`${Math.round(m.weaponDamage * m.weaponFireRate)} DPS, ${m.weaponRange}м, ${m.weaponType}, отдача ${m.weaponRecoil}`);
      }
      if (m.requiresDeploy) fx.push('стреляет после развёртывания');
      if (m.splashRadius) fx.push(`сплэш ${m.splashRadius}м`);
      if (m.armorPierce) fx.push(`игнор брони ${Math.round(m.armorPierce * 100)}%`);
      if (m.speedMultiplier) fx.push(`скорость ×${m.speedMultiplier}`);
      if (m.rangeMultiplier) fx.push(`дальность ×${m.rangeMultiplier}`);
      return `${m.id} [${CATEGORY_RU[m.category]}]: ${parts.join(', ')} — ${fx.join(', ')}`;
    })
    .join('\n');
  catalogCache = `ШАССИ:\n${chassis}\nМОДУЛИ:\n${modules}\nБазовое охлаждение корпуса 10/с.`;
  return catalogCache;
}

export function describeDesign(d: RobotDesign): string {
  const s = RobotBuilder.calculateStats(d);
  return `«${d.name}» — ${d.chassisId} [${d.modules.join(', ')}], роль ${d.tacticalRole}; HP ${s.hp}, броня ${Math.round(
    s.armorRating * 100,
  )}%, ${s.dps} DPS, дальность ${s.effectiveRange} м, скорость ${s.effectiveSpeed} м/с, энергия ${s.powerDraw}/${s.powerOutput} кВт, стоимость ${
    s.metalCost
  }м/${s.componentCost}к, сборка ${s.buildTimeSec} с`;
}

function economyLine(state: GameState, team: Team): string {
  const e = state.teams[team].economy;
  const harv = state.harvesterCount(team);
  const harvQueued = state.harvestersInProduction(team);
  const factories = state.buildings.filter(b => b.team === team && b.type === 'factory');
  const paused = factories.filter(b => b.paused).length;
  return `металл ${Math.round(e.metal)}, компоненты ${Math.round(e.components)}, энергия базы ${Math.round(e.powerDemand)}/${
    e.powerCapacity
  } кВт, добыча ${e.miningRatePerMin}/мин, добытчиков ${harv}/${GAME_BALANCE.MAX_HARVESTERS}${
    harvQueued ? ` (+${harvQueued} в производстве)` : ''
  }${builders(state, team) ? ` (на стройке ${builders(state, team)})` : ''}, заводов ${factories.length}${paused ? ` (на паузе: ${paused})` : ''}, электростанций ${state.buildingCount(team, 'power_plant')}${sitesLine(state, team)}, размер партии ${e.batchSize}, резерв компонентов ${e.componentReserve}`;
}

/** Harvesters away from mining on construction sites. */
function builders(state: GameState, team: Team): number {
  return state.constructionSites(team).reduce((n, b) => n + state.siteWorkers(b).length, 0);
}

/** Construction sites: progress and whether a worker is at it. */
function sitesLine(state: GameState, team: Team): string {
  const sites = state.constructionSites(team);
  if (!sites.length) return '';
  return `, стройки: ${sites
    .map(b => {
      const w = state.siteWorkers(b);
      const at = w.filter(h => h.state === 'constructing').length;
      const status = at ? `строят ${at}` : w.length ? 'рабочий в пути' : 'ждёт рабочего';
      return `${b.type === 'factory' ? 'завод' : 'электростанция'} ${Math.round(b.built * 100)}% (${status})`;
    })
    .join('; ')}`;
}

function intelLine(state: GameState, team: Team): string {
  const seen = state.observedEnemyDesigns(team);
  if (!seen.length) return 'вражеские модели пока не замечены';
  return seen
    .slice(0, 4)
    .map(s => `${s.design.name} ×${s.count}, ${s.inSight ? 'в поле зрения' : `видели ${s.lastSeenSec} с назад`} (${s.design.chassisId}: ${s.design.modules.join(', ')})`)
    .join('; ');
}

/** Campaign level rules for an AI commander: the doctrine and the chassis it may use. */
function levelLines(state: GameState, team: Team): string[] {
  const out: string[] = [];
  const doctrine = state.doctrine[team];
  if (doctrine) out.push(`ДОКТРИНА ШТАБА: ${DOCTRINE_TEXT[doctrine].ru}`);
  const chassis = state.allowedChassisOf(team);
  if (chassis) out.push(`ДОСТУПНЫЕ ШАССИ: только ${chassis.join(', ')}`);
  return out;
}

/** The enemy army as far as our machines and buildings see it (fog of war, forest blocks sight). */
function enemyArmyLine(state: GameState, team: Team): string {
  const i = state.enemyIntel(team);
  if (i.visible) return `в поле зрения ${i.visible} боевых машин, остальное скрыто туманом войны`;
  if (i.lastContactAgo === null) return 'контакта ещё не было, противник скрыт туманом войны';
  return `сейчас не видно; последний контакт ${i.lastContactAgo} с назад (${i.lastCount} машин)`;
}

function armyLine(state: GameState, team: Team): string {
  const a = state.armySummary(team);
  const roles = Object.entries(a.byRole)
    .map(([r, n]) => `${r} ${n}`)
    .join(', ');
  return `${a.combatUnits} боевых (${roles || 'нет'}), средняя прочность ${a.avgHpPct}%, фронт x=${a.frontX ?? '—'}`;
}

function eventsLine(state: GameState, team: Team): string {
  const ev = state.recentEvents(team, 5);
  return ev.length ? ev.map(e => `[${Math.round(e.time)}с] ${e.text}`).join('; ') : 'нет';
}

export function planLine(p: TacticalPlan): string {
  return `stance=${p.stance}, engagementRange=${p.engagementRange}, targetPriority=${p.targetPriority}, retreatHpThreshold=${p.retreatHpThreshold}, guardHarvesters=${p.guardHarvesters}`;
}

// ───────────────────────────── Production agent (engineer) ─────────────────────────────

export const ENGINEER_SYSTEM = `Ты — «Болт», главный инженер-конструктор боевых роботов в RTS. Ворчливый, но толковый; лёгкий юмор допустим, но ответ должен быть ясным.
Задача: перевести приказ командира в допустимую конфигурацию робота из каталога и/или в производственные действия.
Правила:
- Используй только id из каталога. Не назначай бонусы — характеристики рассчитает игра.
- Число модулей ≤ слотов шасси. Масса базы шасси + модули ≤ максимальной. Потребление энергии модулей ≤ источник шасси + генераторы. Суммарная отдача оружия выше предела шасси снижает точность. Нужно хотя бы одно оружие.
- Оружие греет корпус; без охлаждения долгая стрельба ведёт к перегреву. Осадная пушка и рельсотрон стреляют только после остановки.
- Нельзя одновременно максимизировать броню, огневую мощь, дальность и скорость. Если требования противоречат — выбери конкретный компромисс и назови его в поле "compromise".
- Если командир ограничил стоимость — соблюдай лимит относительно текущей стоимости.
- Изменения идут в следующие партии, выпущенные машины не меняются.
- Если приказ про производство (добытчики, электростанция, завод, размер партии, резерв компонентов, остановка/запуск конвейеров), а не про конструкцию — верни "design": null и действия.
- Здание (завод, электростанцию) строит добытчик: он идёт на площадку и на это время не добывает. Одновременно идут не больше ${GAME_BALANCE.MAX_ACTIVE_SITES} строек, остальные ждут. "workers":2 посылает двух добытчиков и ускоряет стройку в 1,6 раза.
- Добытчиков собирает завод (${GAME_BALANCE.HARVESTER_BUILD_SEC} с каждый) вместо боевых машин. "set_production" с paused=true останавливает все заводы (копить металл, освободить энергию), paused=false — запускает.
- Если командир ограничил рост стоимости, верни лимит в процентах в "costLimitPct" (четверть = 25, треть = 33, половина = 50), иначе null. Стоимость = металл шасси + металл всех модулей.
- В "reply" и "compromise" не используй id деталей — называй их по-русски (осадная пушка, усиленная броня). Имя модели — по-русски.
Ответ — только JSON:
{"reply":"1–2 коротких предложения командиру","design":{"name":"короткое имя модели","chassis":"id шасси","modules":["id",...],"role":"frontline|skirmisher|artillery|anti_armor|balanced"} или null,"actions":[{"type":"build_harvester","count":1} | {"type":"build_power_plant","workers":1} | {"type":"build_factory","workers":1} | {"type":"set_batch_size","size":3} | {"type":"set_component_reserve","amount":200} | {"type":"set_production","paused":true}],"costLimitPct":null,"compromise":"чем пожертвовали или пустая строка"}`;

export function engineerUserPrompt(state: GameState, order: string, pending: ProductionProposal | null): string {
  const t = state.teams.player;
  const lines = [
    `ПРИКАЗ КОМАНДИРА: "${order}"`,
    `ТЕКУЩАЯ СЕРИЙНАЯ МОДЕЛЬ: ${describeDesign(t.design)}`,
  ];
  if (pending?.design) lines.push(`НЕПОДТВЕРЖДЁННОЕ ПРЕДЛОЖЕНИЕ (командир уточняет его): ${describeDesign(pending.design)}`);
  lines.push(`ЭКОНОМИКА: ${economyLine(state, 'player')}`);
  lines.push(`НАША АРМИЯ: ${armyLine(state, 'player')}`);
  lines.push(`РАЗВЕДКА: ${intelLine(state, 'player')}`);
  lines.push(`СОБЫТИЯ: ${eventsLine(state, 'player')}`);
  lines.push(`КАТАЛОГ:\n${compactCatalog()}`);
  return lines.join('\n');
}

export function engineerRepairPrompt(errors: string[]): string {
  return `Твоя конфигурация нарушает ограничения: ${errors.join('; ')}. Исправь её, сохранив замысел командира (если всё сразу невозможно — выбери компромисс и назови его), и верни тот же JSON.`;
}

/**
 * Cost cap stated in the order, in any game language: «не дороже чем на четверть», «не больше 30%»,
 * "no more than a quarter dearer", "non più caro di un terzo".
 */
export function parseCostLimitPct(order: string): number | null {
  const p = order.toLowerCase();
  if (!/(стоимост|дорож|цен|бюджет|металл|cost|price|budget|expensive|dearer|pricier|metal|prezz|costo|caro|metallo)/.test(p)) return null;
  const pct = p.match(/(\d{1,3})\s*(%|процент|percent|per cento|percento)/);
  if (pct) return Number(pct[1]);
  if (/четверт|quarter|quarto/.test(p)) return 25;
  if (/трет|third|terzo/.test(p)) return 33;
  if (/половин|полтора|half|metà|meta\b/.test(p)) return 50;
  if (/вдвое|в два раза|в 2 раза|double|twice|doppio/.test(p)) return 100;
  if (/не дороже(?! чем на)|той же цен|не повыша|не увеличива[а-я]* стоимост[а-я]*$/.test(p)) return 0;
  if (/no (more )?(expensive|dearer)(?! than)|same (cost|price)|(don't|do not) raise the (cost|price)/.test(p)) return 0;
  if (/non più car[oa](?! di)|stesso (costo|prezzo)|senza aumentare/.test(p)) return 0;
  return null;
}

// ───────────────────────────── Combat-control agent (tactician) ─────────────────────────────

export const TACTICIAN_SYSTEM = `Ты — «Кобра», офицер управления боевыми машинами в RTS. Ты не ведёшь каждого робота — ты задаёшь план, игровой AI его исполняет.
Параметры плана:
- stance: advance (наступать на базу врага) | hold_center (держать линию у центра карты) | defend_base (оборона базы) | raid_economy (быстрые машины бьют добытчиков врага, остальные наступают)
- engagementRange: max_range (бить с предельной дистанции, отходить от ближнего боя) | balanced | close_brawl (сближаться вплотную)
- targetPriority: closest | high_threat_heavies | scouts_harvesters | focus_fire | buildings
- retreatHpThreshold: 0–60 — при каком % прочности машина уходит на ремонт к штабу (0 — не отступать)
- guardHarvesters: true/false — прикрывать своих добытчиков
Инструкции командира главнее всего. Учитывай состав армий, конструкции и события. Если меняешь план сам — коротко объясни почему.
О противнике известно только то, что видят наши машины и здания: лес закрывает обзор.
Ответ — только JSON: {"reply":"1–2 предложения командиру","plan":{"stance":"...","engagementRange":"...","targetPriority":"...","retreatHpThreshold":0,"guardHarvesters":false,"summary":"суть плана до 12 слов"}}`;

export function tacticianUserPrompt(
  state: GameState,
  order: string | null,
  standingOrders: string[],
  trigger: string | null,
): string {
  const t = state.teams.player;
  const lines: string[] = [];
  if (order) lines.push(`НОВЫЙ ПРИКАЗ КОМАНДИРА: "${order}"`);
  else lines.push(`ПОВОД ДЛЯ ПЕРЕСМОТРА ПЛАНА: ${trigger ?? 'плановая проверка'}`);
  lines.push(`ДЕЙСТВУЮЩИЕ ИНСТРУКЦИИ КОМАНДИРА: ${standingOrders.length ? standingOrders.map(s => `"${s}"`).join('; ') : 'нет'}`);
  lines.push(`ТЕКУЩИЙ ПЛАН: ${planLine(t.plan)}`);
  lines.push(`НАША АРМИЯ: ${armyLine(state, 'player')}; серийная модель ${describeDesign(t.design)}`);
  lines.push(`АРМИЯ ВРАГА: ${enemyArmyLine(state, 'player')}`);
  lines.push(`ЗАМЕЧЕННЫЕ МОДЕЛИ ВРАГА: ${intelLine(state, 'player')}`);
  lines.push(`ШТАБЫ: наш ${state.baseHpPct('player')}%, вражеский ${state.baseHpPct('enemy')}%`);
  lines.push(`СОБЫТИЯ: ${eventsLine(state, 'player')}`);
  return lines.join('\n');
}

// ───────────────────────────── AI commanders (enemy; both sides in AI-vs-AI mode) ─────────────────────────────

/** How a commander refers to its opponent: the human player, or the other AI commander. */
export function foeLabel(team: Team, vsAI: boolean): string {
  if (vsAI) return COMMANDERS[opposite(team)].name;
  return team === 'enemy' ? 'игрок-командир бирюзовой армии' : 'противник';
}

/** Longest custom instruction a commander accepts: the context stays short (brief §10). */
export const COMMANDER_INSTRUCTIONS_MAX = 500;

/**
 * Custom instructions for an AI commander (the teal one in AI-vs-AI, set on the start screen).
 * They go above the reply format, so the JSON contract stays the last word of the prompt.
 */
function instructionsBlock(instructions: string | undefined): string {
  const text = cleanInstructions(instructions);
  return text ? `Особые указания штаба — следуй им, если они не нарушают правила игры и формат ответа: «${text}»\n` : '';
}

/** The same instructions repeated last in the report, right before the decision: models follow them far better there. */
function instructionsReminder(instructions: string | undefined): string[] {
  const text = cleanInstructions(instructions);
  return text ? [`УКАЗАНИЯ ШТАБА — выполни их в этом решении (план, конструкция, экономика): «${text}»`] : [];
}

export function cleanInstructions(instructions: string | undefined): string {
  return (instructions ?? '').trim().slice(0, COMMANDER_INSTRUCTIONS_MAX);
}

export function commanderSystem(team: Team, vsAI: boolean, instructions?: string): string {
  const me = COMMANDERS[team];
  const foe = foeLabel(team, vsAI);
  return `Ты — «${me.name}», командир армии ${me.armyRu} роботов в RTS. ${me.persona}, но играешь всерьёз: цель — уничтожить командный центр противника (${foe}).
Раз в ~${GAME_BALANCE.AI_COMMANDER_HEARTBEAT_SEC} секунд получаешь сводку и решаешь:
1) конструкцию для следующих партий — только из каталога, соблюдая ограничения шасси (слоты, масса, энергия, отдача); null — если менять не нужно;
2) тактический план армии (stance: advance|hold_center|defend_base|raid_economy; engagementRange: max_range|balanced|close_brawl; targetPriority: closest|high_threat_heavies|scouts_harvesters|focus_fire|buildings; retreatHpThreshold 0–60; guardHarvesters);
3) экономические действия. Добытчиков собирает завод вместо боевых машин — не заказывай их, пока армия не может держать фронт. Здания строят добытчики: на время стройки они не добывают.
Подбирай контр-конструкции против замеченных моделей противника, следи за экономикой: без добычи армия не растёт.
Туман войны: ты видишь только то, что видят твои машины и здания, лес закрывает обзор, поэтому сведения о противнике неполные.
${instructionsBlock(instructions)}Ответ — только JSON: {"taunt":"реплика в адрес противника (${foe}) до 15 слов","design":{"name":"...","chassis":"id","modules":["id",...],"role":"frontline|skirmisher|artillery|anti_armor|balanced"} или null,"plan":{"stance":"...","engagementRange":"...","targetPriority":"...","retreatHpThreshold":0,"guardHarvesters":false,"summary":"..."},"actions":[{"type":"build_harvester","count":1} | {"type":"build_power_plant","workers":1} | {"type":"build_factory","workers":1} | {"type":"set_batch_size","size":3}]}`;
}

export function commanderUserPrompt(state: GameState, team: Team, instructions?: string): string {
  const t = state.teams[team];
  const foe = opposite(team);
  return [
    `ВРЕМЯ МАТЧА: ${Math.round(state.gameTime)} с`,
    `ТВОЯ СЕРИЙНАЯ МОДЕЛЬ: ${describeDesign(t.design)}`,
    `ТВОЙ ПЛАН: ${planLine(t.plan)}`,
    `ТВОЯ ЭКОНОМИКА: ${economyLine(state, team)}`,
    `ТВОЯ АРМИЯ: ${armyLine(state, team)}; потери ${t.economy.totals.unitsLost}, уничтожено врагов ${t.economy.totals.kills}`,
    `ЗАМЕЧЕННЫЕ МОДЕЛИ ПРОТИВНИКА: ${intelLine(state, team)}`,
    `АРМИЯ ПРОТИВНИКА: ${enemyArmyLine(state, team)}`,
    `ШТАБЫ: твой ${state.baseHpPct(team)}%, противника ${state.baseHpPct(foe)}%`,
    `СОБЫТИЯ: ${eventsLine(state, team)}`,
    ...levelLines(state, team),
    `КАТАЛОГ:\n${compactCatalog()}`,
    ...instructionsReminder(instructions),
  ].join('\n');
}

/**
 * Quick re-plan on battle events (an attack, heavy losses): plan only and a short context, so a
 * slow model still answers within seconds. Design and economy wait for the next full report.
 */
export function commanderReplanSystem(team: Team, vsAI: boolean, instructions?: string): string {
  const me = COMMANDERS[team];
  const foe = foeLabel(team, vsAI);
  return `Ты — «${me.name}», командир армии ${me.armyRu} роботов в RTS. В бою важное событие: быстро скорректируй план армии. Конструкцию и экономику решишь в следующей плановой сводке.
Параметры плана: stance: advance|hold_center|defend_base|raid_economy; engagementRange: max_range|balanced|close_brawl; targetPriority: closest|high_threat_heavies|scouts_harvesters|focus_fire|buildings; retreatHpThreshold 0–60; guardHarvesters true/false.
${instructionsBlock(instructions)}Ответ — только JSON: {"taunt":"реплика в адрес противника (${foe}) до 8 слов или пустая строка","plan":{"stance":"...","engagementRange":"...","targetPriority":"...","retreatHpThreshold":0,"guardHarvesters":false,"summary":"суть плана до 8 слов"}}`;
}

export function commanderReplanPrompt(state: GameState, team: Team, trigger: string, instructions?: string): string {
  const t = state.teams[team];
  const foe = opposite(team);
  return [
    `СОБЫТИЯ: ${trigger}`,
    `ТВОЙ ПЛАН: ${planLine(t.plan)}`,
    `ТВОЯ АРМИЯ: ${armyLine(state, team)}`,
    `ЗАМЕЧЕННЫЕ МОДЕЛИ ПРОТИВНИКА: ${intelLine(state, team)}`,
    `АРМИЯ ПРОТИВНИКА: ${enemyArmyLine(state, team)}`,
    `ШТАБЫ: твой ${state.baseHpPct(team)}%, противника ${state.baseHpPct(foe)}%`,
    ...instructionsReminder(instructions),
  ].join('\n');
}

/** Backwards-compatible names for the enemy commander vs a human player. */
export const ENEMY_SYSTEM = commanderSystem('enemy', false);
export function enemyUserPrompt(state: GameState): string {
  return commanderUserPrompt(state, 'enemy');
}

/** One language of agent prompts; the director picks it by the provider (see LLMProviderPreset.promptLanguage). */
export interface PromptSet {
  engineerSystem: string;
  engineerUser(state: GameState, order: string, pending: ProductionProposal | null): string;
  engineerRepair(errors: string[]): string;
  tacticianSystem: string;
  tacticianUser(state: GameState, order: string | null, standingOrders: string[], trigger: string | null): string;
  commanderSystem(team: Team, vsAI: boolean, instructions?: string): string;
  commanderUser(state: GameState, team: Team, instructions?: string): string;
  replanSystem(team: Team, vsAI: boolean, instructions?: string): string;
  replanUser(state: GameState, team: Team, trigger: string, instructions?: string): string;
}

export const PROMPTS_RU: PromptSet = {
  engineerSystem: ENGINEER_SYSTEM,
  engineerUser: engineerUserPrompt,
  engineerRepair: engineerRepairPrompt,
  tacticianSystem: TACTICIAN_SYSTEM,
  tacticianUser: tacticianUserPrompt,
  commanderSystem,
  commanderUser: commanderUserPrompt,
  replanSystem: commanderReplanSystem,
  replanUser: commanderReplanPrompt,
};
