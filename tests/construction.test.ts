import { describe, expect, it } from 'vitest';
import { localCommanderDecision } from '../src/ai/fallbacks';
import { normalizeActions } from '../src/ai/parsing';
import { commanderUserPrompt } from '../src/ai/prompts';
import { GAME_BALANCE } from '../src/config/balance';
import { levelConfig } from '../src/config/levels';
import { GameState } from '../src/engine/GameState';
import { Building, HarvesterUnit } from '../src/types/game';

function run(s: GameState, seconds: number) {
  for (let t = 0; t < seconds; t += 0.05) s.update(0.05);
}

function rich(): GameState {
  const s = new GameState();
  s.teams.player.economy.metal = 5000;
  s.teams.player.economy.components = 1000;
  return s;
}

const harvesters = (s: GameState) => s.units.filter((u): u is HarvesterUnit => u.kind === 'harvester' && u.team === 'player');
const site = (s: GameState, type: Building['type']) => s.buildings.find(b => b.team === 'player' && b.type === type && b.built < 1)!;

describe('construction by harvesters', () => {
  it('a building is paid at once and rises only while a harvester works at the site', () => {
    const s = rich();
    const metal = s.teams.player.economy.metal;
    expect(s.buildStructure('player', 'power_plant').ok).toBe(true);
    expect(s.teams.player.economy.metal).toBe(metal - GAME_BALANCE.POWER_PLANT_COST_METAL);
    const plant = site(s, 'power_plant');
    expect(plant.built).toBe(0);

    run(s, 0.1);
    const workers = s.siteWorkers(plant);
    expect(workers).toHaveLength(1);
    // walking to the site: no progress yet
    expect(workers[0].state).not.toBe('constructing');
    expect(plant.built).toBe(0);

    run(s, GAME_BALANCE.POWER_PLANT_BUILD_SEC + 12);
    expect(plant.built).toBe(1);
    expect(workers[0].buildSiteId).toBeNull(); // back to mining
    expect(s.events.some(e => e.team === 'player' && e.type === 'build_complete')).toBe(true);
  });

  it('the worker does not mine while it builds', () => {
    const s = rich();
    s.buildStructure('player', 'power_plant');
    run(s, 0.1);
    const worker = s.siteWorkers(site(s, 'power_plant'))[0];
    const carried = worker.carrying;
    run(s, 8);
    expect(worker.carrying).toBe(carried);
    expect(['moving', 'constructing']).toContain(worker.state);
  });

  it('without a worker at the site nothing happens: the site waits', () => {
    const s = rich();
    s.units = s.units.filter(u => u.kind !== 'harvester');
    s.buildStructure('player', 'power_plant');
    run(s, 20);
    expect(site(s, 'power_plant').built).toBe(0);
    expect(s.siteStatus(site(s, 'power_plant'))).toBe('ждёт рабочего');
    expect(s.events.some(e => e.text.includes('свободных добытчиков нет'))).toBe(true);
  });

  it('two workers build 1.6 times as fast', () => {
    const progress = (workers: number) => {
      const s = rich();
      s.buildStructure('player', 'power_plant', workers);
      const plant = site(s, 'power_plant');
      // put the workers right at the site so travel does not matter
      run(s, 0.1);
      for (const h of s.siteWorkers(plant)) h.pos = { x: plant.pos.x + plant.radius + 1, y: plant.pos.y };
      run(s, 0.2);
      const start = plant.built;
      run(s, 5);
      return plant.built - start;
    };
    expect(progress(2) / progress(1)).toBeCloseTo(1 + GAME_BALANCE.SECOND_WORKER_BONUS, 1);
  });

  it('at most two sites are worked at once; the third waits in a queue', () => {
    const s = rich();
    for (let i = 0; i < 3; i++) s.spawnHarvester('player', { x: 16, y: 26 + i });
    s.buildStructure('player', 'power_plant');
    s.buildStructure('player', 'power_plant');
    s.buildStructure('player', 'factory');
    run(s, 0.6);
    const sites = s.constructionSites('player');
    expect(sites).toHaveLength(3);
    const worked = sites.filter(b => s.siteWorkers(b).length > 0);
    expect(worked).toHaveLength(GAME_BALANCE.MAX_ACTIVE_SITES);
    const queued = sites.find(b => s.siteWorkers(b).length === 0)!;
    expect(s.siteStatus(queued)).toBe('ждёт очереди');
    // once one is done the queued site gets its worker
    run(s, GAME_BALANCE.POWER_PLANT_BUILD_SEC + 15);
    expect(s.siteWorkers(queued).length + (queued.built >= 1 ? 1 : 0)).toBeGreaterThan(0);
  });

  it('a worker under fire flees and the site pauses; it comes back when the danger is gone', () => {
    const s = rich();
    s.buildStructure('player', 'power_plant');
    const plant = site(s, 'power_plant');
    run(s, 0.1);
    const worker = s.siteWorkers(plant)[0];
    worker.pos = { x: plant.pos.x + plant.radius + 1, y: plant.pos.y };
    run(s, 2);
    expect(worker.state).toBe('constructing');

    s.spawnCombatBot('enemy', { x: worker.pos.x + 5, y: worker.pos.y }, s.teams.enemy.design, 1);
    const raider = s.units[s.units.length - 1];
    worker.lastDamagedAt = s.gameTime;
    run(s, 0.3);
    expect(worker.state).toBe('delivering');
    const paused = plant.built;
    run(s, 1);
    expect(plant.built).toBe(paused);
    expect(s.events.some(e => e.text === 'Стройка остановлена: рабочий под огнём')).toBe(true);

    s.units = s.units.filter(u => u !== raider);
    run(s, 15);
    expect(worker.buildSiteId === plant.id || plant.built >= 1).toBe(true);
    expect(plant.built).toBeGreaterThan(paused);
  });

  it('when the worker dies another harvester takes over', () => {
    const s = rich();
    s.buildStructure('player', 'power_plant');
    const plant = site(s, 'power_plant');
    run(s, 0.1);
    const first = s.siteWorkers(plant)[0];
    s.units = s.units.filter(u => u !== first);
    run(s, 1);
    const next = s.siteWorkers(plant);
    expect(next).toHaveLength(1);
    expect(next[0]).not.toBe(first);
  });

  it('a cancelled site refunds 75% and frees its worker', () => {
    const s = rich();
    s.buildStructure('player', 'factory');
    const factory = site(s, 'factory');
    run(s, 0.1);
    const worker = s.siteWorkers(factory)[0];
    const metal = s.teams.player.economy.metal;
    const comps = s.teams.player.economy.components;
    expect(s.cancelConstruction('player', factory.id).ok).toBe(true);
    expect(s.teams.player.economy.metal - metal).toBe(Math.round(GAME_BALANCE.FACTORY_COST_METAL * 0.75));
    expect(Math.round(s.teams.player.economy.components - comps)).toBe(Math.round(GAME_BALANCE.FACTORY_COST_COMPONENTS * 0.75));
    expect(s.buildings.includes(factory)).toBe(false);
    expect(worker.buildSiteId).toBeNull();
  });

  it('starting buildings and level fortifications stand ready', () => {
    expect(new GameState().buildings.every(b => b.built === 1)).toBe(true);
    const endless = new GameState({ level: levelConfig(11) }); // the fourth endless level brings a second enemy factory
    expect(endless.buildingCount('enemy', 'factory')).toBe(2);
    expect(endless.buildings.every(b => b.built === 1)).toBe(true);
  });

  it('agents can send two workers, and they see the sites and builders in the report', () => {
    expect(normalizeActions([{ type: 'build_factory', workers: 2 }, { type: 'build_power_plant', workers: 1 }])).toEqual([
      { type: 'build_factory', workers: 2 },
      { type: 'build_power_plant' },
    ]);
    const s = rich();
    s.applyProductionAction('player', { type: 'build_factory', workers: 2 });
    expect(site(s, 'factory').workersWanted).toBe(2);
    run(s, 0.1);
    const report = commanderUserPrompt(s, 'player');
    expect(report).toContain('(на стройке 2)');
    expect(report).toMatch(/стройки: завод \d+% \(/);
  });

  it('the rule-based general does not start a building with fewer than three harvesters', () => {
    const s = new GameState();
    s.teams.enemy.economy.metal = 2000;
    s.teams.enemy.economy.powerEfficiency = 0.5;
    expect(s.harvesterCount('enemy')).toBe(2);
    const actions = localCommanderDecision(s, 'enemy').actions;
    expect(actions.some(a => a.type === 'build_power_plant' || a.type === 'build_factory')).toBe(false);
  });
});
