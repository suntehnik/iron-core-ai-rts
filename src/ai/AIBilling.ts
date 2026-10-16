import { AI_TARIFFS, AI_WALLET, llmCost } from '../config/tariffs';
import { t } from '../i18n';

/** The four billed services from brief §10. */
export type AIService = 'tactical' | 'production' | 'asr' | 'tts';
/** 'ally' = the teal AI commander in AI-vs-AI mode (a demo: never charged to the player). */
export type AIParticipant = 'player' | 'enemy' | 'ally';

export interface ServiceStats {
  calls: number;
  errors: number;
  tokensIn: number;
  tokensOut: number;
  seconds: number;
  coins: number;
  totalLatencyMs: number;
  lastLatencyMs: number;
}

export interface BillingSnapshot {
  wallet: number;
  matchLimit: number;
  spentThisMatch: number;
  remaining: number;
  status: 'ok' | 'low' | 'exhausted';
  services: Record<AIService, ServiceStats>;
  enemy: ServiceStats;
  ally: ServiceStats;
  chargeEnemyToPlayer: boolean;
  lastWarning: string | null;
}

export interface Affordability {
  ok: boolean;
  reason?: string;
}

const emptyStats = (): ServiceStats => ({
  calls: 0,
  errors: 0,
  tokensIn: 0,
  tokensOut: 0,
  seconds: 0,
  coins: 0,
  totalLatencyMs: 0,
  lastLatencyMs: 0,
});

const WALLET_KEY = 'ironcore_test_wallet_v1';

/**
 * Coin ledger for AI usage. Coins are spent only for successful results; failed calls
 * and technical retries are logged but never charged twice for the same request id.
 */
export class AIBilling {
  private wallet: number;
  private matchLimit: number;
  private spentThisMatch = 0;
  private services: Record<AIService, ServiceStats> = {
    tactical: emptyStats(),
    production: emptyStats(),
    asr: emptyStats(),
    tts: emptyStats(),
  };
  private enemy = emptyStats();
  private ally = emptyStats();
  private settled = new Set<string>();
  private listeners = new Set<() => void>();
  private lowWarned = false;
  private exhaustedWarned = false;
  private lastWarning: string | null = null;
  public chargeEnemyToPlayer = false;
  public onWarning: ((text: string) => void) | null = null;

  constructor(matchLimit: number = AI_WALLET.DEFAULT_MATCH_LIMIT) {
    this.matchLimit = matchLimit;
    this.wallet = AIBilling.loadWallet();
  }

  private static loadWallet(): number {
    try {
      const raw = localStorage.getItem(WALLET_KEY);
      if (raw !== null && !Number.isNaN(Number(raw))) return Number(raw);
    } catch {
      /* storage unavailable */
    }
    return AI_WALLET.INITIAL_TEST_BALANCE;
  }

  private saveWallet() {
    try {
      localStorage.setItem(WALLET_KEY, String(Math.round(this.wallet * 100) / 100));
    } catch {
      /* storage unavailable */
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  setMatchLimit(limit: number) {
    this.matchLimit = Math.max(0, limit);
    this.lowWarned = false;
    this.exhaustedWarned = false;
    this.checkWarnings();
    this.emit();
  }

  /** Coins still available for this match: bounded by both the wallet and the match limit. */
  remaining(): number {
    return Math.max(0, Math.min(this.wallet, this.matchLimit - this.spentThisMatch));
  }

  status(): BillingSnapshot['status'] {
    const rem = this.remaining();
    if (rem < AI_TARIFFS.LLM_MIN_CHARGE * 2) return 'exhausted';
    if (rem < Math.max(3, this.matchLimit * AI_WALLET.LOW_BALANCE_SHARE)) return 'low';
    return 'ok';
  }

  /** Pre-flight check before an agent call. Enemy calls are free unless included in the tariff. */
  canAfford(participant: AIParticipant, estimate: number): Affordability {
    if (participant === 'ally') return { ok: true };
    if (participant === 'enemy' && !this.chargeEnemyToPlayer) return { ok: true };
    const rem = this.remaining();
    if (rem < estimate) {
      const byLimit = this.matchLimit - this.spentThisMatch <= this.wallet;
      return {
        ok: false,
        reason: byLimit
          ? t('bill.limitReached')
          : t('bill.noCoins'),
      };
    }
    return { ok: true };
  }

  /** Records a successful inference. Idempotent per requestId. Returns coins charged. */
  recordLLM(
    requestId: string,
    participant: AIParticipant,
    service: 'tactical' | 'production',
    tokensIn: number,
    tokensOut: number,
    latencyMs: number,
  ): number {
    if (this.settled.has(requestId)) return 0;
    this.settled.add(requestId);
    const coins = llmCost(tokensIn, tokensOut);
    const target = participant === 'enemy' ? this.enemy : participant === 'ally' ? this.ally : this.services[service];
    target.calls++;
    target.tokensIn += tokensIn;
    target.tokensOut += tokensOut;
    target.lastLatencyMs = latencyMs;
    target.totalLatencyMs += latencyMs;
    target.coins += coins;
    const charged = participant === 'player' || (participant === 'enemy' && this.chargeEnemyToPlayer) ? coins : 0;
    this.charge(charged);
    return charged;
  }

  /** A failed call: logged for telemetry, never charged. */
  recordError(participant: AIParticipant, service: 'tactical' | 'production', latencyMs: number) {
    const target = participant === 'enemy' ? this.enemy : participant === 'ally' ? this.ally : this.services[service];
    target.errors++;
    target.lastLatencyMs = latencyMs;
    this.emit();
  }

  recordAudio(requestId: string, service: 'asr' | 'tts', seconds: number, latencyMs = 0): number {
    if (this.settled.has(requestId) || seconds <= 0) return 0;
    this.settled.add(requestId);
    const rate = service === 'asr' ? AI_TARIFFS.ASR_PER_SEC : AI_TARIFFS.TTS_PER_SEC;
    const coins = Math.round(seconds * rate * 100) / 100;
    const s = this.services[service];
    s.calls++;
    s.seconds += seconds;
    s.coins += coins;
    s.lastLatencyMs = latencyMs;
    s.totalLatencyMs += latencyMs;
    this.charge(coins);
    return coins;
  }

  canAffordAudio(service: 'asr' | 'tts', seconds: number): boolean {
    const rate = service === 'asr' ? AI_TARIFFS.ASR_PER_SEC : AI_TARIFFS.TTS_PER_SEC;
    return this.remaining() >= seconds * rate;
  }

  private charge(coins: number) {
    if (coins > 0) {
      this.spentThisMatch += coins;
      this.wallet = Math.max(0, this.wallet - coins);
      this.saveWallet();
    }
    this.checkWarnings();
    this.emit();
  }

  private checkWarnings() {
    const st = this.status();
    if (st === 'low' && !this.lowWarned) {
      this.lowWarned = true;
      this.warn(
        t('bill.low', { n: this.remaining().toFixed(1) }),
      );
    }
    if (st === 'exhausted' && !this.exhaustedWarned) {
      this.exhaustedWarned = true;
      this.warn(t('bill.exhausted'));
    }
  }

  private warn(text: string) {
    this.lastWarning = text;
    this.onWarning?.(text);
  }

  topUpTestBalance(amount: number = AI_WALLET.TEST_TOP_UP) {
    this.wallet += amount;
    this.saveWallet();
    this.lowWarned = this.status() !== 'ok' ? this.lowWarned : false;
    this.exhaustedWarned = this.status() === 'exhausted' ? this.exhaustedWarned : false;
    this.lastWarning = null;
    this.emit();
  }

  resetMatch() {
    this.spentThisMatch = 0;
    this.services = { tactical: emptyStats(), production: emptyStats(), asr: emptyStats(), tts: emptyStats() };
    this.enemy = emptyStats();
    this.ally = emptyStats();
    this.settled.clear();
    this.lowWarned = false;
    this.exhaustedWarned = false;
    this.lastWarning = null;
    this.emit();
  }

  snapshot(): BillingSnapshot {
    return {
      wallet: this.wallet,
      matchLimit: this.matchLimit,
      spentThisMatch: this.spentThisMatch,
      remaining: this.remaining(),
      status: this.status(),
      services: {
        tactical: { ...this.services.tactical },
        production: { ...this.services.production },
        asr: { ...this.services.asr },
        tts: { ...this.services.tts },
      },
      enemy: { ...this.enemy },
      ally: { ...this.ally },
      chargeEnemyToPlayer: this.chargeEnemyToPlayer,
      lastWarning: this.lastWarning,
    };
  }
}

/**
 * Same AI decision frequency for every participant (brief §10): a bigger wallet must not
 * buy more frequent tactical control.
 */
export class DecisionRateLimiter {
  private last = new Map<string, number>();
  constructor(private minIntervalSec: number) {}

  ready(key: string, now: number): boolean {
    const t = this.last.get(key);
    return t === undefined || now - t >= this.minIntervalSec;
  }

  mark(key: string, now: number) {
    this.last.set(key, now);
  }

  /** Game time of the last decision for this key (-Infinity if none yet). */
  lastAt(key: string): number {
    return this.last.get(key) ?? -Infinity;
  }

  secondsUntil(key: string, now: number): number {
    const t = this.last.get(key);
    return t === undefined ? 0 : Math.max(0, this.minIntervalSec - (now - t));
  }

  reset() {
    this.last.clear();
  }
}
