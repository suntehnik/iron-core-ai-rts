import { AIDirector, GameMode } from '../ai/AIDirector';
import { COMMANDERS } from '../config/commanders';
import { VoiceService, voiceService } from '../ai/VoiceService';
import { LLM_PROVIDERS, LLMProviderId } from '../config/llmProviders';
import { AI_WALLET } from '../config/tariffs';
import { GAME_BALANCE } from '../config/balance';
import { TrialReport, pickTrialOpponent, runDesignTrial, trialKey, trialVerdict } from '../engine/DesignTrial';
import { GameState, SoundSink } from '../engine/GameState';
import { sounds } from '../engine/SoundEffects';
import { SceneManager } from '../rendering/SceneManager';
import { AgentId, ChatMessage, LLMSettings, ProductionProposal, TacticalDecision } from '../types/agent';
import { ProductionAction, TacticalPlan, Team } from '../types/game';

const SETTINGS_KEY = 'ironcore_settings_v2';

export const DEFAULT_SETTINGS: LLMSettings = {
  provider: 'openrouter',
  apiKey: '',
  model: LLM_PROVIDERS.openrouter.defaultModel,
  baseUrl: LLM_PROVIDERS.openrouter.baseUrl,
  enemyUsesLLM: true,
  autonomousTactics: true,
  chargeEnemyToPlayer: false,
  autoSpeakResponse: true,
  matchCoinLimit: AI_WALLET.DEFAULT_MATCH_LIMIT,
  soundMuted: false,
};

export interface Intercept {
  id: number;
  text: string;
  time: number;
  source: 'llm' | 'fallback';
  team: Team;
}

export const TIME_SCALES = [1, 2, 4] as const;

/** Design test bench run for the pending proposal (brief §9). */
export interface TrialState {
  proposalId: string;
  status: 'running' | 'done';
  startedAt: number; // game time
  readyAt: number; // game time
  report: TrialReport;
}

const TRIAL_COMMAND = /^(испыта|протестир|тест|на стенд|проверь в бою)/i;

export interface ProxyStatus {
  configured: boolean;
  model: string;
  host: string;
}

function loadSettings(): LLMSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Glue between the simulation, the AI agents, the renderer and the React UI.
 * The game loop runs every animation frame; the UI is notified at ~8 Hz.
 */
export class GameController {
  public state = new GameState();
  public director: AIDirector;
  public settings: LLMSettings;
  public chat: ChatMessage[] = [];
  public proposal: ProductionProposal | null = null;
  public lastTactical: TacticalDecision | null = null;
  public intercepts: Intercept[] = [];
  public notices: { id: number; text: string; time: number; tone: 'warn' | 'info' }[] = [];
  public started = false;
  public voice = { listening: false, transcript: '', speaking: false, supported: voiceService.isSupported(), error: '' };
  public activeAgent: AgentId = 'engineer';
  public proxyStatus: ProxyStatus | null = null;
  public fps = 0;
  public trial: TrialState | null = null;
  public mode: GameMode = 'human';
  public timeScale = 1;
  private trialCache = new Map<string, TrialReport>();

  private scene: SceneManager | null = null;
  private raf = 0;
  private lastFrame = 0;
  private uiTimer = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private nextId = 1;
  private shotBudget = 0;
  private fpsAcc = { frames: 0, time: 0 };

  constructor() {
    this.settings = loadSettings() ?? { ...DEFAULT_SETTINGS };
    this.director = new AIDirector(this.settings, {
      chat: m => this.pushChat(m),
      proposal: p => {
        this.proposal = p;
        if (!p || this.trial?.proposalId !== p.id) this.trial = null;
        this.bump();
      },
      tactical: d => {
        this.lastTactical = d;
        this.bump();
      },
      intercept: (text, source, team) => {
        this.intercepts.unshift({ id: this.nextId++, text, time: this.state.gameTime, source, team });
        this.intercepts = this.intercepts.slice(0, 10);
        const label = this.mode === 'spectator' ? COMMANDERS[team].name : 'Перехват';
        this.state.pushEvent('player', 'intercept', `${label}: «${text}»`, false);
        this.bump();
      },
      changed: () => this.bump(),
    });
    this.director.billing.onWarning = text => this.notify(text, 'warn');
    this.attachSound();
    sounds.setMuted(this.settings.soundMuted);
    this.pushChat({
      id: 'hello',
      role: 'engineer',
      text: 'База развёрнута, командир! Первая партия «Вектор Mk-I» уже на конвейере. Голосом или текстом говорите, что поменять в конструкции, — а тактику армии обсуждайте с Коброй.',
      timestamp: Date.now(),
      source: 'local',
    });
    void this.detectProxy();
  }

  // ───────────────────────────── Subscription (useSyncExternalStore) ─────────────────────────────

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  private bump() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ───────────────────────────── Lifecycle ─────────────────────────────

  attachScene(container: HTMLElement) {
    this.scene?.dispose();
    this.scene = new SceneManager(container);
    this.lastFrame = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  detachScene() {
    cancelAnimationFrame(this.raf);
    this.scene?.dispose();
    this.scene = null;
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.shotBudget = Math.min(6, this.shotBudget + dt * 14);
    if (this.started) {
      // Time scale (AI-vs-AI spectating): sub-steps of ≤0.1 s keep the simulation stable
      let remaining = dt * this.timeScale;
      while (remaining > 1e-6) {
        const step = Math.min(0.1, remaining);
        this.state.update(step);
        this.director.update(this.state, step);
        this.updateTrial();
        remaining -= step;
      }
    }
    this.scene?.render(this.state, dt);

    this.fpsAcc.frames++;
    this.fpsAcc.time += dt;
    if (this.fpsAcc.time >= 1) {
      this.fps = Math.round(this.fpsAcc.frames / this.fpsAcc.time);
      this.fpsAcc = { frames: 0, time: 0 };
    }
    this.uiTimer += dt;
    if (this.uiTimer >= 0.12) {
      this.uiTimer = 0;
      this.bump();
    }
  };

  /** 'human' — the player commands; 'spectator' — AI vs AI, two LLM commanders, the human only watches. */
  start(mode: GameMode = 'human') {
    this.setMode(mode);
    this.started = true;
    this.state.isPaused = false;
    if (mode === 'spectator') this.scene?.overview();
    sounds.playClick();
    this.bump();
  }

  private setMode(mode: GameMode) {
    this.mode = mode;
    this.director.setMode(mode);
    this.timeScale = 1;
    if (mode === 'spectator') this.activeAgent = 'engineer';
  }

  setTimeScale(scale: number) {
    this.timeScale = TIME_SCALES.includes(scale as (typeof TIME_SCALES)[number]) ? scale : 1;
    this.bump();
  }

  /** Back to the start screen with a fresh match. */
  backToMenu() {
    this.restart('human');
    this.started = false;
    this.bump();
  }

  togglePause() {
    this.state.isPaused = !this.state.isPaused;
    this.bump();
  }

  restart(mode: GameMode = this.mode) {
    this.state = new GameState();
    this.attachSound();
    this.director.resetMatch();
    this.setMode(mode);
    this.scene?.reset();
    if (mode === 'spectator') this.scene?.overview();
    this.chat = [];
    this.proposal = null;
    this.trial = null;
    this.lastTactical = null;
    this.intercepts = [];
    this.notices = [];
    if (mode === 'human') {
      this.pushChat({ id: `restart_${Date.now()}`, role: 'engineer', text: 'Матч перезапущен. Конвейеры чисты, жду приказов!', timestamp: Date.now(), source: 'local' });
    }
    this.started = true;
    this.bump();
  }

  /** Dev/test helper: advance the simulation synchronously (the loop may be throttled in hidden tabs). */
  fastForward(seconds: number, dt = 1 / 30) {
    for (let t = 0; t < seconds && !this.state.gameOver; t += dt) {
      this.state.update(dt);
      this.director.update(this.state, dt);
      this.updateTrial();
    }
    this.scene?.render(this.state, dt);
    this.bump();
  }

  focusCamera(x: number, y: number) {
    this.scene?.focus(x, y);
  }

  viewportCorners() {
    return this.scene?.viewportCorners() ?? [];
  }

  private attachSound() {
    const sink: SoundSink = {
      shot: kind => {
        if (this.shotBudget < 1) return;
        this.shotBudget -= 1;
        if (kind === 'explosive' || kind === 'turret') sounds.playCannon();
        else sounds.playLaser();
      },
      explosion: () => sounds.playExplosion(),
      batchReady: team => {
        if (team === 'player') sounds.playBatchReady();
      },
    };
    this.state.sound = sink;
  }

  // ───────────────────────────── Settings ─────────────────────────────

  private async detectProxy() {
    try {
      const res = await fetch('/api/llm/status');
      if (!res.ok) return;
      const status = (await res.json()) as ProxyStatus;
      this.proxyStatus = status;
      // First launch with a server-side key configured: use it by default
      if (status.configured && !loadSettings()) {
        this.applySettings({ ...this.settings, provider: 'proxy', baseUrl: '/api/llm', model: status.model, apiKey: '' }, false);
      }
      this.bump();
    } catch {
      /* static hosting without the dev proxy */
    }
  }

  applySettings(s: LLMSettings, persist = true) {
    this.settings = s;
    this.director.updateSettings(s);
    sounds.setMuted(s.soundMuted);
    if (persist) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
      } catch {
        /* ignore */
      }
    }
    this.bump();
  }

  presetFor(provider: LLMProviderId): Pick<LLMSettings, 'baseUrl' | 'model'> {
    const p = LLM_PROVIDERS[provider];
    if (provider === 'proxy') return { baseUrl: '/api/llm', model: this.proxyStatus?.model ?? '' };
    return { baseUrl: p.baseUrl, model: p.defaultModel };
  }

  toggleMute() {
    this.applySettings({ ...this.settings, soundMuted: !this.settings.soundMuted });
  }

  // ───────────────────────────── Agents ─────────────────────────────

  setActiveAgent(a: AgentId) {
    this.activeAgent = a;
    this.bump();
  }

  async sendOrder(text: string, agent: AgentId = this.activeAgent) {
    const t = text.trim();
    if (!t) return;
    sounds.playClick();
    this.pushChat({ id: `cmd_${this.nextId++}`, role: 'commander', to: agent, text: t, timestamp: Date.now(), source: 'local' });
    // "испытай" for a pending design runs the bench locally — no inference needed
    if (agent === 'engineer' && this.proposal?.design && TRIAL_COMMAND.test(t)) {
      this.startTrial();
      return;
    }
    if (agent === 'engineer') await this.director.sendEngineerOrder(this.state, t);
    else await this.director.sendTacticalOrder(this.state, t);
    const last = this.chat[this.chat.length - 1];
    if (last && last.role !== 'commander' && last.role !== 'system') this.speak(last.text);
  }

  confirmProposal() {
    sounds.playClick();
    this.director.confirmProposal(this.state);
    const last = this.chat[this.chat.length - 1];
    if (last) this.speak(last.text);
  }

  cancelProposal() {
    sounds.playClick();
    this.director.cancelProposal();
  }

  // ───────────────────────────── Design test bench ─────────────────────────────

  /**
   * Tests the pending design against the enemy model our scouts know. Free in AI coins
   * (a game simulation, not inference); costs TRIAL_BENCH_SEC of game time before the verdict.
   */
  startTrial() {
    const p = this.proposal;
    if (!p?.design) return;
    if (this.trial?.proposalId === p.id && this.trial.status === 'running') return;
    sounds.playClick();
    const plan = this.state.teams.player.plan;
    const opponent = pickTrialOpponent(this.state);
    const key = trialKey(p.design, opponent.design, plan);
    const cached = this.trialCache.get(key);
    const report =
      cached ??
      runDesignTrial(p.design, opponent.design, opponent.source, {
        count: GAME_BALANCE.TRIAL_SQUAD_SIZE,
        plan,
        serial: this.state.teams.player.design,
      });
    this.trialCache.set(key, report);
    // A repeated bench run for the same pair gives no new information, so it is instant
    const delay = cached ? 0 : GAME_BALANCE.TRIAL_BENCH_SEC;
    this.trial = { proposalId: p.id, status: 'running', startedAt: this.state.gameTime, readyAt: this.state.gameTime + delay, report };
    if (!delay) this.updateTrial();
    this.bump();
  }

  private updateTrial() {
    const t = this.trial;
    if (!t || t.status !== 'running' || this.state.gameTime < t.readyAt) return;
    t.status = 'done';
    const text = trialVerdict(t.report);
    this.pushChat({ id: `trial_${this.nextId++}`, role: 'engineer', text, timestamp: Date.now(), source: 'local' });
    this.speak(text);
  }

  revertTactical() {
    sounds.playClick();
    this.director.revertTactical(this.state);
    this.lastTactical = null;
  }

  setManualPlan(patch: Partial<TacticalPlan>) {
    sounds.playClick();
    this.director.setManualPlan(this.state, patch);
  }

  economyAction(action: ProductionAction) {
    sounds.playClick();
    const text = this.state.applyProductionAction('player', action);
    this.notify(text, 'info');
  }

  toggleFactory(id: string) {
    sounds.playClick();
    const f = this.state.buildings.find(b => b.id === id && b.team === 'player' && b.type === 'factory');
    if (!f) return;
    this.state.setFactoryPaused('player', id, !f.paused);
    this.notify(f.paused ? 'Завод остановлен: металл копится, энергия свободна' : 'Завод снова в работе', 'info');
  }

  topUpTestBalance() {
    this.director.billing.topUpTestBalance();
    this.notify('Тестовый баланс пополнен', 'info');
  }

  private pushChat(m: ChatMessage) {
    this.chat = [...this.chat, m].slice(-60);
    this.bump();
  }

  notify(text: string, tone: 'warn' | 'info') {
    this.notices.unshift({ id: this.nextId++, text, time: performance.now(), tone });
    this.notices = this.notices.slice(0, 4);
    this.bump();
  }

  // ───────────────────────────── Voice (ASR / TTS billed separately) ─────────────────────────────

  toggleListening() {
    if (this.voice.listening) {
      voiceService.stopListening();
      this.voice.listening = false;
      this.bump();
      return;
    }
    if (!voiceService.isSupported()) {
      this.notify('Браузер не поддерживает распознавание речи — используйте текст', 'warn');
      return;
    }
    if (!this.director.billing.canAffordAudio('asr', 5)) {
      this.notify('Недостаточно AI-монет для распознавания речи — используйте текстовый ввод', 'warn');
      return;
    }
    this.voice = { ...this.voice, listening: true, transcript: '', error: '' };
    voiceService.stopSpeaking();
    voiceService.startListening(
      r => {
        this.voice.transcript = r.text;
        if (r.isFinal) {
          this.director.billing.recordAudio(`asr_${this.nextId++}`, 'asr', r.seconds);
          this.voice.listening = false;
          voiceService.stopListening();
          void this.sendOrder(r.text);
        }
        this.bump();
      },
      err => {
        this.voice.error = err === 'not-allowed' ? 'Нет доступа к микрофону' : `Ошибка распознавания: ${err}`;
        this.voice.listening = false;
        this.bump();
      },
      () => {
        this.voice.listening = false;
        this.bump();
      },
    );
    this.bump();
  }

  private speak(text: string) {
    if (!this.settings.autoSpeakResponse) return;
    const estimate = VoiceService.estimateSpeechSeconds(text);
    if (!this.director.billing.canAffordAudio('tts', estimate)) return;
    const ok = voiceService.speak(text, seconds => {
      this.director.billing.recordAudio(`tts_${this.nextId++}`, 'tts', seconds);
      this.voice.speaking = false;
      this.bump();
    });
    if (ok) {
      this.voice.speaking = true;
      this.bump();
    }
  }
}
