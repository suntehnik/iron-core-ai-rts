import { describe, expect, it } from 'vitest';
import { GAME_BALANCE } from '../src/config/balance';
import { localCommanderDecision } from '../src/ai/fallbacks';
import { commanderUserPrompt, tacticianUserPrompt } from '../src/ai/prompts';
import { GameState } from '../src/engine/GameState';
import { TERRAIN_CODE, TerrainGrid } from '../src/engine/terrain/TerrainGrid';
import { ChassisType } from '../src/types/robot';
import { CombatUnit, Team } from '../src/types/game';

const W = GAME_BALANCE.MAP_WIDTH;
const H = GAME_BALANCE.MAP_HEIGHT;

function field(fill: (x: number, y: number) => number): TerrainGrid {
  const cells = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells[y * W + x] = fill(x, y);
  return new TerrainGrid(W, H, cells);
}
/** A band of trees (or rocks) across the middle of the map, x = 48..51, rows y0..y1. */
const band = (code: number, y0 = 0, y1 = H - 1) => field((x, y) => (x >= 48 && x <= 51 && y >= y0 && y <= y1 ? code : TERRAIN_CODE.open));

/** A match with the bases in place (they are far from the middle) but no machines. */
function battlefield(terrain?: TerrainGrid): GameState {
  const s = new GameState();
  if (terrain) s.setTerrain(terrain);
  s.units = [];
  return s;
}

function bot(s: GameState, team: Team, x: number, y: number, chassisId: ChassisType = 'light_biped', modules = ['light_composite', 'autocannon_20mm']): CombatUnit {
  s.spawnCombatBot(team, { x, y }, { ...s.teams[team].design, chassisId, modules }, 1);
  return s.units[s.units.length - 1] as CombatUnit;
}

function run(s: GameState, seconds: number) {
  for (let t = 0; t < seconds; t += 0.05) s.update(0.05);
}

describe('fog of war: who sees whom', () => {
  it('forest hides what is behind it, rocks do not', () => {
    const s = battlefield(band(TERRAIN_CODE.forest));
    const p = bot(s, 'player', 44, 30);
    const e = bot(s, 'enemy', 56, 30);
    s.vision.recompute(s);
    expect(s.vision.sees('player', e.id)).toBe(false);
    expect(s.vision.sees('enemy', p.id)).toBe(false);
    s.setTerrain(band(TERRAIN_CODE.rock));
    s.vision.recompute(s);
    expect(s.vision.sees('player', e.id)).toBe(true);
    expect(s.vision.sees('enemy', p.id)).toBe(true);
  });

  it('sight depends on the chassis, and a radar widens it', () => {
    const s = battlefield();
    const scout = bot(s, 'player', 40, 20);
    const near = bot(s, 'enemy', 63, 20);
    const far = bot(s, 'enemy', 67, 20);
    const heavy = bot(s, 'player', 40, 45, 'heavy_quad');
    const close = bot(s, 'enemy', 57, 45);
    const beyondHeavy = bot(s, 'enemy', 61, 45);
    s.vision.recompute(s);
    expect(s.vision.sees('player', near.id)).toBe(true);
    expect(s.vision.sees('player', far.id)).toBe(false);
    expect(s.vision.sees('player', close.id)).toBe(true);
    expect(s.vision.sees('player', beyondHeavy.id)).toBe(false);
    void scout;
    void heavy;

    const r = battlefield();
    bot(r, 'player', 40, 20, 'light_biped', ['light_composite', 'autocannon_20mm', 'radar_sensor']);
    const radarSpot = bot(r, 'enemy', 69, 20);
    r.vision.recompute(r);
    expect(r.vision.sees('player', radarSpot.id)).toBe(true);
  });

  it('the fog grid on screen is clear around our machines and dark behind the trees', () => {
    const s = battlefield(band(TERRAIN_CODE.forest));
    bot(s, 'player', 44, 30);
    const g = s.vision.fogGrid(s, 'player');
    const at = (x: number, y: number) => g.cells[Math.floor(y / 2) * g.cols + Math.floor(x / 2)];
    expect(at(46, 30)).toBe(1);
    expect(at(56, 30)).toBe(0);
    expect(at(44, 58)).toBe(0); // beyond sight
    const open = battlefield();
    bot(open, 'player', 44, 30);
    expect(open.vision.pointVisible(open, 'player', 56, 30)).toBe(true);
  });

  it('the design-trial arena is an open range: both squads see everything', () => {
    const arena = new GameState({ arena: true });
    expect(arena.vision.enabled).toBe(false);
    expect(arena.vision.sees('player', 'anything')).toBe(true);
  });
});

describe('fog of war in battle', () => {
  it('a machine does not shoot through trees at an enemy an ally spots, it goes around for a clear shot', () => {
    // trees only across the centre rows: a spotter north of the grove sees the enemy
    const s = battlefield(band(TERRAIN_CODE.forest, 20, 40));
    const shooter = bot(s, 'player', 44, 30);
    bot(s, 'player', 50, 12); // spotter
    const e = bot(s, 'enemy', 56, 30, 'medium_tracked', ['reinforced_steel']); // unarmed target
    run(s, 0.6);
    expect(shooter.targetId).toBe(e.id);
    expect(shooter.lastShotAt).toBe(-999);
    run(s, 12);
    expect(shooter.lastShotAt).toBeGreaterThan(0);
  });

  it('without trees the same machine opens fire at once', () => {
    const s = battlefield();
    const shooter = bot(s, 'player', 44, 30);
    bot(s, 'enemy', 56, 30, 'medium_tracked', ['reinforced_steel']);
    run(s, 0.6);
    expect(shooter.lastShotAt).toBeGreaterThan(0);
  });

  it('nobody targets an enemy no one on our side sees', () => {
    const s = battlefield(band(TERRAIN_CODE.forest));
    const shooter = bot(s, 'player', 44, 30);
    bot(s, 'enemy', 56, 30, 'medium_tracked', ['reinforced_steel']);
    run(s, 0.6);
    expect(shooter.targetId).toBeNull();
  });

  it('the siege cannon lobs shells over the forest at a target an ally spots', () => {
    const s = battlefield(band(TERRAIN_CODE.forest, 20, 40));
    const gun = bot(s, 'player', 40, 30, 'heavy_quad', ['reinforced_steel', 'heavy_siege_cannon']);
    gun.design.tacticalRole = 'artillery';
    bot(s, 'player', 50, 12); // spotter
    bot(s, 'enemy', 56, 30, 'medium_tracked', ['reinforced_steel']);
    run(s, 5);
    expect(gun.lastShotAt).toBeGreaterThan(0);
  });

  it('the HQ turret does not fire through trees', () => {
    const hq = { x: 10, y: 30 };
    const grove = field((x, y) => (x >= 15 && x <= 17 && y >= 26 && y <= 34 ? TERRAIN_CODE.forest : TERRAIN_CODE.open));
    const shotsFromHq = (terrain?: TerrainGrid) => {
      const s = battlefield(terrain);
      bot(s, 'enemy', hq.x + 13, hq.y, 'medium_tracked', ['reinforced_steel']);
      const hqId = s.getHQ('player')!.id;
      const shots = new Set<string>();
      for (let t = 0; t < 2; t += 0.05) {
        s.update(0.05);
        for (const p of s.projectiles) if (p.sourceId === hqId) shots.add(p.id);
      }
      return shots.size;
    };
    expect(shotsFromHq(grove)).toBe(0);
    expect(shotsFromHq()).toBeGreaterThan(0);
  });

  it('a model hidden behind trees is not reported as sighted', () => {
    const s = battlefield(band(TERRAIN_CODE.forest));
    bot(s, 'player', 44, 30);
    bot(s, 'enemy', 56, 30);
    run(s, 1.2);
    expect(s.events.some(e => e.team === 'player' && e.type === 'enemy_new_design')).toBe(false);
    s.setTerrain(band(TERRAIN_CODE.rock));
    run(s, 1.2);
    expect(s.events.some(e => e.team === 'player' && e.type === 'enemy_new_design')).toBe(true);
  });
});

describe('fog of war in the agents’ reports', () => {
  it('commanders get what is in sight and the last contact, never the live enemy army', () => {
    const s = battlefield(band(TERRAIN_CODE.forest));
    bot(s, 'player', 44, 30, 'medium_tracked', ['reinforced_steel']);
    for (const y of [26, 30, 34]) bot(s, 'enemy', 56, y, 'medium_tracked', ['reinforced_steel']);
    s.vision.recompute(s);
    expect(commanderUserPrompt(s, 'player')).toContain('контакта ещё не было');
    expect(s.enemyIntel('player')).toEqual({ visible: 0, lastContactAgo: null, lastCount: 0 });

    s.setTerrain(band(TERRAIN_CODE.rock));
    s.update(0.05); // vision and the sighting report
    expect(commanderUserPrompt(s, 'player')).toContain('в поле зрения 3 боевых машин');
    expect(tacticianUserPrompt(s, null, [], null)).toContain('в поле зрения 3 боевых машин');

    s.setTerrain(band(TERRAIN_CODE.forest));
    s.gameTime += 30;
    s.vision.recompute(s);
    expect(commanderUserPrompt(s, 'player')).toContain('последний контакт 30 с назад (3 машин)');
    const report = s.observedEnemyDesigns('player');
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ count: 3, inSight: 0 });
    expect(commanderUserPrompt(s, 'player')).toMatch(/×3, видели 30 с назад/);
  });

  it('the rule-based commander assumes parity without contact instead of reading the hidden army', () => {
    const hidden = battlefield(band(TERRAIN_CODE.forest));
    for (const y of [22, 26, 30, 34, 38]) bot(hidden, 'player', 44, y);
    bot(hidden, 'enemy', 56, 30);
    hidden.vision.recompute(hidden);
    expect(localCommanderDecision(hidden, 'player').plan.stance).toBe('hold_center');

    const seen = battlefield(band(TERRAIN_CODE.rock));
    for (const y of [22, 26, 30, 34, 38]) bot(seen, 'player', 44, y);
    bot(seen, 'enemy', 56, 30);
    seen.vision.recompute(seen);
    expect(localCommanderDecision(seen, 'player').plan.stance).toBe('advance');
  });
});
