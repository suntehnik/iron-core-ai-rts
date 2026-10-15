import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AIDirector } from '../src/ai/AIDirector';
import { voiceService } from '../src/ai/VoiceService';
import { GAME_BALANCE, INITIAL_ENEMY_DESIGN, INITIAL_PLAYER_DESIGN } from '../src/config/balance';
import { RobotBuilder } from '../src/engine/RobotBuilder';
import { GameState } from '../src/engine/GameState';
import { DEFAULT_SETTINGS, GameController } from '../src/game/GameController';
import { ChatMessage, LLMSettings, ProductionProposal } from '../src/types/agent';
import { RobotDesign } from '../src/types/robot';

const offline: LLMSettings = { ...DEFAULT_SETTINGS, provider: 'offline', apiKey: '', model: '', baseUrl: '', autoSpeakResponse: false, soundMuted: true };

function director(settings: LLMSettings, chat: ChatMessage[] = []) {
  return new AIDirector(settings, { chat: m => chat.push(m), proposal() {}, tactical() {}, intercept() {}, changed() {} });
}

/** Mock OpenAI-compatible server: replies with `reply()` as the model's JSON after `delayMs`. */
function mockLLM(reply: () => unknown, delayMs = 0) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () =>
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'mock', choices: [{ message: { content: JSON.stringify(reply()) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
      }, delayMs),
    );
  });
  return {
    server,
    async start(): Promise<LLMSettings> {
      await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      return { ...offline, provider: 'custom', model: 'mock', baseUrl };
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('player orders the agent cannot take right now', () => {
  it('get an answer instead of vanishing, and the cooldown runs in real time, not paused game time', async () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const chat: ChatMessage[] = [];
    const d = director(offline, chat);
    const state = new GameState();
    state.isPaused = true; // game time stands still

    const first = await d.sendEngineerOrder(state, 'Построй электростанцию');
    expect(first?.role).toBe('engineer');

    const second = await d.sendEngineerOrder(state, 'И ещё один добытчик');
    expect(second?.role).toBe('engineer');
    expect(second?.text).toMatch(/Не так быстро/);
    expect(chat[chat.length - 1]).toBe(second);

    now += (GAME_BALANCE.AI_PLAYER_ORDER_COOLDOWN_SEC + 0.1) * 1000; // still paused
    const third = await d.sendEngineerOrder(state, 'Добавь добытчика');
    expect(third?.text).not.toMatch(/Не так быстро/);

    const tactic = await d.sendTacticalOrder(state, 'Держите центр');
    expect(tactic?.role).toBe('tactician');
    expect((await d.sendTacticalOrder(state, 'Обороняйте базу'))?.text).toMatch(/Не так быстро/);
  });
});

describe('enemy commander design updates', () => {
  // The model re-sends the serial design with its parts in another order
  const mock = mockLLM(() => ({
    taunt: 'Ржавчина не спит',
    design: { name: 'Ржавый Шакал Mk-I', chassis: 'light_biped', modules: [...INITIAL_ENEMY_DESIGN.modules].reverse(), role: 'frontline' },
    plan: { stance: 'advance' },
    actions: [],
  }));
  let settings: LLMSettings;
  beforeAll(async () => {
    settings = await mock.start();
  });
  afterAll(() => mock.server.close());

  it('reordered parts are the same design: no redesign, no "new enemy model" event', async () => {
    const state = new GameState();
    const d = director({ ...settings, enemyUsesLLM: true });
    const idBefore = state.teams.enemy.design.id;
    while (state.gameTime < GAME_BALANCE.AI_FIRST_ENEMY_DECISION_SEC + 1) {
      state.update(0.1);
      d.update(state, 0.1);
    }
    await vi.waitFor(() => expect(d.lastCall.enemy?.source).toBe('llm'));
    expect(state.teams.enemy.design.id).toBe(idBefore);
    expect(state.events.some(e => e.team === 'enemy' && e.type === 'design_changed')).toBe(false);
  });

  it('sightings recognise a re-issued design with a new id and reordered parts', () => {
    const s = new GameState();
    const near = { x: 30, y: 30 };
    s.spawnCombatBot('player', near, s.teams.player.design, 1);
    s.spawnCombatBot('enemy', { x: 34, y: 30 }, INITIAL_ENEMY_DESIGN, 1);
    s.update(0.05); // first sighting
    const counter = s.significantCounter.player;
    const reissued: RobotDesign = { ...INITIAL_ENEMY_DESIGN, id: 'enemy_reissued', modules: [...INITIAL_ENEMY_DESIGN.modules].reverse() };
    s.spawnCombatBot('enemy', { x: 34, y: 33 }, reissued, 2);
    for (let i = 0; i < 30; i++) s.update(0.05);
    expect(s.significantCounter.player).toBe(counter);
    expect(s.events.filter(e => e.team === 'player' && e.type === 'enemy_new_design')).toHaveLength(1);
  });
});

describe('GameController', () => {
  const benchDesign: RobotDesign = { ...INITIAL_PLAYER_DESIGN, id: 'bastion', name: 'Бастион', chassisId: 'medium_tracked', modules: ['reinforced_steel', 'autocannon_20mm', 'autocannon_20mm'] };
  const proposal = (ctrl: GameController): ProductionProposal => {
    const prevDesign = ctrl.state.teams.player.design;
    return {
      id: 'prop-1', order: 'test', replyRu: '', design: benchDesign, stats: RobotBuilder.calculateStats(benchDesign),
      prevDesign, prevStats: RobotBuilder.calculateStats(prevDesign), actions: [], warnings: [], source: 'fallback', repaired: false,
    };
  };

  it('a repeated bench run compares with the current serial model, not the one cached earlier', () => {
    const ctrl = new GameController();
    ctrl.applySettings(offline, false);
    ctrl.proposal = proposal(ctrl);
    ctrl.startTrial();
    ctrl.fastForward(GAME_BALANCE.TRIAL_BENCH_SEC + 1);
    expect(ctrl.trial?.status).toBe('done');

    const newSerial: RobotDesign = { ...INITIAL_PLAYER_DESIGN, id: 'lancer', chassisId: 'medium_tracked', modules: ['light_composite', 'plasma_blasters'] };
    ctrl.state.setDesign('player', newSerial);
    ctrl.startTrial();
    expect(ctrl.trial!.report.serial?.design.id).toBe(newSerial.id);
  });

  it('voices the reply to this order, not whatever is last in the chat', async () => {
    const speak = vi.spyOn(voiceService, 'speak').mockReturnValue(true);
    const mock = mockLLM(() => ({ reply: 'Принято', design: null, actions: [{ type: 'build_power_plant' }] }), 150);
    const settings = await mock.start();
    try {
      const ctrl = new GameController();
      ctrl.applySettings({ ...settings, autoSpeakResponse: true }, false);

      // nothing to confirm: the previous message must not be read out again
      ctrl.confirmProposal();
      expect(speak).not.toHaveBeenCalled();

      // the match restarts while the engineer is thinking: the stale reply is dropped, and the
      // restart notice that is now last in the chat is not read out as if it were the answer
      const pending = ctrl.sendOrder('Построй электростанцию', 'engineer');
      ctrl.restart('human');
      await pending;
      expect(speak).not.toHaveBeenCalled();

      await ctrl.sendOrder('Построй электростанцию', 'engineer');
      expect(speak).toHaveBeenCalledTimes(1);
      expect(speak.mock.calls[0][0]).toMatch(/Принято/);
    } finally {
      mock.server.close();
    }
  });
});
