import { describe, expect, it } from 'vitest';
import { INITIAL_ENEMY_DESIGN, INITIAL_PLAYER_DESIGN } from '../src/config/balance';
import { pickTrialOpponent, runDesignTrial, simulateSkirmish, trialVerdict, unitCost } from '../src/engine/DesignTrial';
import { GameState } from '../src/engine/GameState';
import { RobotDesign } from '../src/types/robot';

const design = (name: string, chassisId: RobotDesign['chassisId'], modules: string[]): RobotDesign => ({
  ...INITIAL_PLAYER_DESIGN,
  id: name,
  name,
  chassisId,
  modules,
});

const heavyArmour = design('Бастион', 'medium_tracked', ['reinforced_steel', 'autocannon_20mm', 'autocannon_20mm']);
const lightBiped = INITIAL_PLAYER_DESIGN; // light biped with a 20mm autocannon
const autocannons = INITIAL_ENEMY_DESIGN; // enemy light biped with a 20mm autocannon

describe('design test bench', () => {
  it('heavy armour beats autocannons more often than a light biped does', () => {
    const heavy = runDesignTrial(heavyArmour, autocannons, 'baseline');
    const light = runDesignTrial(lightBiped, autocannons, 'baseline');
    expect(heavy.candidate.winRate).toBeGreaterThan(light.candidate.winRate);
    expect(heavy.candidate.avgHpLeft).toBeGreaterThan(light.candidate.avgHpLeft);
  });

  it('a mirror match is roughly even', () => {
    const r = runDesignTrial(lightBiped, autocannons, 'baseline');
    expect(r.candidate.winRate).toBeGreaterThanOrEqual(0.25);
    expect(r.candidate.winRate).toBeLessThanOrEqual(0.75);
  });

  it('is deterministic for the same pair of designs and fast enough to run on click', () => {
    const a = runDesignTrial(heavyArmour, autocannons, 'baseline', { serial: lightBiped });
    const b = runDesignTrial(heavyArmour, autocannons, 'baseline', { serial: lightBiped });
    expect(a.candidate.runs).toEqual(b.candidate.runs);
    expect(a.serial?.runs).toEqual(b.serial?.runs);
    expect(a.computeMs).toBeLessThan(500);
  });

  it('compares one expensive machine with several cheap ones (equal budget, brief §4)', () => {
    const siege = design('Молот', 'heavy_quad', ['reinforced_steel', 'heavy_siege_cannon', 'diesel_electric', 'radar_sensor']);
    const r = runDesignTrial(siege, autocannons, 'baseline');
    expect(unitCost(siege)).toBeGreaterThan(unitCost(autocannons));
    expect(r.equalBudget).not.toBeNull();
    expect(r.equalBudget!.count).toBeLessThan(r.opponentCount);
  });

  it('includes the serial model for comparison and phrases a verdict', () => {
    const r = runDesignTrial(heavyArmour, autocannons, 'observed', { serial: lightBiped });
    expect(r.serial).not.toBeNull();
    expect(trialVerdict(r)).toMatch(/лучше текущей серии/);
  });

  it('runs skirmishes on an empty arena that never ends the real match', () => {
    const arena = new GameState({ arena: true });
    expect(arena.buildings).toHaveLength(0);
    arena.update(1);
    expect(arena.gameOver).toBeNull();
    const run = simulateSkirmish(heavyArmour, 2, autocannons, 2, 20, 7);
    expect(['player', 'enemy', 'draw']).toContain(run.winner);
    expect(run.duration).toBeGreaterThan(0);
  });

  it('uses only scouted enemy designs (no omniscience)', () => {
    const state = new GameState();
    state.teams.enemy.design = design('Секретный', 'heavy_quad', ['sloped_reactive', 'sniper_railgun', 'diesel_electric']);
    const pick = pickTrialOpponent(state);
    expect(pick.source).toBe('baseline');
    expect(pick.design.name).toBe(INITIAL_ENEMY_DESIGN.name);
  });
});
