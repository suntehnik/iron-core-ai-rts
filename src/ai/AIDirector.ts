import { GAME_BALANCE } from '../config/balance';
import { LLM_PROVIDERS } from '../config/llmProviders';
import { estimateLLMCost } from '../config/tariffs';
import { GameState } from '../engine/GameState';
import { RobotBuilder } from '../engine/RobotBuilder';
import { ChatMessage, LLMSettings, ProductionProposal, TacticalDecision } from '../types/agent';
import { ProductionAction, TacticalPlan, Team } from '../types/game';
import { RobotDesign } from '../types/robot';
import { AIBilling, AIParticipant, DecisionRateLimiter } from './AIBilling';
import { localCommanderDecision, localEngineer, localTactician } from './fallbacks';
import { LLMConnection, LLMError, LLMResponse, chatJSON, cloudReady } from './llm/LLMClient';
import { asString, describeAction, normalizeActions, normalizePlan } from './parsing';
import {
  commanderSystem,
  commanderUserPrompt,
  ENGINEER_SYSTEM,
  TACTICIAN_SYSTEM,
  engineerRepairPrompt,
  engineerUserPrompt,
  parseCostLimitPct,
  tacticianUserPrompt,
} from './prompts';

/** 'ally' = the teal AI commander that replaces the human in AI-vs-AI mode. */
export type AgentKey = 'engineer' | 'tactician' | 'enemy' | 'ally';
export type GameMode = 'human' | 'spectator';

export interface AgentCallInfo {
  source: 'llm' | 'fallback';
  latencyMs: number;
  coins: number;
  error?: string;
  model?: string;
  at: number;
}

export interface DirectorEvents {
  chat(msg: ChatMessage): void;
  proposal(p: ProductionProposal | null): void;
  tactical(d: TacticalDecision): void;
  intercept(text: string, source: 'llm' | 'fallback', team: Team): void;
  changed(): void;
}

// Expected token budgets used for the pre-flight affordability check
const BUDGET = {
  engineer: { in: 1500, out: 320, max: 480 },
  tactician: { in: 900, out: 160, max: 280 },
  enemy: { in: 1600, out: 320, max: 480 },
};

/** Commanders decide in the background every ~25 s, so a slow (local) model may take its time. */
const COMMANDER_TIMEOUT_MS = 45000;

let msgCounter = 0;
const newId = (p: string) => `${p}_${Date.now().toString(36)}_${(msgCounter++).toString(36)}`;

/**
 * Orchestrates the GenAI agents. Agents are called only on new orders and significant
 * events, never per frame; between calls the game AI executes the last valid plan.
 */
export class AIDirector {
  public readonly billing: AIBilling;
  public busy: Record<AgentKey, boolean> = { engineer: false, tactician: false, enemy: false, ally: false };
  public lastCall: Record<AgentKey, AgentCallInfo | null> = { engineer: null, tactician: null, enemy: null, ally: null };
  /** 'spectator' = AI vs AI: an AI commander also plays the teal side, the human only watches. */
  public mode: GameMode = 'human';
  public pendingProposal: ProductionProposal | null = null;
  public lastTactical: TacticalDecision | null = null;
  public standingOrders: string[] = [];

  private settings: LLMSettings;
  private limiter = new DecisionRateLimiter(GAME_BALANCE.AI_AUTONOMOUS_MIN_INTERVAL_SEC);
  private orderCooldown = new DecisionRateLimiter(GAME_BALANCE.AI_PLAYER_ORDER_COOLDOWN_SEC);
  private seenSignificant = { player: 0, enemy: 0 };
  private macroTimer = 0;
  private generation = 0;

  constructor(
    settings: LLMSettings,
    private events: DirectorEvents,
  ) {
    this.settings = settings;
    this.billing = new AIBilling(settings.matchCoinLimit);
    this.billing.chargeEnemyToPlayer = settings.chargeEnemyToPlayer;
  }

  updateSettings(s: LLMSettings) {
    this.settings = s;
    this.billing.setMatchLimit(s.matchCoinLimit);
    this.billing.chargeEnemyToPlayer = s.chargeEnemyToPlayer;
    this.events.changed();
  }

  get connection(): LLMConnection {
    return { provider: this.settings.provider, apiKey: this.settings.apiKey, model: this.settings.model, baseUrl: this.settings.baseUrl };
  }

  cloudEnabled(): boolean {
    return cloudReady(this.connection);
  }

  providerLabel(): string {
    const p = LLM_PROVIDERS[this.settings.provider];
    if (!this.cloudEnabled()) return p.protocol === 'none' ? 'локальные эвристики' : `${p.label}: нужен ключ`;
    return `${p.label} · ${this.settings.model || 'модель сервера'}`;
  }

  /** Called when a match restarts: in-flight replies from the old match are ignored. */
  resetMatch() {
    this.generation++;
    this.busy = { engineer: false, tactician: false, enemy: false, ally: false };
    this.lastCall = { engineer: null, tactician: null, enemy: null, ally: null };
    this.pendingProposal = null;
    this.lastTactical = null;
    this.standingOrders = [];
    this.limiter.reset();
    this.orderCooldown.reset();
    this.seenSignificant = { player: 0, enemy: 0 };
    this.billing.resetMatch();
    this.events.changed();
  }

  /** Cheap per-frame check for autonomous triggers. */
  update(state: GameState, dt: number) {
    if (state.isPaused || state.gameOver) return;

    // Baseline game AI for the opponent's economy (runs regardless of LLM availability)
    const spectator = this.mode === 'spectator';
    this.macroTimer -= dt;
    if (this.macroTimer <= 0) {
      this.macroTimer = 3;
      this.baselineMacro(state, 'enemy');
      if (spectator) this.baselineMacro(state, 'player');
    }

    // AI commanders: the enemy always; the teal side too in AI-vs-AI mode. Same decision
    // interval for both (brief §10); the teal one starts a few seconds later so the two
    // requests do not hit the model at the same moment.
    // In AI-vs-AI the two commanders take turns instead of querying the model at once (a local
    // server answers one request at a time); whoever decided longer ago goes first.
    const commanders: Team[] = spectator
      ? (['enemy', 'player'] as Team[]).sort((a, b) => this.limiter.lastAt(commanderKey(a)) - this.limiter.lastAt(commanderKey(b)))
      : ['enemy'];
    for (const team of commanders) {
      const key = commanderKey(team);
      if (spectator && (this.busy.enemy || this.busy.ally)) break;
      const first = GAME_BALANCE.AI_FIRST_ENEMY_DECISION_SEC + (team === 'player' ? 6 : 0);
      if (!this.busy[key] && state.gameTime >= first && this.limiter.ready(key, state.gameTime)) {
        this.limiter.mark(key, state.gameTime);
        void this.decideCommander(state, team);
      }
    }
    if (spectator) return; // no human orders, no player-side tactician

    const sig = state.significantCounter.player;
    if (sig > this.seenSignificant.player) {
      if (this.settings.autonomousTactics && this.cloudEnabled() && !this.busy.tactician && this.limiter.ready('player', state.gameTime)) {
        this.seenSignificant.player = sig;
        const trigger = state.recentEvents('player', 3, 30).filter(e => e.significant).map(e => e.text).join('; ');
        if (trigger) {
          this.limiter.mark('player', state.gameTime);
          void this.autonomousTactical(state, trigger);
        }
      } else if (!this.settings.autonomousTactics || !this.cloudEnabled()) {
        this.seenSignificant.player = sig;
      }
    }
  }

  setMode(mode: GameMode) {
    this.mode = mode;
    this.events.changed();
  }

  /** Baseline game AI economy for an AI-run side (runs regardless of LLM availability). */
  private baselineMacro(state: GameState, team: Team) {
    const econ = state.teams[team].economy;
    // ordered harvesters count too: they are already paid and on the factory line
    const harvesters = state.harvesterCount(team) + state.harvestersInProduction(team);
    // Economy first: grow mining over time so production does not starve harvesters
    // Harvesters take factory time from the army, so grow mining gradually and not while defenceless
    const army = state.combatCount(team);
    const targetHarvesters = Math.min(6, 2 + Math.floor(state.gameTime / 75));
    const canSpareFactory = army >= 3 || harvesters < 2 || !state.buildings.some(b => b.team === team && b.type === 'factory');
    if (harvesters < targetHarvesters && canSpareFactory && (econ.metal >= GAME_BALANCE.HARVESTER_COST_METAL || harvesters === 0)) {
      state.orderHarvester(team);
    }
    if (econ.powerEfficiency < 0.9 && econ.metal >= GAME_BALANCE.POWER_PLANT_COST_METAL) {
      const building = state.buildings.some(b => b.team === team && b.type === 'power_plant' && b.built < 1);
      if (!building) state.buildStructure(team, 'power_plant');
    }
    // Metal piling up while components are short → fabricate more components
    econ.componentReserve = econ.metal > 500 ? Math.max(econ.componentReserve, 350) : Math.min(econ.componentReserve, 220);
    if (state.buildingCount(team, 'factory') === 0 && econ.metal >= GAME_BALANCE.FACTORY_COST_METAL) {
      state.buildStructure(team, 'factory');
    }
  }

  // ───────────────────────────── Shared LLM call with billing ─────────────────────────────

  private async callAgent(
    participant: AIParticipant,
    service: 'production' | 'tactical',
    budget: { in: number; out: number; max: number },
    system: string,
    user: string,
    timeoutMs: number = service === 'tactical' ? 18000 : 25000,
  ): Promise<{ res: LLMResponse | null; coins: number; error?: string }> {
    if (!this.cloudEnabled()) return { res: null, coins: 0, error: LLM_PROVIDERS[this.settings.provider].protocol === 'none' ? undefined : 'облачный LLM не настроен' };
    const afford = this.billing.canAfford(participant, estimateLLMCost(budget.in, budget.out));
    if (!afford.ok) return { res: null, coins: 0, error: afford.reason };

    const requestId = newId(`${participant}_${service}`);
    const started = performance.now();
    try {
      const res = await chatJSON(this.connection, {
        system,
        user,
        maxTokens: budget.max,
        temperature: participant === 'enemy' ? 0.7 : 0.35,
        timeoutMs,
      });
      const coins = this.billing.recordLLM(requestId, participant, service, res.usage.tokensIn, res.usage.tokensOut, res.latencyMs);
      return { res, coins };
    } catch (e) {
      const err = e instanceof LLMError ? e : new LLMError('network', String(e));
      this.billing.recordError(participant, service, Math.round(performance.now() - started));
      console.warn(`[AI] ${participant}/${service} call failed:`, err.message);
      return { res: null, coins: 0, error: err.userMessage };
    }
  }

  // ───────────────────────────── Production agent ─────────────────────────────

  async sendEngineerOrder(state: GameState, order: string) {
    const text = order.trim();
    if (!text) return;

    // Voice-friendly confirmation shortcuts handled locally (no inference needed)
    if (this.pendingProposal) {
      const p = text.toLowerCase();
      if (/^(да|подтвер|утвер|в серию|запуска|принято|ок\b|окей)/.test(p)) {
        this.confirmProposal(state);
        return;
      }
      if (/^(нет|отмен|отбой|стоп)/.test(p)) {
        this.cancelProposal();
        return;
      }
    }
    if (this.busy.engineer) return;
    if (!this.orderCooldown.ready('engineer', state.gameTime)) return;
    this.orderCooldown.mark('engineer', state.gameTime);

    this.busy.engineer = true;
    this.events.changed();
    const gen = this.generation;
    const current = state.teams.player.design;
    const prevStats = RobotBuilder.calculateStats(current);
    const pending = this.pendingProposal;

    let proposal: ProductionProposal;
    let call: AgentCallInfo;
    const { res, coins, error } = await this.callAgent(
      'player',
      'production',
      BUDGET.engineer,
      ENGINEER_SYSTEM,
      engineerUserPrompt(state, text, pending),
    );
    if (gen !== this.generation) return;

    if (res) {
      let totalCoins = coins;
      let latency = res.latencyMs;
      let data = res.data;
      let normalized = data.design ? RobotBuilder.normalizeDesign(data.design, current, 'player') : null;
      const warnings: string[] = [];
      let repaired = false;

      // The game, not the model, checks the commander's cost cap
      const modelLimit = Number(data.costLimitPct);
      const costLimitPct = Number.isFinite(modelLimit) && data.costLimitPct !== null ? modelLimit : parseCostLimitPct(text);
      const maxCost = costLimitPct !== null ? Math.round(prevStats.metalCost * (1 + costLimitPct / 100)) : Infinity;
      const constraintErrors = (stats: ReturnType<typeof RobotBuilder.calculateStats>) => {
        const errs = [...stats.validationErrors];
        if (stats.metalCost > maxCost) {
          errs.push(`стоимость ${stats.metalCost} металла превышает лимит командира ${maxCost} (+${costLimitPct}% к текущим ${prevStats.metalCost})`);
        }
        return errs;
      };

      // One repair round-trip when the model ignored a physical limit or the cost cap
      if (normalized) {
        const stats = RobotBuilder.calculateStats(normalized.design);
        const errs = constraintErrors(stats);
        if (errs.length) {
          const retry = await this.callAgent(
            'player',
            'production',
            BUDGET.engineer,
            ENGINEER_SYSTEM,
            `${engineerUserPrompt(state, text, pending)}\n\n${engineerRepairPrompt(errs)}`,
          );
          if (gen !== this.generation) return;
          if (retry.res) {
            totalCoins += retry.coins;
            latency += retry.res.latencyMs;
            const second = retry.res.data.design ? RobotBuilder.normalizeDesign(retry.res.data.design, current, 'player') : null;
            if (second) {
              normalized = second;
              data = { ...data, ...retry.res.data };
            }
          }
        }
        const finalStats = RobotBuilder.calculateStats(normalized.design);
        if (!finalStats.isValid) {
          const fix = RobotBuilder.repairDesign(normalized.design);
          normalized = { design: fix.design, dropped: normalized.dropped };
          repaired = true;
          if (fix.notes.length) warnings.push(`Игра скорректировала проект: ${fix.notes.join('; ')}`);
        }
        if (normalized.dropped.length) warnings.push(`Отброшены неизвестные детали: ${normalized.dropped.join(', ')}`);
        const cost = RobotBuilder.calculateStats(normalized.design).metalCost;
        if (cost > maxCost) {
          warnings.push(`Стоимость ${cost} металла выше вашего лимита ${maxCost} (+${costLimitPct}%). Подтвердите или уточните приказ.`);
        }
      }

      // A "new" design identical to the serial one is not a proposal worth confirming
      const sameAsCurrent = (d: RobotDesign | null) =>
        !!d && d.chassisId === current.chassisId && [...d.modules].sort().join() === [...current.modules].sort().join();
      const design = normalized && !sameAsCurrent(normalized.design) ? normalized.design : null;
      if (normalized && !design) warnings.push('Конструкция не изменилась — подтверждать нечего.');
      proposal = {
        id: newId('proposal'),
        order: text,
        replyRu: asString(data.reply, 'Готово, командир.'),
        compromiseRu: asString(data.compromise) || undefined,
        design,
        stats: design ? RobotBuilder.calculateStats(design) : null,
        prevDesign: current,
        prevStats,
        actions: normalizeActions(data.actions),
        warnings,
        source: 'llm',
        repaired,
      };
      call = { source: 'llm', latencyMs: latency, coins: totalCoins, model: res.model, at: state.gameTime };
    } else {
      const draft = localEngineer(text, pending?.design ?? current);
      proposal = {
        id: newId('proposal'),
        order: text,
        replyRu: draft.reply,
        compromiseRu: draft.compromise || undefined,
        design: draft.design,
        stats: draft.design ? RobotBuilder.calculateStats(draft.design) : null,
        prevDesign: current,
        prevStats,
        actions: draft.actions,
        warnings: error ? [`Облачный ИИ недоступен (${error}) — ответил локальный сопроцессор`] : [],
        source: 'fallback',
        repaired: false,
      };
      call = { source: 'fallback', latencyMs: 0, coins: 0, error, at: state.gameTime };
    }

    this.lastCall.engineer = call;
    this.busy.engineer = false;
    const hasContent = !!proposal.design || proposal.actions.length > 0;
    this.pendingProposal = hasContent ? proposal : null;
    this.events.chat({
      id: newId('eng'),
      role: 'engineer',
      text: proposal.compromiseRu ? `${proposal.replyRu} Компромисс: ${proposal.compromiseRu.replace(/[.\s]+$/, '')}.` : proposal.replyRu,
      timestamp: Date.now(),
      source: proposal.source,
      latencyMs: call.latencyMs,
      costCoins: call.coins,
    });
    this.events.proposal(this.pendingProposal);
    this.events.changed();
  }

  confirmProposal(state: GameState) {
    const p = this.pendingProposal;
    if (!p) return;
    const results: string[] = [];
    if (p.design) {
      state.setDesign('player', p.design);
      results.push(`«${p.design.name}» утверждён в серию — следующая партия выйдет в этом исполнении`);
    }
    for (const a of p.actions) results.push(state.applyProductionAction('player', a));
    this.pendingProposal = null;
    this.events.proposal(null);
    this.events.chat({ id: newId('confirm'), role: 'engineer', text: `${results.join('. ')}.`, timestamp: Date.now(), source: 'local' });
    this.events.changed();
  }

  cancelProposal() {
    if (!this.pendingProposal) return;
    this.pendingProposal = null;
    this.events.proposal(null);
    this.events.chat({ id: newId('cancel'), role: 'engineer', text: 'Отменил. Конвейер продолжает выпускать текущую модель.', timestamp: Date.now(), source: 'local' });
    this.events.changed();
  }

  // ───────────────────────────── Combat-control agent ─────────────────────────────

  async sendTacticalOrder(state: GameState, order: string) {
    const text = order.trim();
    if (!text || this.busy.tactician) return;
    if (!this.orderCooldown.ready('tactician', state.gameTime)) return;
    this.orderCooldown.mark('tactician', state.gameTime);
    this.standingOrders = [...this.standingOrders, text].slice(-3);
    await this.runTactical(state, text, null);
  }

  private async autonomousTactical(state: GameState, trigger: string) {
    await this.runTactical(state, null, trigger);
  }

  private async runTactical(state: GameState, order: string | null, trigger: string | null) {
    this.busy.tactician = true;
    this.events.changed();
    const gen = this.generation;
    const prev = state.teams.player.plan;
    const { res, coins, error } = await this.callAgent(
      'player',
      'tactical',
      BUDGET.tactician,
      TACTICIAN_SYSTEM,
      tacticianUserPrompt(state, order, this.standingOrders, trigger),
    );
    if (gen !== this.generation) return;
    this.busy.tactician = false;

    let decision: TacticalDecision | null = null;
    if (res) {
      const plan = normalizePlan(res.data.plan, prev, order ? 'player' : 'agent');
      decision = { replyRu: asString(res.data.reply, 'План обновлён.'), plan, previous: prev, source: 'llm', autonomous: !order };
      this.lastCall.tactician = { source: 'llm', latencyMs: res.latencyMs, coins, model: res.model, at: state.gameTime };
    } else if (order) {
      const local = localTactician(order, prev);
      decision = {
        replyRu: error ? `${local.reply} (облако недоступно: ${error})` : local.reply,
        plan: local.plan,
        previous: prev,
        source: 'fallback',
        autonomous: false,
      };
      this.lastCall.tactician = { source: 'fallback', latencyMs: 0, coins: 0, error, at: state.gameTime };
    } else {
      // Autonomous re-plan impossible: keep executing the last valid plan with the game AI
      this.lastCall.tactician = { source: 'fallback', latencyMs: 0, coins: 0, error, at: state.gameTime };
      this.events.changed();
      return;
    }

    const changed = planChanged(prev, decision.plan);
    if (changed || order) {
      state.setPlan('player', decision.plan);
      this.lastTactical = decision;
      this.events.tactical(decision);
      this.events.chat({
        id: newId('tac'),
        role: 'tactician',
        text: decision.autonomous ? `[Автономно] ${decision.replyRu}` : decision.replyRu,
        timestamp: Date.now(),
        source: decision.source,
        latencyMs: this.lastCall.tactician?.latencyMs,
        costCoins: coins,
      });
    }
    this.events.changed();
  }

  revertTactical(state: GameState) {
    const d = this.lastTactical;
    if (!d) return;
    state.setPlan('player', { ...d.previous, source: 'player' });
    this.lastTactical = null;
    this.events.chat({ id: newId('revert'), role: 'tactician', text: 'Вернул прежний план.', timestamp: Date.now(), source: 'local' });
    this.events.changed();
  }

  setManualPlan(state: GameState, patch: Partial<TacticalPlan>) {
    const prev = state.teams.player.plan;
    const plan = normalizePlan({ ...prev, ...patch, summary: undefined }, prev, 'player');
    state.setPlan('player', plan);
    this.events.changed();
  }

  // ───────────────────────────── Enemy commander ─────────────────────────────

  private async decideCommander(state: GameState, team: Team) {
    const key = commanderKey(team);
    const participant: AIParticipant = team === 'enemy' ? 'enemy' : 'ally';
    const vsAI = this.mode === 'spectator';
    this.busy[key] = true;
    const gen = this.generation;
    // In AI-vs-AI both commanders follow the same switch, so neither side gets a smarter brain
    const useCloud = this.settings.enemyUsesLLM && this.cloudEnabled();
    let taunt = '';
    let design: RobotDesign | null = null;
    let plan: TacticalPlan | null = null;
    let actions: ProductionAction[] = [];
    let source: 'llm' | 'fallback' = 'fallback';
    const current = () => state.teams[team];

    if (useCloud) {
      const { res, coins, error } = await this.callAgent(
        participant,
        'tactical',
        BUDGET.enemy,
        commanderSystem(team, vsAI),
        commanderUserPrompt(state, team),
        COMMANDER_TIMEOUT_MS,
      );
      if (gen !== this.generation) return;
      if (res) {
        source = 'llm';
        taunt = asString(res.data.taunt) || asString(res.data.reply) || asString(res.data.message);
        const n = res.data.design ? RobotBuilder.normalizeDesign(res.data.design, current().design, team) : null;
        if (n) design = RobotBuilder.calculateStats(n.design).isValid ? n.design : RobotBuilder.repairDesign(n.design).design;
        plan = res.data.plan ? normalizePlan(res.data.plan, current().plan, 'agent') : null;
        actions = normalizeActions(res.data.actions);
        this.lastCall[key] = { source: 'llm', latencyMs: res.latencyMs, coins, model: res.model, at: state.gameTime };
      } else {
        this.lastCall[key] = { source: 'fallback', latencyMs: 0, coins: 0, error, at: state.gameTime };
      }
    }

    if (source === 'fallback') {
      const draft = localCommanderDecision(state, team);
      taunt = draft.taunt;
      design = draft.design;
      plan = draft.plan;
      actions = draft.actions;
      if (!useCloud) this.lastCall[key] = { source: 'fallback', latencyMs: 0, coins: 0, at: state.gameTime };
    }

    if (gen !== this.generation || state.gameOver) {
      this.busy[key] = false;
      return;
    }
    const d = current().design;
    if (design && (design.chassisId !== d.chassisId || design.modules.join() !== d.modules.join())) state.setDesign(team, design);
    if (plan) state.setPlan(team, plan);
    for (const a of actions) state.applyProductionAction(team, a);
    if (taunt) this.events.intercept(taunt, source, team);
    this.busy[key] = false;
    this.events.changed();
  }

  /** Small connectivity test for the settings dialog. */
  async testConnection(conn: LLMConnection): Promise<{ ok: boolean; text: string }> {
    if (!cloudReady(conn)) return { ok: false, text: 'Заполните провайдера, ключ и модель' };
    try {
      const res = await chatJSON(conn, {
        system: 'Ты проверка связи игры. Ответь только JSON {"status":"ok","reply":"короткое приветствие командиру"}.',
        user: 'Проверка связи.',
        maxTokens: 60,
        temperature: 0,
        timeoutMs: 20000,
      });
      return {
        ok: true,
        text: `Связь есть: ${res.model}, ${res.latencyMs} мс, ${res.usage.tokensIn}+${res.usage.tokensOut} токенов${res.usage.estimated ? ' (оценка)' : ''}`,
      };
    } catch (e) {
      const err = e instanceof LLMError ? e : new LLMError('network', String(e));
      return { ok: false, text: `Ошибка: ${err.userMessage}. ${err.message.slice(0, 140)}` };
    }
  }
}

function planChanged(a: TacticalPlan, b: TacticalPlan): boolean {
  return (
    a.stance !== b.stance ||
    a.engagementRange !== b.engagementRange ||
    a.targetPriority !== b.targetPriority ||
    a.retreatHpThreshold !== b.retreatHpThreshold ||
    a.guardHarvesters !== b.guardHarvesters
  );
}

function commanderKey(team: Team): 'enemy' | 'ally' {
  return team === 'enemy' ? 'enemy' : 'ally';
}

export { describeAction };
