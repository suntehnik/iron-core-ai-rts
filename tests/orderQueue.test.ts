import { describe, expect, it } from 'vitest';
import { AIDirector } from '../src/ai/AIDirector';
import { commanderUserPrompt, engineerUserPrompt } from '../src/ai/prompts';
import { englishPrompts } from '../src/ai/promptsEn';
import { GAME_BALANCE, PAD_BUILDINGS } from '../src/config/balance';
import { levelConfig } from '../src/config/levels';
import { GameState } from '../src/engine/GameState';
import { RobotBuilder } from '../src/engine/RobotBuilder';
import { LLMSettings, ProductionProposal } from '../src/types/agent';
import { Team } from '../src/types/game';

const TTL = GAME_BALANCE.ORDER_QUEUE_TTL_SEC;
const TURRET = PAD_BUILDINGS.turret;

/** Simulates `seconds` with the side's purse held at the given amounts (mining would refill it). */
function hold(s: GameState, team: Team, seconds: number, metal = 0, components = 0) {
  for (let t = 0; t < seconds; t += 0.05) {
    s.teams[team].economy.metal = metal;
    s.teams[team].economy.components = components;
    s.update(0.05);
  }
}

/** A side whose factory has already paid for the unit it assembles: the next tick takes no metal for it. */
function midBatch(): GameState {
  const s = new GameState();
  s.update(0.05);
  expect(s.buildings.find(b => b.team === 'player' && b.type === 'factory')?.job?.unitPaid).toBe(true);
  return s;
}

const unitCost = (s: GameState, team: Team = 'player') => RobotBuilder.calculateStats(s.teams[team].design);

describe('agents\' order queue', () => {
  it('keeps an agent\'s unaffordable order instead of refusing it; the UI buttons still refuse at once', () => {
    const ui = new GameState();
    ui.teams.player.economy.metal = 50;
    expect(ui.applyProductionAction('player', { type: 'build', building: 'turret', where: 'base' })).toBe('Нужно 120 металла');
    expect(ui.pendingOrders.player).toEqual([]);

    const s = new GameState();
    s.teams.player.economy.metal = 50;
    const text = s.applyAgentAction('player', { type: 'build', building: 'turret', where: 'base' });
    expect(text).toBe('В очереди: Турель — Нужно 120 металла. Выполним сами, как только хватит ресурсов (ждём до 60 с)');
    expect(s.pendingOrders.player).toMatchObject([{ what: 'turret', where: 'base', count: 1, why: 'Нужно 120 металла' }]);
    expect(s.teams.player.economy.metal).toBe(50); // nothing is paid while it waits
    expect(s.recentRefusals('player')).toEqual([]);
  });

  it('refuses at once what waiting will not fix: a level lock, a limit, no free pad', () => {
    const s = new GameState({ level: levelConfig(1) });
    s.teams.player.economy.metal = 0;
    expect(s.applyAgentAction('player', { type: 'build', building: 'turret' })).toBe('Откроется на уровне 2');
    expect(s.pendingOrders.player).toEqual([]);

    const flat = new GameState();
    flat.teams.player.economy.metal = 5000;
    flat.teams.player.economy.components = 1000;
    while (flat.canBuild('player', 'factory').ok) flat.buildStructure('player', 'factory');
    flat.teams.player.economy.metal = 0;
    expect(flat.applyAgentAction('player', { type: 'build_factory' })).toBe('Достигнут предел заводов');
    expect(flat.applyAgentAction('player', { type: 'build', building: 'depot', where: 'base' })).toBe('Нет свободной площадки'); // forward pads only
    expect(flat.pendingOrders.player).toEqual([]);
    expect(flat.recentRefusals('player').map(r => r.what)).toEqual(['factory', 'depot']);
  });

  it('dedups a repeated order, keeps at most three, and refuses a fourth with the reason', () => {
    const s = new GameState();
    const e = s.teams.enemy.economy;
    e.metal = 0;
    e.components = 0;
    s.applyAgentAction('enemy', { type: 'build', building: 'turret', where: 'base' });
    s.gameTime += 20;
    expect(s.applyAgentAction('enemy', { type: 'build', building: 'turret', where: 'base' })).toBe('Уже в очереди: Турель — Нужно 120 металла');
    expect(s.pendingOrders.enemy).toHaveLength(1);
    expect(s.orderTimeLeft(s.pendingOrders.enemy[0])).toBe(TTL); // the repeat restarts its minute

    s.applyAgentAction('enemy', { type: 'build_harvester', count: 1 });
    s.applyAgentAction('enemy', { type: 'build_harvester', count: 3 });
    expect(s.pendingOrders.enemy.find(o => o.what === 'harvester')?.count).toBe(3); // the latest order says how many
    s.applyAgentAction('enemy', { type: 'build', building: 'turret', where: 'north' }); // another place, another order
    expect(s.pendingOrders.enemy.map(o => `${o.what}:${o.where ?? ''}`)).toEqual(['turret:base', 'harvester:', 'turret:north']);

    expect(s.applyAgentAction('enemy', { type: 'build_factory' })).toBe('Не заказано: Завод — Нужно 300 металла, а очередь заказов полна (3)');
    expect(s.pendingOrders.enemy).toHaveLength(GAME_BALANCE.ORDER_QUEUE_MAX);
    expect(s.recentRefusals('enemy')).toEqual([{ what: 'factory', why: 'очередь заказов полна (3)', ago: 0 }]);
  });

  it('an order that waited a minute without resources is dropped, and the agents see why', () => {
    const s = new GameState();
    hold(s, 'enemy', 0.05);
    s.applyAgentAction('enemy', { type: 'build_factory' });
    expect(s.pendingOrders.enemy).toHaveLength(1);
    hold(s, 'enemy', TTL - 1);
    expect(s.pendingOrders.enemy).toHaveLength(1);
    hold(s, 'enemy', 1.1);
    expect(s.pendingOrders.enemy).toEqual([]);
    expect(s.recentRefusals('enemy')).toMatchObject([{ what: 'factory', why: 'ждал 60 с: Нужно 300 металла' }]);
    expect(s.recentEvents('enemy', 5).map(ev => ev.text)).toContain('Заказ снят: Завод — за 60 с так и не хватило ресурсов');
  });

  it('runs a waiting order by itself once it can be paid', () => {
    const s = new GameState();
    s.setFactoryPaused('player', null, true); // no combat production to keep metal for
    s.teams.player.economy.metal = 0;
    s.applyAgentAction('player', { type: 'build', building: 'turret', where: 'south', workers: 2 });
    hold(s, 'player', 5, TURRET.metal - 1, 500);
    expect(s.buildings.some(b => b.type === 'turret')).toBe(false);

    s.teams.player.economy.metal = TURRET.metal;
    s.update(0.05);
    const site = s.buildings.find(b => b.team === 'player' && b.type === 'turret');
    expect(site?.padId).toBe('pad_player_10'); // the place and the workers of the order are kept
    expect(site?.workersWanted).toBe(2);
    expect(s.teams.player.economy.metal).toBeLessThan(1); // paid on the spot
    expect(s.pendingOrders.player).toEqual([]);
  });

  it('pays for a waiting order only if the next combat machine stays covered', () => {
    const s = midBatch();
    const unit = unitCost(s);
    s.teams.player.economy.metal = 0;
    s.teams.player.economy.components = 1000;
    s.applyAgentAction('player', { type: 'build', building: 'turret', where: 'base' });

    s.teams.player.economy.metal = TURRET.metal + unit.metalCost - 1;
    s.update(0.05);
    expect(s.buildings.some(b => b.type === 'turret')).toBe(false);
    expect(s.pendingOrders.player[0].why).toBe('ресурсы придержаны на следующую боевую машину');
    expect(commanderUserPrompt(s, 'player')).toContain('turret (base) — ресурсы придержаны на следующую боевую машину');

    s.teams.player.economy.metal = TURRET.metal + unit.metalCost;
    s.update(0.05);
    expect(s.buildings.some(b => b.type === 'turret')).toBe(true);
    expect(s.teams.player.economy.metal).toBeGreaterThanOrEqual(unit.metalCost - 1);
  });

  it('keeps no reserve while the factories cannot assemble: paused lines or a design waiting for a laboratory', () => {
    const paused = midBatch();
    paused.setFactoryPaused('player', null, true);
    paused.teams.player.economy.metal = 0;
    paused.teams.player.economy.components = 1000; // above the reserve: the fabricator leaves the metal alone
    paused.applyAgentAction('player', { type: 'build_power_plant' });
    paused.teams.player.economy.metal = GAME_BALANCE.POWER_PLANT_COST_METAL;
    paused.update(0.05);
    expect(paused.constructionSites('player').map(b => b.type)).toEqual(['power_plant']);

    // level 6: plasma needs a laboratory, so the laboratory itself must not wait for the plasma machine's price
    const s = new GameState({ level: levelConfig(6) });
    s.teams.player.design = { ...s.teams.player.design, modules: s.teams.player.design.modules.map(m => (m === 'autocannon_20mm' ? 'plasma_blasters' : m)) };
    expect(s.lockedParts('player', unitCost(s)).length).toBeGreaterThan(0);
    const lab = PAD_BUILDINGS.lab;
    s.teams.player.economy.metal = 0;
    s.applyAgentAction('player', { type: 'build', building: 'lab', where: 'base' });
    s.teams.player.economy.metal = lab.metal;
    s.teams.player.economy.components = 1000;
    s.teams.player.economy.crystals = lab.crystals ?? 0;
    s.update(0.05);
    expect(s.constructionSites('player').map(b => b.type)).toContain('lab');
  });

  it('orders the harvesters the metal pays for now; the rest wait and come out of the queue later', () => {
    const s = new GameState();
    s.setFactoryPaused('player', null, true);
    s.teams.player.economy.metal = GAME_BALANCE.HARVESTER_COST_METAL + 10;
    const before = s.harvestersInProduction('player');
    expect(s.applyAgentAction('player', { type: 'build_harvester', count: 3 })).toMatch(/^Заказано добытчиков: 1, .*\. В очереди: Добытчик — Нужно 60 металла/);
    expect(s.harvestersInProduction('player')).toBe(before + 1);
    expect(s.pendingOrders.player).toMatchObject([{ what: 'harvester', count: 2 }]);

    s.teams.player.economy.metal = GAME_BALANCE.HARVESTER_COST_METAL + 10; // one more
    s.update(0.05);
    expect(s.pendingOrders.player).toMatchObject([{ what: 'harvester', count: 1 }]);
    s.teams.player.economy.metal = GAME_BALANCE.HARVESTER_COST_METAL;
    s.update(0.05);
    expect(s.pendingOrders.player).toEqual([]);
    expect(s.harvestersInProduction('player')).toBe(before + 3);
  });

  it('a waiting order that became impossible is dropped with the reason', () => {
    const s = new GameState();
    s.teams.enemy.economy.metal = 0;
    s.applyAgentAction('enemy', { type: 'build', building: 'radar' });
    s.placeReady('enemy', 'radar'); // the only radar slot is taken meanwhile
    s.update(0.05);
    expect(s.pendingOrders.enemy).toEqual([]);
    expect(s.recentRefusals('enemy')).toMatchObject([{ what: 'radar', why: 'Не больше 1 таких зданий' }]);
  });

  it('a waiting order can be cancelled; nothing was paid, so nothing comes back', () => {
    const s = new GameState();
    s.teams.player.economy.metal = 10;
    s.applyAgentAction('player', { type: 'build_factory' });
    const id = s.pendingOrders.player[0].id;
    expect(s.cancelPendingOrder('player', id)).toEqual({ ok: true, text: 'Заказ снят: Завод' });
    expect(s.pendingOrders.player).toEqual([]);
    expect(s.teams.player.economy.metal).toBe(10);
    expect(s.cancelPendingOrder('player', id).ok).toBe(false);
  });

  it('the agents see the queue as one short line, in Russian and in English', () => {
    const s = new GameState();
    expect(commanderUserPrompt(s, 'enemy')).not.toContain('ОЧЕРЕДЬ');
    s.teams.enemy.economy.metal = 0;
    s.applyAgentAction('enemy', { type: 'build', building: 'turret', where: 'base' });
    s.applyAgentAction('enemy', { type: 'build_harvester', count: 2 });
    s.gameTime += 12;

    const line = (text: string, start: string) => text.split('\n').find(l => l.startsWith(start)) ?? '';
    const ru = line(commanderUserPrompt(s, 'enemy'), 'ОЧЕРЕДЬ ЗАКАЗОВ');
    expect(ru).toBe('ОЧЕРЕДЬ ЗАКАЗОВ (выполнятся сами, когда хватит ресурсов, — не повторяй): turret (base) — Нужно 120 металла, ещё 48 с; harvester×2 — Нужно 60 металла, ещё 48 с');
    expect(commanderUserPrompt(s, 'enemy')).toContain('ПО КАРМАНУ СЕЙЧАС: ничего — копи металл, новый заказ подождёт в очереди');

    const en = englishPrompts({ replyLanguage: 'English', markForTranslation: false });
    expect(line(en.commanderUser(s, 'enemy'), 'ORDER QUEUE')).toBe(
      'ORDER QUEUE (runs by itself once resources allow — do not repeat): turret (base) — Нужно 120 металла, 48 s left; harvester×2 — Нужно 60 металла, 48 s left',
    );
    expect(ru.length).toBeLessThan(200); // the on-device model has a 4096-token window

    s.teams.player.economy.metal = 0;
    s.applyAgentAction('player', { type: 'build_power_plant' });
    expect(engineerUserPrompt(s, 'x', null)).toContain('ОЧЕРЕДЬ ЗАКАЗОВ (выполнятся сами, когда хватит ресурсов, — не повторяй): power_plant — Нужно 150 металла');
  });

  it('the engineer\'s confirmed order waits in the queue when the base cannot pay for it yet', async () => {
    const offline: LLMSettings = {
      provider: 'offline', apiKey: '', model: '', baseUrl: '',
      enemyUsesLLM: false, autonomousTactics: false, chargeEnemyToPlayer: false,
      autoSpeakResponse: false, matchCoinLimit: 40, soundMuted: true,
    };
    const s = new GameState();
    s.teams.player.economy.metal = 100;
    let proposal: ProductionProposal | null = null;
    const d = new AIDirector(offline, { chat() {}, proposal: p => (proposal = p), tactical() {}, intercept() {}, changed() {} });
    await d.sendEngineerOrder(s, 'Построй второй завод');
    expect((proposal as ProductionProposal | null)?.actions).toEqual([{ type: 'build_factory' }]);
    const reply = d.confirmProposal(s);
    expect(reply?.text).toContain('В очереди: Завод — Нужно 300 металла');
    expect(s.pendingOrders.player).toMatchObject([{ what: 'factory' }]);
  });
});
