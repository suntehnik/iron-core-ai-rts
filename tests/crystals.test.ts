import { describe, expect, it } from 'vitest';
import { localCommanderDecision, localEngineer } from '../src/ai/fallbacks';
import { normalizeActions } from '../src/ai/parsing';
import { commanderUserPrompt, compactCatalog, engineerUserPrompt } from '../src/ai/prompts';
import { ARTILLERY, CRYSTAL, GAME_BALANCE, PAD_BUILDINGS } from '../src/config/balance';
import { levelConfig } from '../src/config/levels';
import { GameState } from '../src/engine/GameState';
import { TERRAIN_CODE, TerrainGrid } from '../src/engine/terrain/TerrainGrid';
import { Building, CombatUnit, HarvesterUnit, Team } from '../src/types/game';
import { RobotDesign } from '../src/types/robot';

const W = GAME_BALANCE.MAP_WIDTH;
const H = GAME_BALANCE.MAP_HEIGHT;

function run(s: GameState, seconds: number) {
  for (let t = 0; t < seconds; t += 0.05) s.update(0.05);
}

function rich(level: number): GameState {
  const s = new GameState({ level: levelConfig(level) });
  for (const team of ['player', 'enemy'] as Team[]) {
    s.teams[team].economy.metal = 5000;
    s.teams[team].economy.components = 1000;
  }
  return s;
}

const design = (s: GameState, chassisId: RobotDesign['chassisId'], modules: string[]): RobotDesign => ({
  ...s.teams.player.design,
  id: `t_${chassisId}_${modules.join('_')}`,
  chassisId,
  modules,
  version: 2,
});

describe('crystals', () => {
  it('appear from level 4: two deposits in the middle; none before, none without a level', () => {
    const crystalPatches = (s: GameState) => s.resourcePatches.filter(p => p.resource === 'crystal');
    expect(new GameState().crystals).toBe(false);
    expect(crystalPatches(new GameState({ level: levelConfig(3) }))).toHaveLength(0);
    const l4 = new GameState({ level: levelConfig(4) });
    expect(l4.crystals).toBe(true);
    expect(crystalPatches(l4).map(p => p.pos)).toEqual([{ x: 50, y: 21 }, { x: 50, y: 39 }]);
    for (const p of crystalPatches(l4)) expect(l4.terrain.clearanceAt(p.pos)).toBeGreaterThanOrEqual(2.5);
  });

  it('a harvester mines crystals at half rate, 25 per trip, and they go to the crystal stock', () => {
    const s = new GameState({ level: levelConfig(4) });
    const patch = s.resourcePatches.find(p => p.resource === 'crystal')!;
    const h = s.units.find((u): u is HarvesterUnit => u.kind === 'harvester' && u.team === 'player')!;
    s.units = s.units.filter(u => u === h);
    h.pos = { x: patch.pos.x - 2.5, y: patch.pos.y };
    h.targetId = patch.id;
    h.targetType = 'ore';
    run(s, 1);
    expect(h.cargo).toBe('crystal');
    const rate = h.carrying; // ~1 s of mining
    expect(rate).toBeLessThanOrEqual(GAME_BALANCE.HARVEST_RATE_PER_SEC * CRYSTAL.RATE_MUL + 0.5);
    run(s, 40);
    expect(s.teams.player.economy.crystals).toBeGreaterThanOrEqual(CRYSTAL.CARRY);
    expect(s.teams.player.economy.totals.crystalsMined).toBe(s.teams.player.economy.crystals);
  });

  it('below the reserve at most a third of the harvesters go for crystals; above it nobody does', () => {
    const s = new GameState({ level: levelConfig(4) });
    for (let i = 0; i < 4; i++) s.spawnHarvester('player', { x: 16, y: 24 + i * 3 });
    run(s, 6);
    const onCrystals = () =>
      s.units.filter(
        u => u.kind === 'harvester' && u.team === 'player' && (s.resourcePatches.find(p => p.id === u.targetId)?.resource === 'crystal' || u.cargo === 'crystal'),
      ).length;
    expect(onCrystals()).toBeGreaterThan(0);
    expect(onCrystals()).toBeLessThanOrEqual(2); // 6 harvesters
    s.teams.player.economy.crystals = 500;
    expect(s.wantsCrystals('player')).toBe(false);
  });

  it('robots priced in crystals wait for them; below level 4 there is no crystal price', () => {
    const s = rich(4);
    s.setDesign('player', design(s, 'heavy_quad', ['reinforced_steel', 'autocannon_20mm', 'autocannon_20mm']));
    s.teams.player.economy.crystals = 0;
    run(s, 2);
    const factory = s.buildings.find(b => b.team === 'player' && b.type === 'factory')!;
    expect(s.factoryStatus(factory)).toBe('Ждёт кристаллов');
    s.teams.player.economy.crystals = 100;
    run(s, 1);
    expect(s.teams.player.economy.crystals).toBe(100 - 20);

    const l3 = rich(3);
    l3.setDesign('player', design(l3, 'heavy_quad', ['reinforced_steel', 'autocannon_20mm', 'autocannon_20mm']));
    run(l3, 2);
    expect(l3.factoryStatus(l3.buildings.find(b => b.team === 'player' && b.type === 'factory')!)).not.toBe('Ждёт кристаллов');
  });

  it('pad buildings priced in crystals: the radar needs 20, a cancelled site refunds them', () => {
    const s = rich(4);
    expect(s.canBuildOnPad('player', 'radar').reason).toBe('Нужно 20 кристаллов');
    s.teams.player.economy.crystals = 30;
    expect(s.buildOnPad('player', 'radar').ok).toBe(true);
    expect(s.teams.player.economy.crystals).toBe(10);
    const site = s.buildings.find(b => b.type === 'radar')!;
    s.cancelConstruction('player', site.id);
    expect(s.teams.player.economy.crystals).toBe(10 + 15);
  });
});

describe('laboratory', () => {
  it('from level 6 advanced parts wait for a laboratory; with one they are built', () => {
    const s = rich(6);
    s.teams.player.economy.crystals = 500;
    const plasma = design(s, 'medium_tracked', ['reinforced_steel', 'plasma_blasters', 'heat_radiator']);
    expect(s.designTechNotes('player', plasma)[0]).toContain('Нужна лаборатория для');
    s.setDesign('player', plasma);
    run(s, 2);
    const factory = s.buildings.find(b => b.team === 'player' && b.type === 'factory')!;
    expect(s.factoryStatus(factory)).toBe('Нужна лаборатория');
    expect(factory.job).toBeNull();
    s.placeReady('player', 'lab');
    run(s, 1);
    expect(factory.job?.design.modules).toContain('plasma_blasters');
    // below level 6 nothing is locked
    const l5 = rich(5);
    expect(l5.lockedParts('player', { labParts: ['plasma_blasters'] })).toEqual([]);
  });

  it('an AI general without a laboratory gets its advanced parts swapped for basic ones', () => {
    const s = rich(6);
    const plasma = design(s, 'medium_tracked', ['reinforced_steel', 'plasma_blasters', 'heat_radiator']);
    const fitted = s.fitDesign('enemy', plasma)!;
    expect(fitted.modules).not.toContain('plasma_blasters');
    expect(fitted.modules).toContain('autocannon_20mm');
    s.placeReady('enemy', 'lab');
    expect(s.fitDesign('enemy', plasma)).toBe(plasma);
  });

  it('the rule-based general builds a laboratory on level 6', () => {
    const s = rich(6);
    s.teams.enemy.economy.crystals = 200;
    s.spawnHarvester('enemy', { x: 86, y: 26 });
    expect(localCommanderDecision(s, 'enemy').actions).toContainEqual({ type: 'build', building: 'lab', where: 'base' });
  });
});

describe('artillery turret', () => {
  function range(terrain?: TerrainGrid) {
    const s = new GameState();
    if (terrain) s.setTerrain(terrain);
    s.units = [];
    const gun = s.placeReady('player', 'artillery', 'forward') as Building;
    return { s, gun };
  }
  const shots = (s: GameState, gun: Building, seconds: number) => {
    const fired = new Set<string>();
    for (let t = 0; t < seconds; t += 0.05) {
      s.update(0.05);
      for (const p of s.projectiles) if (p.sourceId === gun.id) fired.add(p.id);
    }
    return fired.size;
  };
  const target = (s: GameState, x: number, y: number): CombatUnit => {
    s.spawnCombatBot('enemy', { x, y }, { ...s.teams.enemy.design, chassisId: 'medium_tracked', modules: ['reinforced_steel'] }, 1);
    const e = s.units[s.units.length - 1] as CombatUnit;
    e.hp = e.maxHp = 100000;
    return e;
  };

  it('lobs shells over the forest at a target its side spots', () => {
    const pad = { x: 41, y: 15 }; // forward north pad
    const cells = new Uint8Array(W * H);
    for (let y = 0; y < 12; y++) for (let x = 0; x < W; x++) if (x >= 46 && x <= 48) cells[y * W + x] = TERRAIN_CODE.forest;
    const { s, gun } = range(new TerrainGrid(W, H, cells));
    expect(gun.pos).toEqual(pad);
    target(s, 60, 8); // behind the trees: nobody sees it
    expect(shots(s, gun, 4)).toBe(0);
    s.spawnCombatBot('player', { x: 56, y: 16 }, s.teams.player.design, 1); // a spotter in the open
    expect(shots(s, gun, ARTILLERY.INTERVAL + 1)).toBeGreaterThan(0);
  });

  it('does not fire at point-blank range', () => {
    const { s, gun } = range();
    target(s, gun.pos.x + ARTILLERY.MIN_RANGE - 2, gun.pos.y);
    expect(shots(s, gun, 4)).toBe(0);
  });

  it('the level-6 enemy starts with a ready artillery turret', () => {
    const s = new GameState({ level: levelConfig(6) });
    const art = s.buildings.filter(b => b.team === 'enemy' && b.type === 'artillery');
    expect(art).toHaveLength(1);
    expect(art[0].built).toBe(1);
    expect(s.buildings.some(b => b.team === 'player' && b.type === 'artillery')).toBe(false);
  });
});

describe('crystals and the laboratory for the agents', () => {
  it('the catalog shows crystal prices and advanced parts', () => {
    const cat = compactCatalog();
    expect(cat).toMatch(/heavy_quad: .*\/20кр/);
    expect(cat).toMatch(/plasma_blasters .*\/15кр.*деталь второго уровня/);
  });

  it('the report explains crystals and the laboratory only where they apply', () => {
    expect(engineerUserPrompt(new GameState({ level: levelConfig(2) }), 'x', null)).not.toContain('КРИСТАЛЛЫ И ТЕХНОЛОГИИ');
    expect(engineerUserPrompt(new GameState({ level: levelConfig(4) }), 'x', null)).toMatch(/КРИСТАЛЛЫ И ТЕХНОЛОГИИ: кристаллов 0, резерв 60/);
    const l6 = commanderUserPrompt(new GameState({ level: levelConfig(6) }), 'enemy');
    expect(l6).toContain('недоступны без лаборатории');
    expect(l6).toContain('lab — лаборатория');
  });

  it('agents set the crystal reserve; the local engineer understands the laboratory and the artillery turret', () => {
    expect(normalizeActions([{ type: 'set_crystal_reserve', amount: 900 }])).toEqual([{ type: 'set_crystal_reserve', amount: 400 }]);
    const s = new GameState({ level: levelConfig(4) });
    s.applyProductionAction('player', { type: 'set_crystal_reserve', amount: 120 });
    expect(s.teams.player.economy.crystalReserve).toBe(120);
    const d = s.teams.player.design;
    expect(localEngineer('Построй лабораторию', d).actions).toContainEqual({ type: 'build', building: 'lab', where: 'base' });
    const art = localEngineer('Поставь артиллерийскую турель', d).actions;
    expect(art).toContainEqual({ type: 'build', building: 'artillery', where: 'base' });
    expect(art.some(a => a.type === 'build' && a.building === 'turret')).toBe(false);
    expect(localEngineer('Держи резерв кристаллов 100', d).actions).toContainEqual({ type: 'set_crystal_reserve', amount: 100 });
  });

  it('PAD_BUILDINGS prices crystals only for the radar, the laboratory and the artillery turret', () => {
    expect(Object.entries(PAD_BUILDINGS).filter(([, s]) => s.crystals).map(([k]) => k)).toEqual(['radar', 'lab', 'artillery']);
  });
});
