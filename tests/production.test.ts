import { describe, expect, it } from 'vitest';
import { AIDirector } from '../src/ai/AIDirector';
import { GAME_BALANCE, PAD_BUILDINGS } from '../src/config/balance';
import { localEngineer } from '../src/ai/fallbacks';
import { normalizeActions } from '../src/ai/parsing';
import { commanderUserPrompt } from '../src/ai/prompts';
import { englishPrompts } from '../src/ai/promptsEn';
import { GameState } from '../src/engine/GameState';
import { RobotBuilder } from '../src/engine/RobotBuilder';
import { RobotDesign } from '../src/types/robot';

const step = (s: GameState, sec: number) => {
  for (let t = 0; t < sec; t += 1 / 20) s.update(1 / 20);
};
const playerFactory = (s: GameState) => s.buildings.find(b => b.team === 'player' && b.type === 'factory')!;
const combat = (s: GameState) => s.units.filter(u => u.team === 'player' && u.kind === 'combat').length;

describe('harvesters are built at the factory', () => {
  it('an order is paid at once but the harvester appears only after factory time, at the factory', () => {
    const s = new GameState();
    const before = s.harvesterCount('player');
    const metal = s.teams.player.economy.metal;
    const r = s.orderHarvester('player');
    expect(r.ok).toBe(true);
    expect(s.teams.player.economy.metal).toBe(metal - GAME_BALANCE.HARVESTER_COST_METAL);
    expect(s.harvesterCount('player')).toBe(before); // not instant
    expect(s.harvestersInProduction('player')).toBe(1);

    step(s, 1);
    expect(s.harvesterCount('player')).toBe(before);
    step(s, GAME_BALANCE.HARVESTER_BUILD_SEC + 9); // may wait for the unit already on the line
    expect(s.harvesterCount('player')).toBe(before + 1);
    expect(s.harvestersInProduction('player')).toBe(0);
    const fresh = s.units.filter(u => u.team === 'player' && u.kind === 'harvester').pop()!;
    const f = playerFactory(s);
    expect(Math.hypot(fresh.pos.x - f.pos.x, fresh.pos.y - f.pos.y)).toBeLessThan(40);
  });

  it('harvester orders take factory time away from the combat batch', () => {
    const withOrders = new GameState();
    const without = new GameState();
    for (let i = 0; i < 3; i++) withOrders.orderHarvester('player');
    withOrders.teams.player.economy.metal = without.teams.player.economy.metal = 5000;
    withOrders.teams.player.economy.components = without.teams.player.economy.components = 5000;
    step(withOrders, 30);
    step(without, 30);
    expect(combat(withOrders)).toBeLessThan(combat(without));
  });

  it('respects the harvester limit including those still on the line', () => {
    const s = new GameState();
    s.teams.player.economy.metal = 10000;
    let ok = 0;
    for (let i = 0; i < 20; i++) if (s.orderHarvester('player').ok) ok++;
    expect(s.harvesterCount('player') + s.harvestersInProduction('player')).toBe(GAME_BALANCE.MAX_HARVESTERS);
    expect(ok).toBe(GAME_BALANCE.MAX_HARVESTERS - 2);
  });
});

describe('economy can always recover', () => {
  it('with no harvesters and no metal the HQ issues an emergency harvester for free', () => {
    const s = new GameState();
    s.units = s.units.filter(u => u.kind !== 'harvester');
    s.teams.player.economy.metal = 0;
    expect(s.orderHarvester('player').ok).toBe(true);
    expect(s.orderHarvester('player').ok).toBe(false); // only one free machine
    step(s, GAME_BALANCE.HARVESTER_BUILD_SEC + 10);
    expect(s.harvesterCount('player')).toBe(1);
  });

  it('with no factory the HQ emergency bay assembles harvesters, twice as slow', () => {
    const s = new GameState();
    s.buildings = s.buildings.filter(b => !(b.team === 'player' && b.type === 'factory'));
    const before = s.harvesterCount('player');
    expect(s.orderHarvester('player').text).toMatch(/цех штаба/);
    step(s, GAME_BALANCE.HARVESTER_BUILD_SEC + 1);
    expect(s.harvesterCount('player')).toBe(before);
    step(s, GAME_BALANCE.HARVESTER_BUILD_SEC * (GAME_BALANCE.HQ_EMERGENCY_HARVESTER_FACTOR - 1) + 1);
    expect(s.harvesterCount('player')).toBe(before + 1);
  });

  it('an HQ harvester already on the line still rolls out after a new factory is founded', () => {
    const s = new GameState();
    s.buildings = s.buildings.filter(b => !(b.team === 'player' && b.type === 'factory'));
    s.units = s.units.filter(u => u.team !== 'player');
    s.teams.player.economy.metal = 5000;
    s.teams.player.economy.components = 500;
    expect(s.orderHarvester('player').ok).toBe(true);
    step(s, GAME_BALANCE.HARVESTER_BUILD_SEC); // the HQ bay is part-way through
    expect(s.getHQ('player')!.harvesterBuild).not.toBeNull();
    expect(s.buildStructure('player', 'factory').ok).toBe(true);
    step(s, GAME_BALANCE.HARVESTER_BUILD_SEC * GAME_BALANCE.HQ_EMERGENCY_HARVESTER_FACTOR + 1);
    expect(s.harvesterCount('player')).toBe(1);
    expect(s.harvestersInProduction('player')).toBe(0);
  });
});

describe('production pause', () => {
  it('a paused factory spends nothing, builds nothing and draws no power; resume continues', () => {
    const s = new GameState();
    step(s, 0.5); // the first unit gets paid and starts
    s.setFactoryPaused('player', null, true);
    const metal = s.teams.player.economy.metal;
    const units = combat(s);
    const progress = playerFactory(s).job?.progressSec ?? 0;
    step(s, 0.2);
    expect(s.teams.player.economy.powerDemand).toBeLessThan(GAME_BALANCE.POWER_FACTORY_KW);
    step(s, 20);
    expect(combat(s)).toBe(units);
    expect(playerFactory(s).job?.progressSec ?? 0).toBe(progress);
    // mining keeps going while production is stopped, so metal only grows (fabricator aside)
    expect(s.teams.player.economy.metal + s.teams.player.economy.components * 2).toBeGreaterThanOrEqual(metal);
    expect(s.factoryStatus(playerFactory(s))).toBe('Остановлен');

    s.setFactoryPaused('player', null, false);
    step(s, 15);
    expect(combat(s)).toBeGreaterThan(units);
  });

  it('a paused factory also freezes harvester assembly', () => {
    const s = new GameState();
    s.setFactoryPaused('player', null, true);
    s.orderHarvester('player');
    const before = s.harvesterCount('player');
    step(s, 20);
    expect(s.harvesterCount('player')).toBe(before);
    s.setFactoryPaused('player', null, false);
    step(s, GAME_BALANCE.HARVESTER_BUILD_SEC + 1);
    expect(s.harvesterCount('player')).toBe(before + 1);
  });

  it('the production agent can stop and resume factories', () => {
    const s = new GameState();
    expect(s.applyProductionAction('player', { type: 'set_production', paused: true })).toMatch(/остановлено/);
    expect(playerFactory(s).paused).toBe(true);
    s.applyProductionAction('player', { type: 'set_production', paused: false });
    expect(playerFactory(s).paused).toBe(false);
    expect(normalizeActions([{ type: 'set_production', paused: 'true' }, { type: 'set_production' }])).toEqual([{ type: 'set_production', paused: true }]);
  });

  it('understands stop / resume orders without the cloud and does not mistake them for "build a factory"', () => {
    const stop = localEngineer('Останови производство, копим металл на электростанцию', { ...new GameState().teams.player.design });
    expect(stop.actions).toContainEqual({ type: 'set_production', paused: true });
    const resume = localEngineer('Запусти завод снова', { ...new GameState().teams.player.design });
    expect(resume.actions).toEqual([{ type: 'set_production', paused: false }]);
  });
});

describe('order feedback', () => {
  it('tells the player when ordered harvesters wait on a stopped factory', () => {
    const s = new GameState();
    s.setFactoryPaused('player', null, true);
    expect(s.applyProductionAction('player', { type: 'build_harvester', count: 1 })).toMatch(/остановленном заводе/);
  });
});

describe('the fabricator stocks what the next robot needs', () => {
  // 435 metal / 230 components: more components than the default reserve (180) and the AI's cap (220)
  const pricey = (s: GameState): RobotDesign => ({
    ...s.teams.player.design,
    name: 'Railgun Tank',
    chassisId: 'medium_tracked',
    modules: ['sniper_railgun', 'autocannon_20mm', 'heat_radiator', 'radar_sensor', 'reinforced_steel'],
  });

  it('a design pricier than the reserve gets built instead of waiting forever; the reserve setting stays', () => {
    const s = new GameState();
    const design = pricey(s);
    const unit = RobotBuilder.calculateStats(design);
    expect(unit.isValid).toBe(true);
    expect(unit.componentCost).toBeGreaterThan(220);
    s.setFactoryPaused('enemy', null, true); // no enemy wave while the player waits for its first robot
    s.teams.player.design = design;
    s.teams.player.economy.metal = 3000;
    s.teams.player.economy.components = 0;
    expect(s.componentTarget('player')).toBe(unit.componentCost);
    step(s, unit.componentCost / GAME_BALANCE.FABRICATOR_RATE_PER_SEC + unit.buildTimeSec + 10);
    expect(s.teams.player.economy.totals.unitsBuilt).toBeGreaterThan(0);
    expect(s.teams.player.economy.componentReserve).toBe(GAME_BALANCE.DEFAULT_COMPONENT_RESERVE);
  });

  it('the AI\'s capped reserve no longer stops the fabricator below the robot\'s price', () => {
    const s = new GameState();
    s.teams.enemy.design = pricey(s);
    const e = s.teams.enemy.economy;
    e.metal = 450; // under 500 the AI caps its reserve at 220
    e.components = 225;
    const offline = { provider: 'offline' as const, apiKey: '', model: '', baseUrl: '', enemyUsesLLM: false, autonomousTactics: false, chargeEnemyToPlayer: false, autoSpeakResponse: false, matchCoinLimit: 40, soundMuted: true };
    const d = new AIDirector(offline, { chat() {}, proposal() {}, tactical() {}, intercept() {}, changed() {} });
    d.update(s, 0.05);
    expect(e.componentReserve).toBeLessThanOrEqual(220);
    s.update(0.05);
    expect(e.fabricatorActive).toBe(true);
    expect(e.components).toBeGreaterThan(225);
  });

  it('waiting orders add their components; a cheap design keeps the plain reserve', () => {
    const s = new GameState();
    expect(s.componentTarget('player')).toBe(GAME_BALANCE.DEFAULT_COMPONENT_RESERVE);
    const design = pricey(s);
    s.teams.player.design = design;
    s.teams.player.economy.metal = 0;
    s.applyAgentAction('player', { type: 'build', building: 'radar', where: 'base' });
    expect(s.componentTarget('player')).toBe(RobotBuilder.calculateStats(design).componentCost + PAD_BUILDINGS.radar.components);
  });

  it('a batch started before a redesign is covered until it is done', () => {
    const s = new GameState();
    s.teams.player.design = pricey(s);
    const unit = RobotBuilder.calculateStats(s.teams.player.design);
    const e = s.teams.player.economy;
    e.metal = unit.metalCost;
    e.components = unit.componentCost;
    s.update(0.05); // the batch starts and pays for its first robot
    for (let t = 0; t < unit.buildTimeSec + 1; t += 0.05) {
      e.metal = 0; // nothing for the second one
      e.components = 0;
      s.update(0.05);
    }
    const job = playerFactory(s).job;
    expect(job?.unitPaid).toBe(false);
    s.teams.player.design = new GameState().teams.player.design; // a cheap redesign
    expect(s.componentTarget('player')).toBe(job!.stats.componentCost);
  });

  it('the agents see the fabricator\'s target when it is above the reserve', () => {
    const s = new GameState();
    expect(commanderUserPrompt(s, 'enemy')).not.toContain('фабрикатор держит');
    s.teams.enemy.design = pricey(s);
    const n = RobotBuilder.calculateStats(s.teams.enemy.design).componentCost;
    expect(commanderUserPrompt(s, 'enemy')).toContain(`резерв компонентов 180 (фабрикатор держит ${n} под следующую машину)`);
    const en = englishPrompts({ replyLanguage: 'English', markForTranslation: false });
    expect(en.commanderUser(s, 'enemy')).toContain(`component reserve 180 (the fabricator keeps ${n} for the next robot)`);
  });
});
