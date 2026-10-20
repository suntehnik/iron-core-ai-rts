import { CHASSIS_CATALOG, MODULES_CATALOG } from '../config/catalog';
import { GAME_BALANCE } from '../config/balance';
import { COMMANDERS, commanderName } from '../config/commanders';
import { DOCTRINE_TEXT } from '../config/levels';
import { GameState, opposite } from '../engine/GameState';
import { RobotBuilder } from '../engine/RobotBuilder';
import { ProductionProposal } from '../types/agent';
import { Team } from '../types/game';
import { RobotDesign } from '../types/robot';
import { markRussian } from './llm/nativeBridge';
import { PromptSet, cleanInstructions, planLine } from './prompts';

/**
 * English agent prompts: for the English and Italian game, and for the on-device model of the iOS app
 * in the Russian game (Apple Foundation Models has no Russian). Roles, rules and reply formats mirror
 * prompts.ts; the fields a player reads are written in the reply language.
 * With `markForTranslation`, Russian text that comes from the game or the player (orders, events,
 * model names, validation errors, HQ instructions) is marked with markRussian() and translated on
 * the device before generation, and the readable reply fields are translated back
 * (LLMClient.chatOnDevice).
 */

export interface EnglishPromptOptions {
  /** language of the fields a player reads: reply, compromise, taunt, plan summary, design name */
  replyLanguage: 'English' | 'Italian';
  /** wrap Russian fragments for on-device translation (Russian game on the on-device model) */
  markForTranslation: boolean;
}

let catalogCache: string | null = null;

/** Compact catalog: every number the model needs to respect physical limits. */
function compactCatalog(): string {
  if (catalogCache) return catalogCache;
  const chassis = Object.values(CHASSIS_CATALOG)
    .map(
      c =>
        `${c.id}: ${c.maxSlots} slots, base mass ${c.baseMass}/max ${c.maxMass} kg, source ${c.basePowerOutput} kW, ${c.baseSpeed} m/s, holds recoil ≤${c.recoilResistance}, ${c.metalCost}m/${c.componentCost}c`,
    )
    .join('\n');
  const modules = Object.values(MODULES_CATALOG)
    .map(m => {
      const parts: string[] = [`${m.mass}kg`];
      if (m.powerDraw > 0) parts.push(`−${m.powerDraw}kW`);
      if (m.powerOutput) parts.push(`+${m.powerOutput}kW`);
      if (m.heatGen) parts.push(`heat ${m.heatGen}`);
      if (m.heatDissipation > 0) parts.push(`cooling ${m.heatDissipation}`);
      parts.push(`${m.metalCost}m/${m.componentCost}c`);
      const fx: string[] = [];
      if (m.hpBonus) fx.push(`+${m.hpBonus}HP`);
      if (m.armorRating) fx.push(`armour ${Math.round(m.armorRating * 100)}%`);
      if (m.weaponDamage && m.weaponFireRate) {
        fx.push(`${Math.round(m.weaponDamage * m.weaponFireRate)} DPS, ${m.weaponRange}m, ${m.weaponType}, recoil ${m.weaponRecoil}`);
      }
      if (m.requiresDeploy) fx.push('fires only after deploying');
      if (m.splashRadius) fx.push(`splash ${m.splashRadius}m`);
      if (m.armorPierce) fx.push(`ignores ${Math.round(m.armorPierce * 100)}% armour`);
      if (m.speedMultiplier) fx.push(`speed ×${m.speedMultiplier}`);
      if (m.rangeMultiplier) fx.push(`range ×${m.rangeMultiplier}`);
      return `${m.id} [${m.category}]: ${parts.join(', ')} — ${fx.join(', ')}`;
    })
    .join('\n');
  catalogCache = `CHASSIS:\n${chassis}\nMODULES:\n${modules}\nBase hull cooling 10/s. m/c = metal/components.`;
  return catalogCache;
}

export function createEnglishPrompts({ replyLanguage, markForTranslation }: EnglishPromptOptions): PromptSet {
  const mark = markForTranslation ? markRussian : (text: string) => text;
  const readable = `Write every human-readable field (reply, compromise, taunt, summary, the design name) in ${replyLanguage}.`;
  // Names as the player sees them; the Russian game on the device keeps them English (no Cyrillic outside the marks)
  const commanderLabel = (team: Team) => (markForTranslation ? COMMANDERS[team].nameEn : commanderName(team));

  function describeDesign(d: RobotDesign): string {
    const s = RobotBuilder.calculateStats(d);
    return `${mark(d.name)} — ${d.chassisId} [${d.modules.join(', ')}], role ${d.tacticalRole}; HP ${s.hp}, armour ${Math.round(
    s.armorRating * 100,
  )}%, ${s.dps} DPS, range ${s.effectiveRange} m, speed ${s.effectiveSpeed} m/s, power ${s.powerDraw}/${s.powerOutput} kW, cost ${
    s.metalCost
  } metal/${s.componentCost} components, build ${s.buildTimeSec} s`;
  }

  function economyLine(state: GameState, team: Team): string {
    const e = state.teams[team].economy;
    const harvQueued = state.harvestersInProduction(team);
    const factories = state.buildings.filter(b => b.team === team && b.type === 'factory');
    const paused = factories.filter(b => b.paused).length;
    return `metal ${Math.round(e.metal)}, components ${Math.round(e.components)}, base power ${Math.round(e.powerDemand)}/${
    e.powerCapacity
  } kW, mining ${e.miningRatePerMin}/min, harvesters ${state.harvesterCount(team)}/${GAME_BALANCE.MAX_HARVESTERS}${
    harvQueued ? ` (+${harvQueued} in production)` : ''
  }${builders(state, team) ? ` (${builders(state, team)} building)` : ''}, factories ${factories.length}${paused ? ` (paused: ${paused})` : ''}, power plants ${state.buildingCount(team, 'power_plant')}${sitesLine(state, team)}, batch size ${e.batchSize}, component reserve ${e.componentReserve}`;
  }

  /** Harvesters away from mining on construction sites. */
  function builders(state: GameState, team: Team): number {
    return state.constructionSites(team).reduce((n, b) => n + state.siteWorkers(b).length, 0);
  }

  /** Construction sites: progress and whether a worker is at it. */
  function sitesLine(state: GameState, team: Team): string {
    const sites = state.constructionSites(team);
    if (!sites.length) return '';
    return `, sites: ${sites
      .map(b => {
        const w = state.siteWorkers(b);
        const at = w.filter(h => h.state === 'constructing').length;
        const status = at ? `${at} building` : w.length ? 'worker on the way' : 'needs a worker';
        return `${b.type === 'factory' ? 'factory' : 'power plant'} ${Math.round(b.built * 100)}% (${status})`;
      })
      .join('; ')}`;
  }

  function intelLine(state: GameState, team: Team): string {
    const seen = state.observedEnemyDesigns(team);
    if (!seen.length) return 'no enemy models spotted yet';
    return seen
      .slice(0, 4)
      .map(s => `${mark(s.design.name)} ×${s.count}, ${s.inSight ? 'in sight' : `seen ${s.lastSeenSec} s ago`} (${s.design.chassisId}: ${s.design.modules.join(', ')})`)
      .join('; ');
  }

  /** Campaign level rules for an AI commander: the doctrine and the chassis it may use. */
  function levelLines(state: GameState, team: Team): string[] {
    const out: string[] = [];
    const doctrine = state.doctrine[team];
    if (doctrine) out.push(`HQ DOCTRINE: ${DOCTRINE_TEXT[doctrine].en}`);
    const chassis = state.allowedChassisOf(team);
    if (chassis) out.push(`ALLOWED CHASSIS: only ${chassis.join(', ')}`);
    return out;
  }

  /** The enemy army as far as our machines and buildings see it (fog of war, forest blocks sight). */
  function enemyArmyLine(state: GameState, team: Team): string {
    const i = state.enemyIntel(team);
    if (i.visible) return `${i.visible} combat robots in sight, the rest is hidden by the fog of war`;
    if (i.lastContactAgo === null) return 'no contact yet, the enemy is hidden by the fog of war';
    return `none in sight; last contact ${i.lastContactAgo} s ago (${i.lastCount} robots)`;
  }

  function armyLine(state: GameState, team: Team): string {
    const a = state.armySummary(team);
    const roles = Object.entries(a.byRole)
      .map(([r, n]) => `${r} ${n}`)
      .join(', ');
    return `${a.combatUnits} combat (${roles || 'none'}), average integrity ${a.avgHpPct}%, front x=${a.frontX ?? '—'}`;
  }

  function eventsLine(state: GameState, team: Team): string {
    const ev = state.recentEvents(team, 5);
    return ev.length ? ev.map(e => `[${Math.round(e.time)}s] ${mark(e.text)}`).join('; ') : 'none';
  }

  // ───────────────────────────── Production agent (engineer) ─────────────────────────────

  const ENGINEER_SYSTEM = `You are "Bolt", the chief designer of combat robots in an RTS. Grumpy but competent; light humour is fine, but the answer must be clear.
Task: turn the commander's order into a valid robot configuration from the catalog and/or into production actions.
Rules:
- Use only ids from the catalog. Do not assign bonuses: the game computes the stats.
- Modules ≤ chassis slots. Chassis base mass + modules ≤ max mass. Module power draw ≤ chassis source + generators. Total weapon recoil above the chassis limit lowers accuracy. At least one weapon is required.
- Weapons heat the hull; without cooling, long bursts overheat it. The siege cannon and the railgun fire only after stopping.
- Armour, firepower, range and speed cannot all be maximised at once. If the demands conflict, choose a concrete trade-off and name it in "compromise".
- If the commander capped the cost, keep within the cap relative to the current cost.
- Changes apply to the next batches; robots already built do not change.
- If the order is about production (harvesters, power plant, factory, batch size, component reserve, stopping/starting the lines) rather than the design, return "design": null and the actions.
- A harvester builds each building (factory, power plant): it goes to the site and does not mine meanwhile. At most ${GAME_BALANCE.MAX_ACTIVE_SITES} sites are worked at once, the rest wait. "workers":2 sends two harvesters and builds 1.6× as fast.
- The factory builds harvesters (${GAME_BALANCE.HARVESTER_BUILD_SEC} s each) instead of combat robots. "set_production" with paused=true stops all factories (to save metal and free power), paused=false starts them.
- If the commander capped the cost growth, return the cap in percent in "costLimitPct" (a quarter = 25, a third = 33, half = 50), otherwise null. Cost = chassis metal + metal of all modules.
- In "reply" and "compromise" do not use part ids: name the parts in plain words (siege cannon, reinforced armour). Give the model a short name.
- ${readable}
Answer with JSON only:
{"reply":"1–2 short sentences to the commander","design":{"name":"short model name","chassis":"chassis id","modules":["id",...],"role":"frontline|skirmisher|artillery|anti_armor|balanced"} or null,"actions":[{"type":"build_harvester","count":1} | {"type":"build_power_plant","workers":1} | {"type":"build_factory","workers":1} | {"type":"set_batch_size","size":3} | {"type":"set_component_reserve","amount":200} | {"type":"set_production","paused":true}],"costLimitPct":null,"compromise":"what was sacrificed, or an empty string"}`;

  function engineerUserPrompt(state: GameState, order: string, pending: ProductionProposal | null): string {
    const t = state.teams.player;
    const lines = [`COMMANDER'S ORDER: "${mark(order)}"`, `CURRENT SERIAL MODEL: ${describeDesign(t.design)}`];
    if (pending?.design) lines.push(`UNCONFIRMED PROPOSAL (the commander is refining it): ${describeDesign(pending.design)}`);
    lines.push(`ECONOMY: ${economyLine(state, 'player')}`);
    lines.push(`OUR ARMY: ${armyLine(state, 'player')}`);
    lines.push(`SCOUTING: ${intelLine(state, 'player')}`);
    lines.push(`EVENTS: ${eventsLine(state, 'player')}`);
    lines.push(`CATALOG:\n${compactCatalog()}`);
    return lines.join('\n');
  }

  function engineerRepairPrompt(errors: string[]): string {
    return `Your configuration breaks the constraints: ${mark(errors.join('; '))}. Fix it while keeping the commander's intent (if everything at once is impossible, choose a trade-off and name it) and return the same JSON.`;
  }

  // ───────────────────────────── Combat-control agent (tactician) ─────────────────────────────

  const TACTICIAN_SYSTEM = `You are "Cobra", the combat-control officer in an RTS. You do not steer each robot: you set the plan and the game AI executes it.
Plan parameters:
- stance: advance (push to the enemy base) | hold_center (hold a line at the map centre) | defend_base (defend the base) | raid_economy (fast robots hit enemy harvesters, the rest advance)
- engagementRange: max_range (fire from maximum range, back off from close combat) | balanced | close_brawl (close in)
- targetPriority: closest | high_threat_heavies | scouts_harvesters | focus_fire | buildings
- retreatHpThreshold: 0–60 — at what % integrity a robot goes back to the HQ for repairs (0 = never retreat)
- guardHarvesters: true/false — cover our harvesters
The commander's instructions come first. Take the armies, the designs and the events into account. If you change the plan on your own, briefly explain why.
We know only what our machines and buildings see: forest blocks sight.
${readable}
Answer with JSON only: {"reply":"1–2 sentences to the commander","plan":{"stance":"...","engagementRange":"...","targetPriority":"...","retreatHpThreshold":0,"guardHarvesters":false,"summary":"the plan in up to 12 words"}}`;

  function tacticianUserPrompt(state: GameState, order: string | null, standingOrders: string[], trigger: string | null): string {
    const t = state.teams.player;
    const lines: string[] = [];
    if (order) lines.push(`NEW COMMANDER'S ORDER: "${mark(order)}"`);
    else lines.push(`REASON TO REVIEW THE PLAN: ${trigger ? mark(trigger) : 'scheduled check'}`);
    lines.push(`COMMANDER'S STANDING INSTRUCTIONS: ${standingOrders.length ? standingOrders.map(s => `"${mark(s)}"`).join('; ') : 'none'}`);
    lines.push(`CURRENT PLAN: ${planLine(t.plan)}`);
    lines.push(`OUR ARMY: ${armyLine(state, 'player')}; serial model ${describeDesign(t.design)}`);
    lines.push(`ENEMY ARMY: ${enemyArmyLine(state, 'player')}`);
    lines.push(`SPOTTED ENEMY MODELS: ${intelLine(state, 'player')}`);
    lines.push(`HQS: ours ${state.baseHpPct('player')}%, enemy ${state.baseHpPct('enemy')}%`);
    lines.push(`EVENTS: ${eventsLine(state, 'player')}`);
    return lines.join('\n');
  }

  // ───────────────────────────── AI commanders ─────────────────────────────

  function foeLabel(team: Team, vsAI: boolean): string {
    if (vsAI) return commanderLabel(opposite(team));
    return team === 'enemy' ? 'the human commander of the teal army' : 'the enemy';
  }

  function instructionsBlock(instructions: string | undefined): string {
    const text = cleanInstructions(instructions);
    return text ? `Special orders from HQ — follow them unless they break the game rules or the reply format: "${mark(text)}"\n` : '';
  }

  function instructionsReminder(instructions: string | undefined): string[] {
    const text = cleanInstructions(instructions);
    return text ? [`HQ ORDERS — carry them out in this decision (plan, design, economy): "${mark(text)}"`] : [];
  }

  function commanderSystem(team: Team, vsAI: boolean, instructions?: string): string {
    const me = COMMANDERS[team];
    const foe = foeLabel(team, vsAI);
    return `You are "${commanderLabel(team)}", commander of the ${me.armyEn} robot army in an RTS. ${me.personaEn}, but you play seriously: the goal is to destroy the enemy command centre (${foe}).
Every ~${GAME_BALANCE.AI_COMMANDER_HEARTBEAT_SEC} seconds you get a report and decide:
1) the design for the next batches — only from the catalog, within the chassis limits (slots, mass, power, recoil); null if no change is needed;
2) the army plan (stance: advance|hold_center|defend_base|raid_economy; engagementRange: max_range|balanced|close_brawl; targetPriority: closest|high_threat_heavies|scouts_harvesters|focus_fire|buildings; retreatHpThreshold 0–60; guardHarvesters);
3) economic actions. The factory builds harvesters instead of combat robots — do not order them while the army cannot hold the front. Harvesters build the buildings and do not mine meanwhile.
Counter the enemy models you have spotted and watch the economy: without mining the army does not grow.
Fog of war: you see only what your machines and buildings see, and forest blocks sight, so the enemy data is partial.
${readable}
${instructionsBlock(instructions)}Answer with JSON only: {"taunt":"a jab at the enemy (${foe}), up to 15 words","design":{"name":"...","chassis":"id","modules":["id",...],"role":"frontline|skirmisher|artillery|anti_armor|balanced"} or null,"plan":{"stance":"...","engagementRange":"...","targetPriority":"...","retreatHpThreshold":0,"guardHarvesters":false,"summary":"..."},"actions":[{"type":"build_harvester","count":1} | {"type":"build_power_plant","workers":1} | {"type":"build_factory","workers":1} | {"type":"set_batch_size","size":3}]}`;
  }

  function commanderUserPrompt(state: GameState, team: Team, instructions?: string): string {
    const t = state.teams[team];
    const foe = opposite(team);
    return [
      `MATCH TIME: ${Math.round(state.gameTime)} s`,
      `YOUR SERIAL MODEL: ${describeDesign(t.design)}`,
      `YOUR PLAN: ${planLine(t.plan)}`,
      `YOUR ECONOMY: ${economyLine(state, team)}`,
      `YOUR ARMY: ${armyLine(state, team)}; losses ${t.economy.totals.unitsLost}, enemies destroyed ${t.economy.totals.kills}`,
      `SPOTTED ENEMY MODELS: ${intelLine(state, team)}`,
      `ENEMY ARMY: ${enemyArmyLine(state, team)}`,
      `HQS: yours ${state.baseHpPct(team)}%, enemy ${state.baseHpPct(foe)}%`,
      `EVENTS: ${eventsLine(state, team)}`,
      ...levelLines(state, team),
      `CATALOG:\n${compactCatalog()}`,
      ...instructionsReminder(instructions),
    ].join('\n');
  }

  function commanderReplanSystem(team: Team, vsAI: boolean, instructions?: string): string {
    const me = COMMANDERS[team];
    const foe = foeLabel(team, vsAI);
    return `You are "${commanderLabel(team)}", commander of the ${me.armyEn} robot army in an RTS. Something important happened in battle: quickly adjust the army plan. Design and economy wait for the next scheduled report.
Plan parameters: stance: advance|hold_center|defend_base|raid_economy; engagementRange: max_range|balanced|close_brawl; targetPriority: closest|high_threat_heavies|scouts_harvesters|focus_fire|buildings; retreatHpThreshold 0–60; guardHarvesters true/false.
${readable}
${instructionsBlock(instructions)}Answer with JSON only: {"taunt":"a jab at the enemy (${foe}), up to 8 words, or an empty string","plan":{"stance":"...","engagementRange":"...","targetPriority":"...","retreatHpThreshold":0,"guardHarvesters":false,"summary":"the plan in up to 8 words"}}`;
  }

  function commanderReplanPrompt(state: GameState, team: Team, trigger: string, instructions?: string): string {
    const t = state.teams[team];
    const foe = opposite(team);
    return [
      `EVENTS: ${mark(trigger)}`,
      `YOUR PLAN: ${planLine(t.plan)}`,
      `YOUR ARMY: ${armyLine(state, team)}`,
      `SPOTTED ENEMY MODELS: ${intelLine(state, team)}`,
      `ENEMY ARMY: ${enemyArmyLine(state, team)}`,
      `HQS: yours ${state.baseHpPct(team)}%, enemy ${state.baseHpPct(foe)}%`,
      ...instructionsReminder(instructions),
    ].join('\n');
  }

  return {
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
}

const cache = new Map<string, PromptSet>();

/** English prompt set for a reply language (built once per combination). */
export function englishPrompts(options: EnglishPromptOptions): PromptSet {
  const key = `${options.replyLanguage}|${options.markForTranslation}`;
  let set = cache.get(key);
  if (!set) cache.set(key, (set = createEnglishPrompts(options)));
  return set;
}

/** The on-device prompts of the Russian game: English, Russian fragments marked for translation. */
export const PROMPTS_EN: PromptSet = englishPrompts({ replyLanguage: 'English', markForTranslation: true });
