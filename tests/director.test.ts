import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AIDirector } from '../src/ai/AIDirector';
import { voiceService } from '../src/ai/VoiceService';
import { COMMANDER_INSTRUCTIONS_MAX, commanderReplanPrompt, commanderReplanSystem, commanderSystem, commanderUserPrompt } from '../src/ai/prompts';
import { GAME_BALANCE, INITIAL_ENEMY_DESIGN, INITIAL_PLAYER_DESIGN } from '../src/config/balance';
import { RobotBuilder } from '../src/engine/RobotBuilder';
import { GameState } from '../src/engine/GameState';
import { DEFAULT_SETTINGS, GameController } from '../src/game/GameController';
import { LANGS, setLanguage } from '../src/i18n';
import { ChatMessage, LLMSettings, ProductionProposal } from '../src/types/agent';
import { CombatUnit } from '../src/types/game';
import { RobotDesign } from '../src/types/robot';

const offline: LLMSettings = { ...DEFAULT_SETTINGS, provider: 'offline', apiKey: '', model: '', baseUrl: '', autoSpeakResponse: false, soundMuted: true };

function director(settings: LLMSettings, chat: ChatMessage[] = []) {
  return new AIDirector(settings, { chat: m => chat.push(m), proposal() {}, tactical() {}, intercept() {}, changed() {} });
}

/** Mock OpenAI-compatible server: replies with `reply()` as the model's JSON after `delayMs`, records the prompts. */
function mockLLM(reply: () => unknown, delayMs = 0) {
  const prompts: { system: string; user: string }[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const messages = (JSON.parse(raw || '{}').messages ?? []) as { role: string; content: string }[];
      prompts.push({ system: messages.find(m => m.role === 'system')?.content ?? '', user: messages.find(m => m.role === 'user')?.content ?? '' });
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'mock', choices: [{ message: { content: JSON.stringify(reply()) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
      }, delayMs);
    });
  });
  return {
    server,
    prompts,
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

describe('economic orders of an LLM commander', () => {
  it('one the side cannot pay for yet waits in the order queue instead of being refused', async () => {
    const mock = mockLLM(() => ({ taunt: '', design: null, plan: { stance: 'advance' }, actions: [{ type: 'build', building: 'turret', where: 'base' }] }));
    const settings = { ...(await mock.start()), enemyUsesLLM: true, autonomousTactics: false };
    try {
      const s = new GameState();
      const d = director(settings);
      s.teams.enemy.economy.metal = 0;
      for (let i = 0; i < 40 && !d.lastCall.enemy; i++) {
        for (let k = 0; k < 10; k++) {
          s.gameTime += 0.1;
          d.update(s, 0.1);
        }
        await vi.waitFor(() => expect(d.busy.enemy).toBe(false));
      }
      expect(d.lastCall.enemy?.source).toBe('llm');
      expect(s.pendingOrders.enemy).toMatchObject([{ what: 'turret', where: 'base' }]);
      expect(s.recentRefusals('enemy')).toEqual([]);
    } finally {
      mock.server.close();
    }
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

describe('re-plans on battle events', () => {
  const mock = mockLLM(() => ({ reply: 'Перестраиваемся', taunt: 'Держитесь!', plan: { stance: 'defend_base', summary: 'оборона' } }), 50);
  let settings: LLMSettings;
  beforeAll(async () => {
    settings = { ...(await mock.start()), enemyUsesLLM: true, autonomousTactics: true };
  });
  afterAll(() => mock.server.close());

  /** Advances game time without simulating (events stay under the test's control). */
  const tick = (s: GameState, d: AIDirector, sec: number) => {
    for (let i = 0; i < Math.round(sec * 10); i++) {
      s.gameTime += 0.1;
      d.update(s, 0.1);
    }
  };
  const settle = (d: AIDirector) => vi.waitFor(() => expect(d.busy.enemy || d.busy.ally || d.busy.tactician).toBe(false));

  it('an attack makes the enemy commander re-plan at once, a burst goes as one quick plan-only call', async () => {
    mock.prompts.length = 0;
    const s = new GameState();
    const d = director(settings);
    s.gameTime = 2; // well before the first full report
    s.pushEvent('enemy', 'base_attack', 'Противник атакует завод!', true);
    tick(s, d, 0.5);
    s.pushEvent('enemy', 'heavy_losses', 'Тяжёлые потери: 4 машины за 20 секунд', true);
    tick(s, d, 0.3);
    expect(d.busy.enemy).toBe(false); // still gathering the burst
    tick(s, d, 0.4);
    expect(d.busy.enemy).toBe(true);
    await settle(d);

    expect(mock.prompts).toHaveLength(1);
    expect(mock.prompts[0].user).toMatch(/атакует завод[\s\S]*Тяжёлые потери|Тяжёлые потери[\s\S]*атакует завод/);
    expect(mock.prompts[0].user).not.toMatch(/КАТАЛОГ/); // short context: no catalog, no economy
    expect(s.teams.enemy.plan.stance).toBe('defend_base');
    expect(d.lastCall.enemy?.source).toBe('llm');
  });

  const isReplan = (p: { system: string }) => /быстро скорректируй план/.test(p.system);

  it('events that arrive during a call wait for it to finish, then go out at once', async () => {
    mock.prompts.length = 0;
    const s = new GameState();
    const d = director(settings);
    s.gameTime = 2;
    s.pushEvent('enemy', 'base_attack', 'Противник атакует штаб!', true);
    tick(s, d, 1.1);
    expect(d.busy.enemy).toBe(true);
    s.pushEvent('enemy', 'harvester_attacked', 'Наших добытчиков атакуют!', true);
    tick(s, d, GAME_BALANCE.AI_EVENT_REPLAN_COOLDOWN_SEC + 0.2); // the cooldown passes while the call is in flight
    await settle(d);
    expect(mock.prompts).toHaveLength(1);
    tick(s, d, 0.1);
    expect(d.busy.enemy).toBe(true);
    await settle(d);
    expect(mock.prompts).toHaveLength(2);
    expect(mock.prompts.every(isReplan)).toBe(true);
    expect(mock.prompts[1].user).toMatch(/добытчиков атакуют/);
    expect(mock.prompts[1].user).not.toMatch(/атакует штаб/); // already handled
  });

  it('re-plans of one side are at least the cooldown apart', async () => {
    mock.prompts.length = 0;
    const s = new GameState();
    const d = director(settings);
    s.gameTime = 2;
    s.pushEvent('enemy', 'base_attack', 'Противник атакует штаб!', true);
    tick(s, d, 1.1);
    expect(d.busy.enemy).toBe(true);
    await settle(d);
    s.pushEvent('enemy', 'base_attack', 'Противник атакует электростанцию!', true);
    tick(s, d, GAME_BALANCE.AI_EVENT_REPLAN_COOLDOWN_SEC - 1);
    expect(d.busy.enemy).toBe(false);
    tick(s, d, 1.2);
    expect(d.busy.enemy).toBe(true);
    await settle(d);
    expect(mock.prompts).toHaveLength(2);
    expect(mock.prompts[1].user).toMatch(/электростанцию/);
  });

  it('the player\'s tactician and the enemy commander react to events at the same pace', async () => {
    const s = new GameState();
    const d = director(settings);
    s.gameTime = 2;
    const both = () => {
      s.pushEvent('player', 'base_attack', 'Противник атакует завод!', true);
      s.pushEvent('enemy', 'base_attack', 'Противник атакует завод!', true);
    };
    both();
    tick(s, d, 0.8);
    expect([d.busy.tactician, d.busy.enemy]).toEqual([false, false]);
    tick(s, d, 0.4);
    expect([d.busy.tactician, d.busy.enemy]).toEqual([true, true]);
    await settle(d);

    both();
    tick(s, d, GAME_BALANCE.AI_EVENT_REPLAN_COOLDOWN_SEC - 1);
    expect([d.busy.tactician, d.busy.enemy]).toEqual([false, false]);
    tick(s, d, 1.2);
    expect([d.busy.tactician, d.busy.enemy]).toEqual([true, true]);
    await settle(d);
  });

  it('a due full report goes before a quick re-plan and covers its events', async () => {
    mock.prompts.length = 0;
    const s = new GameState();
    const d = director(settings);
    s.gameTime = GAME_BALANCE.AI_FIRST_ENEMY_DECISION_SEC - 0.5;
    s.pushEvent('enemy', 'base_attack', 'Противник атакует завод!', true);
    tick(s, d, 1.2); // the burst is ready and the first full report is due in the same moment
    expect(d.busy.enemy).toBe(true);
    await settle(d);
    tick(s, d, GAME_BALANCE.AI_EVENT_REPLAN_COOLDOWN_SEC + 1);
    await settle(d);
    expect(mock.prompts).toHaveLength(1);
    expect(isReplan(mock.prompts[0])).toBe(false);
    expect(mock.prompts[0].user).toMatch(/атакует завод/);
  });

  it('without the cloud, events are let go: no calls, the rule-based commander keeps its timer', () => {
    mock.prompts.length = 0;
    const s = new GameState();
    const d = director(offline);
    s.gameTime = 2;
    s.pushEvent('enemy', 'base_attack', 'Противник атакует завод!', true);
    tick(s, d, 2);
    expect(d.busy.enemy).toBe(false);
    expect(mock.prompts).toHaveLength(0);
  });
});

describe('base-defence reflex of the game AI', () => {
  /** A guard waits at the rally point; a raider sits by the base out of its aggro range. Returns how far the guard closed in. */
  function closeIn(baseUnderFire: boolean): number {
    const s = new GameState();
    s.units = s.units.filter(u => u.kind === 'harvester');
    const hq = s.getHQ('player')!;
    const rally = s.rallyPoint('player');
    s.spawnCombatBot('player', { x: rally.x, y: rally.y }, s.teams.player.design, 1);
    const guard = s.units[s.units.length - 1] as CombatUnit;
    guard.lane = 0; // its place in the formation is the rally point itself
    const spot = { x: hq.pos.x, y: hq.pos.y + 26 }; // near the base, beyond the HQ turret and the guard's aggro range
    s.spawnCombatBot('enemy', spot, s.teams.enemy.design, 1);
    const raider = s.units[s.units.length - 1] as CombatUnit;
    const factory = s.buildings.find(b => b.team === 'player' && b.type === 'factory')!;
    const gap = () => Math.hypot(guard.pos.x - raider.pos.x, guard.pos.y - raider.pos.y);
    const before = gap();
    for (let i = 0; i < 60; i++) {
      raider.pos = { ...spot }; // the raider holds its spot and does not fire on its own
      raider.cooldown = 99;
      if (baseUnderFire) factory.lastDamagedAt = s.gameTime;
      s.update(0.05);
    }
    return before - gap();
  }

  it('machines waiting near home go for a raider while the base is under fire, without any agent', () => {
    expect(closeIn(true)).toBeGreaterThan(3);
  });

  it('without fire on the base they keep to the plan', () => {
    expect(closeIn(false)).toBeLessThan(1);
  });
});

describe('custom instructions for the teal commander (AI vs AI)', () => {
  const orders = 'Играй от обороны, копи на тяжёлые машины, в рейды не ходи';

  it('go into its system prompts above the reply format, again last in each report, and are capped in length', () => {
    for (const system of [commanderSystem('player', true, orders), commanderReplanSystem('player', true, orders)]) {
      expect(system).toContain(orders);
      expect(system.indexOf(orders)).toBeLessThan(system.indexOf('Ответ — только JSON'));
    }
    // repeated right before the decision: the live model followed them far more often there
    const s = new GameState();
    for (const user of [commanderUserPrompt(s, 'player', orders), commanderReplanPrompt(s, 'player', 'Противник атакует завод!', orders)]) {
      expect(user.trimEnd().split('\n').pop()).toContain(orders);
    }
    expect(commanderUserPrompt(s, 'player')).not.toMatch(/УКАЗАНИЯ ШТАБА/);
    expect(commanderSystem('player', true)).not.toMatch(/Особые указания/);
    expect(commanderSystem('player', true, '   ')).not.toMatch(/Особые указания/);
    const long = commanderSystem('player', true, 'я'.repeat(COMMANDER_INSTRUCTIONS_MAX + 100));
    expect(long).toContain('я'.repeat(COMMANDER_INSTRUCTIONS_MAX));
    expect(long).not.toContain('я'.repeat(COMMANDER_INSTRUCTIONS_MAX + 1));
  });

  it('reach only the teal commander in a live AI-vs-AI match', async () => {
    const mock = mockLLM(() => ({ taunt: 'Вперёд', design: null, plan: { stance: 'hold_center' }, actions: [] }));
    const settings = { ...(await mock.start()), enemyUsesLLM: true };
    try {
      const s = new GameState();
      const d = director(settings);
      d.setMode('spectator');
      d.setCommanderInstructions('player', orders);
      for (let i = 0; i < 40 && !(d.lastCall.ally && d.lastCall.enemy); i++) {
        for (let k = 0; k < 10; k++) {
          s.gameTime += 0.1;
          d.update(s, 0.1);
        }
        await vi.waitFor(() => expect(d.busy.enemy || d.busy.ally).toBe(false));
      }
      const teal = mock.prompts.filter(p => p.system.startsWith('Ты — «Командор Бирюзов»'));
      const rust = mock.prompts.filter(p => p.system.startsWith('Ты — «Генерал Ржавый»'));
      expect(teal.length).toBeGreaterThan(0);
      expect(rust.length).toBeGreaterThan(0);
      expect(teal.every(p => p.system.includes(orders) && p.user.includes(orders))).toBe(true);
      expect(rust.some(p => p.system.includes(orders) || p.user.includes(orders))).toBe(false);
    } finally {
      mock.server.close();
    }
  });

  // How the teal commander's prompts open in each game language: the full report and the quick re-plan
  const TEAL_PROMPTS = {
    ru: { me: 'Ты — «Командор Бирюзов»', replan: 'В бою важное событие' },
    en: { me: 'You are "Commodore Teal"', replan: 'Something important happened in battle' },
    it: { me: 'You are "Commodoro Turchese"', replan: 'Something important happened in battle' },
  } as const;

  it.each(LANGS)('go into every LLM request of the teal side (%s): full reports and battle re-plans, also after a restart', async lang => {
    const mock = mockLLM(() => ({ taunt: '', design: null, plan: { stance: 'advance', summary: 'вперёд' }, actions: [] }));
    const settings = { ...(await mock.start()), enemyUsesLLM: true };
    setLanguage(lang);
    try {
      const ctrl = new GameController();
      ctrl.applySettings(settings, false);
      ctrl.setAllyInstructions(orders);
      ctrl.start('spectator');
      const play = async (seconds: number) => {
        for (let i = 0; i < seconds && !ctrl.state.gameOver; i++) {
          ctrl.fastForward(1, 0.1);
          await vi.waitFor(() => expect(ctrl.director.busy.enemy || ctrl.director.busy.ally).toBe(false));
        }
      };
      await play(150);
      // A battle event for the teal side guarantees a quick re-plan: under the fog of war whether
      // the teal army gets hit in the first minutes depends on the match
      ctrl.state.pushEvent('player', 'base_attack', 'Противник атакует командный центр!', true);
      await play(10);
      ctrl.restart(); // the restart button keeps the mode and the orders
      await play(60);

      const teal = mock.prompts.filter(p => p.system.startsWith(TEAL_PROMPTS[lang].me));
      const replans = teal.filter(p => p.system.includes(TEAL_PROMPTS[lang].replan));
      expect(teal.length - replans.length).toBeGreaterThanOrEqual(3); // full reports, before and after the restart
      expect(replans.length).toBeGreaterThan(0);
      expect(teal.filter(p => !p.system.includes(orders) || !p.user.includes(orders))).toEqual([]);
    } finally {
      setLanguage('ru');
      mock.server.close();
    }
  }, 60000);

  it('are set on the start screen, kept between visits and apply only to AI vs AI', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      const ctrl = new GameController();
      ctrl.setAllyInstructions(orders);
      ctrl.start('spectator');
      expect(ctrl.director.commanderInstructions.player).toBe(orders);
      ctrl.backToMenu(); // a new match in the normal mode: the teal side is the human again
      expect(ctrl.director.commanderInstructions.player).toBe('');

      const reopened = new GameController(); // the page is opened again
      expect(reopened.allyInstructions).toBe(orders);
      reopened.start('spectator');
      expect(reopened.director.commanderInstructions.player).toBe(orders);
      expect(reopened.director.commanderInstructions.enemy).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
