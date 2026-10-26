import { LLMConnection, LLMError } from '../ai/llm/LLMClient';
import { LLM_PROVIDERS } from '../config/llmProviders';
import { DURATION_BUCKETS, LATENCY_BUCKETS, LLMResult, ProviderKind } from './events';

/**
 * Per-match counters of the agents' LLM calls. The director records every call here; the controller
 * sends them as one `llm_match` event when the match ends. Kinds and counts only, never texts.
 */
export type LLMFailure = Exclude<LLMResult, 'ok'>;

export class LLMMatchStats {
  calls = 0;
  totalLatencyMs = 0;
  errors: Record<LLMFailure, number> = emptyErrors();

  ok(latencyMs: number) {
    this.calls++;
    this.totalLatencyMs += Math.max(0, latencyMs);
  }

  fail(kind: LLMFailure) {
    this.errors[kind]++;
  }

  get failures(): number {
    return Object.values(this.errors).reduce((n, x) => n + x, 0);
  }

  /** Share of the agent decisions the local fallback made instead of the model, 0..100. */
  get fallbackPct(): number {
    const attempts = this.calls + this.failures;
    return attempts ? Math.round((100 * this.failures) / attempts) : 0;
  }

  reset() {
    this.calls = 0;
    this.totalLatencyMs = 0;
    this.errors = emptyErrors();
  }
}

function emptyErrors(): Record<LLMFailure, number> {
  return { not_configured: 0, no_coins: 0, network: 0, timeout: 0, parse: 0, auth: 0, rate_limit: 0, server: 0, http: 0, device: 0 };
}

/** The kind of an LLM failure from the error, by its kind and HTTP status (the message is never used). */
export function classifyLLMError(e: unknown): LLMFailure {
  if (!(e instanceof LLMError)) return 'network';
  switch (e.kind) {
    case 'not_configured':
    case 'timeout':
    case 'parse':
    case 'device':
      return e.kind;
    case 'http':
      if (e.status === 401 || e.status === 403) return 'auth';
      if (e.status === 429) return 'rate_limit';
      return e.status && e.status >= 500 ? 'server' : 'http';
    default:
      return 'network'; // 'network' and 'aborted'
  }
}

/** Loopback (*.localhost included), private networks and .local names: a model server on this machine or network. */
const LOCAL_HOST = /^(localhost|.+\.localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)$/i;

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOST.test(hostname);
}

/** A Firebase Hosting preview channel, `<site>--<channel>-<hash>.web.app` (npm run deploy:preview). */
const PREVIEW_CHANNEL_HOST = /^[a-z0-9-]+--[a-z0-9-]+\.web\.app$/i;

export function isPreviewChannelHost(hostname: string): boolean {
  return PREVIEW_CHANNEL_HOST.test(hostname);
}

/** The provider as a kind; the base URL decides only between 'local' and 'cloud' and is never sent. */
export function providerKind(conn: Pick<LLMConnection, 'provider' | 'baseUrl'>): ProviderKind {
  const preset = LLM_PROVIDERS[conn.provider];
  if (!preset || preset.protocol === 'none') return 'none';
  if (preset.protocol === 'native') return 'device';
  if (conn.provider === 'proxy') return 'proxy';
  try {
    return isLocalHost(new URL(conn.baseUrl).hostname) ? 'local' : 'cloud';
  } catch {
    return 'cloud';
  }
}

export function durationBucket(gameSeconds: number): (typeof DURATION_BUCKETS)[number] {
  const m = gameSeconds / 60;
  if (m < 2) return '0-2m';
  if (m < 5) return '2-5m';
  if (m < 10) return '5-10m';
  if (m < 15) return '10-15m';
  if (m < 20) return '15-20m';
  if (m < 30) return '20-30m';
  return '30m+';
}

export function latencyBucket(meanMs: number | null): (typeof LATENCY_BUCKETS)[number] {
  if (meanMs === null) return 'none';
  if (meanMs < 1000) return '0-1s';
  if (meanMs < 3000) return '1-3s';
  if (meanMs < 10000) return '3-10s';
  if (meanMs < 30000) return '10-30s';
  return '30s+';
}
