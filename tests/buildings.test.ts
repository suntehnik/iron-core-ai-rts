import { describe, expect, it } from 'vitest';
import { localCommanderDecision, localEngineer } from '../src/ai/fallbacks';
import { normalizeActions } from '../src/ai/parsing';
import { commanderUserPrompt, engineerUserPrompt } from '../src/ai/prompts';
import { GAME_BALANCE, PAD_BUILDINGS, RADAR_SIGHT, REPAIR_DOCK, TURRET, buildingSlot, padSlots } from '../src/config/balance';
import { CAMPAIGN, levelConfig } from '../src/config/levels';
import { GameState } from '../src/engine/GameState';
import { reachableCells } from '../src/engine/terrain/Pathfinding';
import { TERRAIN_CODE, TerrainGrid } from '../src/engine/terrain/TerrainGrid';
import { Building, CombatUnit, HarvesterUnit, PadBuildingType, Team } from '../src/types/game';

const W = GAME_BALANCE.MAP_WIDTH;
const H = GAME_BALANCE.MAP_HEIGHT;

function run(s: GameState, seconds: number) {
  for (let t = 0; t < seconds; t += 0.05) s.update(0.05);
}

function rich(level?: number): GameState {
  const s = level ? new GameState({ level: levelConfig(level) }) : new GameState();
  for (const team of ['player', 'enemy'] as Team[]) {
    s.teams[team].economy.metal = 5000;
    s.teams[team].economy.components = 1000;
  }
  return s;
}

/** Builds a pad building instantly (the construction itself is covered in construction.test.ts). */
function ready(s: GameState, team: Team, type: PadBuildingType, where?: Parameters<GameState['placeReady']>[2]): Building {
  const b = s.placeReady(team, type, where);
  expect(b).not.toBeNull();
  return b!;
}

function bot(s: GameState, team: Team, x: number, y: number): CombatUnit {
  s.spawnCombatBot(team, { x, y }, { ...s.teams[team].design, chassisId: 'medium_tracked', modules: ['reinforced_steel'] }, 1);
  return s.units[s.units.length - 1] as CombatUnit;
}

describe('building pads', () => {
  it('each side has eight base pads and three forward ones, mirrored', () => {
    for (const team of ['player', 'enemy'] as Team[]) {
      const pads = padSlots(team);
      expect(pads.filter(p => p.kind === 'base')).toHaveLength(8);
      expect(pads.filter(p => p.kind === 'forward').map(p => p.flank)).toEqual(['north', 'center', 'south']);
    }
    padSlots('player').forEach((p, i) => expect(padSlots('enemy')[i].pos).toEqual({ x: W - p.pos.x, y: p.pos.y }));
  });

  it('pads do not overlap the fixed slots, deposits or each other', () => {
    const s = new GameState();
    const fixed = [
      { pos: buildingSlot('player', 'command_center'), r: 5 },
      ...[0, 1].map(i => ({ pos: buildingSlot('player', 'factory', i), r: 4 })),
      ...[0, 1, 2].map(i => ({ pos: buildingSlot('player', 'power_plant', i), r: 3.2 })),
      ...s.resourcePatches.map(p => ({ pos: p.pos, r: p.radius + 1 })),
    ];
    const pads = padSlots('player');
    for (const p of pads) {
      for (const f of fixed) expect(Math.hypot(p.pos.x - f.pos.x, p.pos.y - f.pos.y), `pad ${p.id}`).toBeGreaterThan(f.r + 2.8);
      for (const q of pads) if (q !== p) expect(Math.hypot(p.pos.x - q.pos.x, p.pos.y - q.pos.y)).toBeGreaterThan(5.6);
    }
  });

  it('on every level map the pads stand on open ground reachable from the base', () => {
    for (let n = 1; n <= CAMPAIGN.length + 3; n++) {
      const s = new GameState({ level: levelConfig(n) });
      const seen = reachableCells(s.terrain, { x: 18, y: 30 }, 2.1);
      for (const pad of s.pads) {
        expect(s.terrain.clearanceAt(pad.pos), `level ${n} ${pad.id}`).toBeGreaterThanOrEqual(3);
        const { cx, cy } = s.terrain.cellOf(pad.pos);
        expect(seen[s.terrain.index(cx, cy)], `level ${n} ${pad.id}`).toBe(1);
      }
    }
  });
});

describe('pad buildings', () => {
  it('open by campaign level for both sides; all of them without a level', () => {
    expect(new GameState({ level: levelConfig(1) }).unlockedPadBuildings()).toEqual([]);
    expect(new GameState({ level: levelConfig(2) }).unlockedPadBuildings()).toEqual(['turret']);
    expect(new GameState({ level: levelConfig(5) }).unlockedPadBuildings()).toEqual(['turret', 'repair_dock', 'radar', 'depot']);
    expect(new GameState().unlockedPadBuildings()).toHaveLength(Object.keys(PAD_BUILDINGS).length);
    const locked = rich(1);
    expect(locked.buildOnPad('player', 'turret').ok).toBe(false);
    expect(locked.canBuildOnPad('player', 'turret').reason).toBe('Откроется на уровне 2');
  });

  it('a turret is paid, goes on the front base pad and a harvester builds it', () => {
    const s = rich();
    const metal = s.teams.player.economy.metal;
    expect(s.buildOnPad('player', 'turret').ok).toBe(true);
    expect(s.teams.player.economy.metal).toBe(metal - PAD_BUILDINGS.turret.metal);
    const site = s.buildings.find(b => b.type === 'turret')!;
    expect(site.padId).toBe('pad_player_0');
    expect(site.built).toBe(0);
    run(s, PAD_BUILDINGS.turret.buildSec + 15);
    expect(site.built).toBe(1);
  });

  it('a ready turret shoots an enemy in range, about 35 damage a second, but not through trees', () => {
    /** raw damage per second the turret sends at a target held 12 units away */
    const shots = (terrain?: TerrainGrid) => {
      const s = new GameState();
      if (terrain) s.setTerrain(terrain);
      s.units = [];
      const turret = ready(s, 'player', 'turret', 'forward');
      const spot = { x: turret.pos.x + 12, y: turret.pos.y };
      const e = bot(s, 'enemy', spot.x, spot.y);
      e.hp = e.maxHp = 100000;
      const fired = new Set<string>();
      for (let t = 0; t < 6; t += 0.05) {
        s.update(0.05);
        e.pos = { ...spot };
        for (const p of s.projectiles) if (p.sourceId === turret.id) fired.add(p.id);
      }
      return (fired.size * TURRET.DAMAGE) / 6;
    };
    expect(shots()).toBeGreaterThan(30);
    expect(shots()).toBeLessThan(40);
    const pad = padSlots('player')[9].pos; // the forward centre pad
    const cells = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = Math.floor(pad.x + 5); x <= Math.floor(pad.x + 7); x++) cells[y * W + x] = TERRAIN_CODE.forest;
    expect(shots(new TerrainGrid(W, H, cells))).toBe(0);
  });

  it('a damaged machine retreats to the nearest repair dock and heals faster there', () => {
    const s = new GameState();
    s.units = [];
    const dock = ready(s, 'player', 'repair_dock', 'forward');
    s.setPlan('player', { ...s.teams.player.plan, retreatHpThreshold: 50 });
    const u = bot(s, 'player', dock.pos.x + 8, dock.pos.y);
    u.hp = u.maxHp * 0.3;
    run(s, 4);
    expect(Math.hypot(u.pos.x - dock.pos.x, u.pos.y - dock.pos.y)).toBeLessThanOrEqual(REPAIR_DOCK.RADIUS + 1);
    expect(u.state).toBe('repairing');
    const hp = u.hp;
    run(s, 2);
    expect((u.hp - hp) / 2).toBeCloseTo(REPAIR_DOCK.HP_PER_SEC, 0);
  });

  it('the drop-off point goes only on a forward pad, and harvesters unload there', () => {
    const s = new GameState();
    expect(s.freePads('player', 'depot').every(p => p.kind === 'forward')).toBe(true);
    const depot = ready(s, 'player', 'depot', 'north');
    const h = s.units.find((u): u is HarvesterUnit => u.kind === 'harvester' && u.team === 'player')!;
    h.pos = { x: depot.pos.x + 4, y: depot.pos.y };
    h.carrying = h.capacity;
    const metal = s.teams.player.economy.metal;
    const hq = s.getHQ('player')!.pos;
    let closestToHq = Infinity;
    for (let t = 0; t < 3; t += 0.05) {
      s.update(0.05);
      closestToHq = Math.min(closestToHq, Math.hypot(h.pos.x - hq.x, h.pos.y - hq.y));
    }
    // the cargo reached the stock without the trip home (then the harvester mines the deposit nearby)
    expect(s.teams.player.economy.totals.metalMined).toBeGreaterThanOrEqual(h.capacity);
    expect(s.teams.player.economy.metal).toBeGreaterThan(metal - 200); // the fabricator may turn some into components
    expect(closestToHq).toBeGreaterThan(20);
  });

  it('a radar sees 40 units and gives the agents the exact enemy army and what its factories build', () => {
    const s = new GameState();
    s.units = [];
    const radar = ready(s, 'player', 'radar', 'forward');
    const far = bot(s, 'enemy', radar.pos.x + RADAR_SIGHT - 4, radar.pos.y);
    bot(s, 'enemy', 85, 10); // hidden far away
    s.vision.recompute(s);
    expect(s.vision.sees('player', far.id)).toBe(true);
    run(s, 1);
    const intel = s.enemyIntel('player');
    expect(intel.radar?.total).toBe(2);
    const prompt = commanderUserPrompt(s, 'player');
    expect(prompt).toContain('радар: у противника 2 боевых машин');
  });

  it('a destroyed pad building frees its pad', () => {
    const s = new GameState();
    const t = ready(s, 'player', 'turret');
    expect(s.freePads('player', 'turret').some(p => p.id === t.padId)).toBe(false);
    s.spawnCombatBot('enemy', { x: t.pos.x + 6, y: t.pos.y }, s.teams.enemy.design, 1); // armed
    t.hp = 1;
    run(s, 3);
    expect(s.buildings.includes(t)).toBe(false);
    expect(s.freePads('player', 'turret').some(p => p.id === t.padId)).toBe(true);
  });

  it('pad buildings draw base power once ready', () => {
    const s = new GameState();
    run(s, 0.1);
    const demand = s.teams.player.economy.powerDemand;
    ready(s, 'player', 'radar');
    run(s, 0.1);
    expect(s.teams.player.economy.powerDemand - demand).toBe(PAD_BUILDINGS.radar.powerKw);
  });
});

describe('pad buildings for the agents', () => {
  it('the build action is parsed with place and workers; unknown buildings are dropped', () => {
    expect(
      normalizeActions([
        { type: 'build', building: 'turret', where: 'north', workers: 2 },
        { type: 'build', building: 'radar' },
        { type: 'build', building: 'castle' },
        { type: 'build', building: 'depot', where: 'moon' },
      ]),
    ).toEqual([
      { type: 'build', building: 'turret', where: 'north', workers: 2 },
      { type: 'build', building: 'radar' },
      { type: 'build', building: 'depot' },
    ]);
    const s = rich();
    s.applyProductionAction('player', { type: 'build', building: 'turret', where: 'south' });
    expect(s.buildings.find(b => b.type === 'turret')?.padId).toBe('pad_player_10');
  });

  it('the reports list only the buildings open on the level', () => {
    expect(engineerUserPrompt(new GameState({ level: levelConfig(1) }), 'x', null)).toContain('ЗДАНИЯ НА ПЛОЩАДКАХ: на этом уровне пока недоступны');
    const l3 = commanderUserPrompt(new GameState({ level: levelConfig(3) }), 'enemy');
    expect(l3).toContain('turret — турель');
    expect(l3).toContain('repair_dock — ремонтный док');
    expect(l3).not.toContain('radar —');
  });

  it('the local engineer understands turrets, docks, radar towers and drop-off points, but not the radar module', () => {
    const design = new GameState().teams.player.design;
    expect(localEngineer('Поставь турель у базы', design).actions).toContainEqual({ type: 'build', building: 'turret', where: 'base' });
    expect(localEngineer('Построй радарную вышку', design).actions).toContainEqual({ type: 'build', building: 'radar', where: 'base' });
    expect(localEngineer('Нужен пункт приёма у центра', design).actions).toContainEqual({ type: 'build', building: 'depot', where: 'forward' });
    expect(localEngineer('Build a repair dock at the front', design).actions).toContainEqual({ type: 'build', building: 'repair_dock', where: 'forward' });
    expect(localEngineer('Поставь радар на робота', design).actions.some(a => a.type === 'build')).toBe(false);
  });

  it('the rule-based general puts up a turret after a raid on its base', () => {
    const s = rich();
    for (let i = 0; i < 2; i++) s.spawnHarvester('enemy', { x: 86, y: 26 + i * 4 });
    s.pushEvent('enemy', 'base_attack', 'Противник атакует командный центр!', true);
    expect(localCommanderDecision(s, 'enemy').actions).toContainEqual({ type: 'build', building: 'turret', where: 'base' });
  });
});
