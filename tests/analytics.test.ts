import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMError } from '../src/ai/llm/LLMClient';
import { Analytics, AnalyticsBackend, AnalyticsEnv, Consent, ConsentPolicy } from '../src/analytics/analytics';
import { EVENTS, USER_PROPERTIES, validateEvent, validateUserProperty } from '../src/analytics/events';
import { CONSENT_POLICY, analytics } from '../src/analytics';
import { classifyLLMError, durationBucket, latencyBucket, providerKind } from '../src/analytics/matchStats';
import { GAME_BALANCE } from '../src/config/balance';
import { GameState } from '../src/engine/GameState';
import { GameController } from '../src/game/GameController';
import { LLMSettings } from '../src/types/agent';

const ON: AnalyticsEnv = { off: null, debug: false, privacySignal: false };

/** An Analytics with an in-memory consent store and a fake SDK that records what it was given. */
function setup(opts: { env?: Partial<AnalyticsEnv>; policy?: ConsentPolicy; saved?: Consent | null; backend?: 'ok' | 'unsupported' | 'blocked' } = {}) {
  const sent: { name: string; params: Record<string, unknown> }[] = [];
  const user: Record<string, unknown>[] = [];
  const collection: boolean[] = [];
  const store = { value: opts.saved ?? null, get: () => store.value, set: (v: Consent) => (store.value = v) };
  const backend: AnalyticsBackend = {
    logEvent: (name, params) => sent.push({ name, params }),
    setUserProperties: p => user.push(p),
    setCollection: on => collection.push(on),
  };
  const loader = vi.fn(async (_debug: boolean) => {
    if (opts.backend === 'blocked') throw new Error('script blocked');
    return opts.backend === 'unsupported' ? null : backend;
  });
  const clearIdentifiers = vi.fn();
  const a = new Analytics({ env: { ...ON, ...opts.env }, policy: opts.policy ?? 'opt-in', store, loader, clearIdentifiers });
  return { a, sent, user, collection, store, loader, clearIdentifiers };
}

const order = { agent: 'engineer', input: 'text' } as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('analytics switched off', () => {
  it('is off in vitest: nothing can load or send', () => {
    expect(analytics.available).toBe(false);
    expect(analytics.active).toBe(false);
  });

  for (const off of ['test', 'dev', 'ios', 'local'] as const) {
    it(`${off}: no SDK load and no event even with consent`, async () => {
      const { a, sent, loader } = setup({ env: { off }, saved: 'granted' });
      expect(a.track('agent_order', order)).toBe(true);
      a.setConsent(true);
      await a.ready();
      expect(loader).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    });
  }

  it('a build without the SDK (the iOS app) is never available', () => {
    const a = new Analytics({ env: ON, policy: 'opt-out', store: { get: () => 'granted', set: () => {} }, loader: null });
    expect(a.available).toBe(false);
    expect(a.track('agent_order', order)).toBe(true);
  });
});

describe('the opt-in policy and the settings switch', () => {
  it('loads nothing until the player turns statistics on', async () => {
    const { a, sent, loader } = setup();
    expect(a.consent).toBe('unset');
    expect(a.enabled).toBe(false);
    a.track('agent_order', order);
    await a.ready();
    expect(loader).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('after "yes" loads the SDK once, keeps the answer and sends the events', async () => {
    const { a, sent, store, loader } = setup({ env: { debug: true } });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    a.setConsent(true);
    a.track('agent_order', order);
    a.setUserProperty('highest_level', 3);
    await a.ready();
    a.track('voice_input', { result: 'final' });
    expect(store.value).toBe('granted');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith(true);
    expect(sent).toEqual([
      { name: 'agent_order', params: order },
      { name: 'voice_input', params: { result: 'final' } },
    ]);
  });

  it('a saved "yes" loads the SDK on start', async () => {
    const { a, loader } = setup({ saved: 'granted' });
    await a.ready();
    expect(a.active).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('"no" stops collection, drops the identifiers and sends nothing more', async () => {
    const { a, sent, store, collection, clearIdentifiers } = setup({ saved: 'granted' });
    await a.ready();
    a.setConsent(false);
    a.track('agent_order', order);
    expect(store.value).toBe('denied');
    expect(collection).toEqual([false]);
    expect(clearIdentifiers).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
    // and back on
    a.setConsent(true);
    a.track('agent_order', order);
    expect(collection).toEqual([false, true]);
    expect(sent).toHaveLength(1);
  });

  it('an opt-out while the SDK is loading wins: the queue is dropped and collection is off', async () => {
    const { a, sent, collection } = setup();
    a.setConsent(true);
    a.track('agent_order', order);
    a.setConsent(false);
    await a.ready();
    expect(sent).toEqual([]);
    expect(collection).toEqual([false]);
  });

  for (const backend of ['unsupported', 'blocked'] as const) {
    it(`an SDK that is ${backend} turns analytics off for the session`, async () => {
      const { a, sent } = setup({ saved: 'granted', backend });
      a.track('agent_order', order);
      await a.ready();
      expect(a.available).toBe(false);
      expect(a.active).toBe(false);
      a.track('agent_order', order);
      expect(sent).toEqual([]);
    });
  }

  it('keeps at most 50 events while the SDK loads', async () => {
    const { a, sent } = setup();
    a.setConsent(true);
    for (let i = 0; i < 80; i++) a.track('design_trial', { cached: false });
    await a.ready();
    expect(sent).toHaveLength(50);
  });
});

describe('the opt-out policy', () => {
  it('the game ships opt-out', () => {
    expect(CONSENT_POLICY).toBe('opt-out');
  });

  it('collects from the start without asking', async () => {
    const { a, sent, loader } = setup({ policy: 'opt-out' });
    expect(a.consent).toBe('unset');
    expect(a.enabled).toBe(true);
    a.track('agent_order', order);
    await a.ready();
    expect(loader).toHaveBeenCalledWith(false);
    expect(sent).toHaveLength(1);
  });

  it('the settings switch turns it off and drops the identifiers', async () => {
    const { a, sent, collection, clearIdentifiers, store } = setup({ policy: 'opt-out' });
    await a.ready();
    a.setConsent(false);
    a.track('agent_order', order);
    expect(store.value).toBe('denied');
    expect(a.enabled).toBe(false);
    expect(collection).toEqual([false]);
    expect(clearIdentifiers).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
  });

  it('stays off under Do Not Track or Global Privacy Control until an explicit "yes"', async () => {
    const { a, sent, loader } = setup({ policy: 'opt-out', env: { privacySignal: true } });
    a.track('agent_order', order);
    await a.ready();
    expect(a.active).toBe(false);
    expect(loader).not.toHaveBeenCalled();
    a.setConsent(true);
    a.track('agent_order', order);
    await a.ready();
    expect(sent).toHaveLength(1);
  });

  it('an explicit "yes" under opt-out changes nothing', async () => {
    const { a, collection, loader, store } = setup({ policy: 'opt-out' });
    await a.ready();
    a.setConsent(true);
    expect(store.value).toBe('granted');
    expect(collection).toEqual([]);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe('parameters that are not allowed are rejected', () => {
  const bad: [string, string, Record<string, unknown>][] = [
    ['an unknown event', 'chat_message', { text: 'hello' }],
    ['free text in an enum parameter', 'agent_order', { agent: 'engineer', input: 'Построй три турели' }],
    ['an extra parameter with the order text', 'agent_order', { ...order, order: 'build turrets' }],
    ['a model name', 'llm_test', { provider: 'qwen/qwen3-30b-a3b-instruct-2507', provider_kind: 'cloud', result: 'ok' }],
    ['a base URL', 'llm_test', { provider: 'custom', provider_kind: 'http://10.0.0.5:8000/v1', result: 'ok' }],
    ['an error message', 'llm_test', { provider: 'groq', provider_kind: 'cloud', result: 'HTTP 401: invalid key sk-123' }],
    ['a missing parameter', 'match_end', { outcome: 'won' }],
    ['a fractional count', 'campaign_progress', { level: 2.5, unlocked: 3 }],
    ['a negative count', 'design_trial', { cached: -1 }],
    ['a level out of range', 'level_pick', { level: 0, unlocked: 1 }],
    ['a boolean as a string', 'language_change', { lang: 'en', in_match: 'true' }],
    ['a number as a string', 'level_pick', { level: '3', unlocked: 3 }],
    ['an object', 'voice_input', { result: { text: 'secret' } }],
    ['a share over 100', 'llm_match', { fallback_pct: 120 }],
  ];
  for (const [what, name, params] of bad) {
    it(what, () => {
      const v = validateEvent(name, params);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).not.toMatch(/турели|turrets|sk-123|10\.0\.0\.5|qwen|secret/);
      const { a, sent } = setup({ saved: 'granted' });
      expect(a.track(name as 'agent_order', params as never)).toBe(false);
      expect(sent).toEqual([]);
    });
  }

  it('optional parameters may be left out', () => {
    expect(validateEvent('plan_change', { field: 'revert' }).ok).toBe(true);
    expect(validateEvent('plan_change', { field: 'stance', stance: 'advance', range: undefined }).ok).toBe(true);
    expect(validateEvent('plan_change', { field: 'stance', stance: 'charge!' }).ok).toBe(false);
  });

  it('user properties: only the known ones, never a user id', () => {
    expect(validateUserProperty('highest_level', 4).ok).toBe(true);
    expect(validateUserProperty('user_id', 'abc').ok).toBe(false);
    expect(validateUserProperty('highest_level', 'four').ok).toBe(false);
  });
});

describe('the event schema fits GA4', () => {
  const RESERVED_EVENTS = ['ad_activeview', 'ad_click', 'ad_exposure', 'ad_impression', 'ad_query', 'adunit_exposure', 'app_clear_data', 'app_install', 'app_update', 'app_remove', 'error', 'first_open', 'first_visit', 'in_app_purchase', 'notification_dismiss', 'notification_foreground', 'notification_open', 'notification_receive', 'os_update', 'screen_view', 'session_start', 'user_engagement'];
  const SNAKE = /^[a-z][a-z0-9_]*$/;

  it('names, parameter counts and value lengths are within the limits', () => {
    for (const [name, params] of Object.entries(EVENTS)) {
      expect(name).toMatch(SNAKE);
      expect(name.length).toBeLessThanOrEqual(40);
      expect(RESERVED_EVENTS).not.toContain(name);
      expect(name).not.toMatch(/^(firebase_|google_|ga_)/);
      // 25 per event, debug_mode added in debug runs included
      expect(Object.keys(params).length + 1).toBeLessThanOrEqual(25);
      for (const [key, spec] of Object.entries(params as Record<string, { kind: string; values?: readonly string[] }>)) {
        expect(key).toMatch(SNAKE);
        expect(key.length).toBeLessThanOrEqual(40);
        expect(key).not.toMatch(/^(firebase_|google_|ga_)/);
        for (const v of spec.values ?? []) expect(v.length).toBeLessThan(100);
      }
    }
    for (const key of Object.keys(USER_PROPERTIES)) expect(key.length).toBeLessThanOrEqual(24);
  });
});

describe('aggregates and kinds', () => {
  it('the provider goes out as a kind', () => {
    expect(providerKind({ provider: 'offline', baseUrl: '' })).toBe('none');
    expect(providerKind({ provider: 'device', baseUrl: '' })).toBe('device');
    expect(providerKind({ provider: 'proxy', baseUrl: '/api/llm' })).toBe('proxy');
    expect(providerKind({ provider: 'custom', baseUrl: 'http://127.0.0.1:8000/v1' })).toBe('local');
    expect(providerKind({ provider: 'custom', baseUrl: 'http://192.168.1.20:1234/v1' })).toBe('local');
    expect(providerKind({ provider: 'custom', baseUrl: 'https://my-llm.example.com/v1' })).toBe('cloud');
    expect(providerKind({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' })).toBe('cloud');
  });

  it('LLM errors become kinds, never their messages', () => {
    expect(classifyLLMError(new LLMError('http', 'bad key sk-1', 401))).toBe('auth');
    expect(classifyLLMError(new LLMError('http', '', 429))).toBe('rate_limit');
    expect(classifyLLMError(new LLMError('http', '', 503))).toBe('server');
    expect(classifyLLMError(new LLMError('http', '', 400))).toBe('http');
    expect(classifyLLMError(new LLMError('timeout', ''))).toBe('timeout');
    expect(classifyLLMError(new LLMError('parse', ''))).toBe('parse');
    expect(classifyLLMError(new LLMError('aborted', ''))).toBe('network');
    expect(classifyLLMError(new Error('boom'))).toBe('network');
  });

  it('durations and latencies are bucketed', () => {
    expect([59, 150, 400, 700, 1000, 1500, 2400].map(durationBucket)).toEqual(['0-2m', '2-5m', '5-10m', '10-15m', '15-20m', '20-30m', '30m+']);
    expect([null, 400, 2500, 9000, 12000, 45000].map(latencyBucket)).toEqual(['none', '0-1s', '1-3s', '3-10s', '10-30s', '30s+']);
  });

  it('counts the agents\' queued and refused economic orders of a match', () => {
    const s = new GameState();
    s.teams.player.economy.metal = 0;
    s.applyAgentAction('player', { type: 'build_power_plant' });
    s.applyProductionAction('player', { type: 'build_power_plant' }); // a button press is not an agent order
    expect(s.agentOrderTally.player).toEqual({ orders: 1, queued: 1, refused: 0 });
    for (let t = 0; t <= GAME_BALANCE.ORDER_QUEUE_TTL_SEC + 1; t += 0.5) {
      s.teams.player.economy.metal = 0;
      s.update(0.5);
    }
    expect(s.agentOrderTally.player).toEqual({ orders: 1, queued: 1, refused: 1 });
  });
});

describe('the game sends counts and enums only', () => {
  const offline: LLMSettings = {
    provider: 'offline', apiKey: '', model: '', baseUrl: '',
    enemyUsesLLM: true, autonomousTactics: true, chargeEnemyToPlayer: false,
    autoSpeakResponse: false, matchCoinLimit: 40, soundMuted: true,
  };

  function tracked() {
    vi.spyOn(analytics, 'active', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in tests'))));
    return vi.spyOn(analytics, 'track');
  }

  it('a match from start to restart, menu and victory: valid events, no chat or order text', async () => {
    const track = tracked();
    const ctrl = new GameController();
    ctrl.applySettings(offline, false);
    ctrl.start('human');
    await ctrl.sendOrder('Построй турель SECRET-ORDER у штаба', 'engineer');
    if (ctrl.proposal) ctrl.confirmProposal();
    await ctrl.sendOrder('Все в атаку SECRET-TACTIC', 'tactician', 'quick');
    ctrl.setManualPlan({ stance: 'defend_base' });
    ctrl.setManualPlan({ retreatHpThreshold: 20 });
    ctrl.setManualPlan({ retreatHpThreshold: 25 }); // a dragged slider: one event
    ctrl.fastForward(30);
    ctrl.restart();
    ctrl.backToMenu();
    ctrl.start('human');
    ctrl.state.gameOver = 'player_won';
    ctrl.fastForward(0.1);

    const names = track.mock.calls.map(c => c[0]);
    expect(names).toEqual([
      'match_start',
      'agent_order',
      'proposal_decision',
      'design_change',
      'agent_order',
      'plan_change',
      'plan_change',
      'match_end',
      'match_start',
      'match_end',
      'match_start',
      'match_end',
      'campaign_progress',
    ]);
    expect(track.mock.results.every(r => r.value === true)).toBe(true);
    const ends = track.mock.calls.filter(c => c[0] === 'match_end').map(c => (c[1] as { outcome: string }).outcome);
    expect(ends).toEqual(['restart', 'quit', 'won']);
    expect(track.mock.calls.find(c => c[0] === 'agent_order' && (c[1] as { agent: string }).agent === 'tactician')?.[1]).toEqual({ agent: 'tactician', input: 'quick' });
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/SECRET|Построй|атаку/);
  });

  it('LLM use goes out once at the match end, as counts and kinds', async () => {
    const track = tracked();
    const ctrl = new GameController();
    // a key but no coins left for the match: the engineer falls back without a network call
    ctrl.applySettings({ ...offline, provider: 'openrouter', apiKey: 'sk-SECRET', model: 'qwen/qwen3-30b-a3b-instruct-2507', baseUrl: 'https://openrouter.ai/api/v1', matchCoinLimit: 0 }, false);
    ctrl.start('human');
    await ctrl.sendOrder('Больше брони', 'engineer');
    ctrl.restart();
    const llm = track.mock.calls.filter(c => c[0] === 'llm_match');
    expect(llm).toHaveLength(1);
    expect(llm[0][1]).toMatchObject({ provider: 'openrouter', provider_kind: 'cloud', calls: 0, errors: 1, err_no_coins: 1, fallback_pct: 100, latency: 'none' });
    expect(track.mock.results.every(r => r.value === true)).toBe(true);
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('openrouter'), expect.anything());
    // the next match starts with clean counters
    ctrl.restart();
    expect(track.mock.calls.filter(c => c[0] === 'llm_match')).toHaveLength(1);
  });

  it('a cloud provider goes out as its id and kind, never the key, model or URL', () => {
    const track = tracked();
    const ctrl = new GameController();
    ctrl.applySettings({ ...offline, provider: 'custom', apiKey: 'sk-SECRET-KEY', model: 'my-private-model', baseUrl: 'https://llm.example.com/v1' }, false);
    ctrl.start('spectator');
    ctrl.restart();
    const start = track.mock.calls.find(c => c[0] === 'match_start')?.[1];
    expect(start).toMatchObject({ mode: 'spectator', provider: 'custom', provider_kind: 'cloud', llm_ready: true });
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/SECRET|my-private-model|example\.com/);
  });

  it('with analytics off the game follows no match', () => {
    const track = vi.spyOn(analytics, 'track');
    const ctrl = new GameController();
    ctrl.applySettings(offline, false);
    ctrl.start('human');
    ctrl.restart();
    expect(track.mock.calls.map(c => c[0])).not.toContain('match_start');
    expect(track.mock.calls.map(c => c[0])).not.toContain('match_end');
  });
});
