import { describe, expect, it } from 'vitest';
import { GAME_BALANCE } from '../src/config/balance';
import { localEngineer } from '../src/ai/fallbacks';
import { normalizeActions } from '../src/ai/parsing';
import { GameState } from '../src/engine/GameState';

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
