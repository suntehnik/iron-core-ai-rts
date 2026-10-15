import { describe, expect, it } from 'vitest';
import { GAME_BALANCE } from '../src/config/balance';
import { GameState } from '../src/engine/GameState';
import { CombatUnit } from '../src/types/game';

function woundedUnit(state: GameState, x: number, hpShare: number): CombatUnit {
  state.spawnCombatBot('player', { x, y: 30 }, state.teams.player.design, 99);
  const u = state.units[state.units.length - 1] as CombatUnit;
  u.hp = u.maxHp * hpShare;
  return u;
}

describe('retreat and repair (plan.retreatHpThreshold)', () => {
  it('a wounded unit next to the HQ gets repaired', () => {
    const s = new GameState();
    s.setPlan('player', { ...s.teams.player.plan, retreatHpThreshold: 40 });
    const u = woundedUnit(s, 17, 0.2);
    const before = u.hp;
    for (let i = 0; i < 20 * 10; i++) s.update(1 / 20); // 10 s
    expect(u.hp).toBeGreaterThan(before + 100);
  });

  it('a wounded unit on the front walks back, repairs to full and rejoins', () => {
    const s = new GameState();
    s.setPlan('player', { ...s.teams.player.plan, retreatHpThreshold: 40 });
    const u = woundedUnit(s, 40, 0.25);
    const seq: string[] = [];
    let peak = 0;
    for (let i = 0; i < 20 * 25; i++) {
      s.update(1 / 20);
      if (seq[seq.length - 1] !== u.state) seq.push(u.state);
      if (u.state === 'repairing') peak = Math.max(peak, u.hp / u.maxHp);
    }
    // retreating → repairing → back to the army (moving / idle at the rally point)
    expect(seq[0]).toBe('retreating');
    expect(seq).toContain('repairing');
    expect(peak).toBeGreaterThan(0.95);
    expect(seq.indexOf('moving', seq.indexOf('repairing'))).toBeGreaterThan(0);
  });

  it('repair draws base power while it runs', () => {
    const s = new GameState();
    s.setPlan('player', { ...s.teams.player.plan, retreatHpThreshold: 40 });
    woundedUnit(s, 17, 0.2);
    let sawRepairDemand = false;
    for (let i = 0; i < 20 * 3; i++) {
      s.update(1 / 20);
      const repairing = s.units.some(x => x.team === 'player' && x.state === 'repairing');
      // demand is recomputed at the start of the next tick, so check it once repairing is under way
      if (repairing && i > 2 && s.teams.player.economy.powerDemand >= GAME_BALANCE.POWER_REPAIR_KW) sawRepairDemand = true;
    }
    expect(sawRepairDemand).toBe(true);
  });
});
