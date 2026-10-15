import { LLM_PROVIDERS, LLMProviderId } from '../../config/llmProviders';
import { estimateTokens, extractJSONObject } from './jsonExtract';

export interface LLMConnection {
  provider: LLMProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface LLMRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LLMUsage {
  tokensIn: number;
  tokensOut: number;
  estimated: boolean;
}

export interface LLMResponse {
  data: Record<string, unknown>;
  text: string;
  usage: LLMUsage;
  latencyMs: number;
  model: string;
  attempts: number;
}

export type LLMErrorKind = 'not_configured' | 'network' | 'http' | 'timeout' | 'parse' | 'aborted';

export class LLMError extends Error {
  constructor(
    public kind: LLMErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
  }

  get userMessage(): string {
    switch (this.kind) {
      case 'not_configured':
        return 'облачный LLM не настроен';
      case 'timeout':
        return 'облачный LLM не ответил вовремя';
      case 'network':
        return 'нет связи с облачным LLM (сеть или CORS)';
      case 'parse':
        return 'модель вернула неразборчивый ответ';
      case 'aborted':
        return 'запрос отменён';
      default:
        if (this.status === 401 || this.status === 403) return 'ключ API отклонён провайдером';
        if (this.status === 429) return 'провайдер ограничил частоту запросов';
        return `ошибка провайдера (HTTP ${this.status ?? '?'})`;
    }
  }
}

export function cloudReady(c: LLMConnection): boolean {
  const preset = LLM_PROVIDERS[c.provider];
  if (!preset || preset.protocol === 'none') return false;
  if (preset.needsKey && !c.apiKey.trim()) return false;
  if (!c.baseUrl.trim()) return false;
  if (c.provider !== 'proxy' && !c.model.trim()) return false;
  return true;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Single entry point for every agent. Sends a short-context JSON request to the
 * configured cloud provider. Technical retries reuse the same logical request, so the
 * caller bills the result only once (brief §10).
 */
export async function chatJSON(conn: LLMConnection, req: LLMRequest): Promise<LLMResponse> {
  if (!cloudReady(conn)) throw new LLMError('not_configured', 'LLM provider is not configured');
  const preset = LLM_PROVIDERS[conn.provider];
  const started = performance.now();
  let attempts = 0;
  let minimal = false; // after a 400 we retry once without optional parameters
  let lastError: LLMError | null = null;

  while (attempts < 3) {
    attempts++;
    try {
      const raw = preset.protocol === 'anthropic' ? await callAnthropic(conn, req) : await callOpenAI(conn, req, minimal);
      const data = extractJSONObject(raw.text);
      if (!data) throw new LLMError('parse', `Model reply is not JSON: ${raw.text.slice(0, 160)}`);
      return {
        data,
        text: raw.text,
        usage: raw.usage ?? {
          tokensIn: estimateTokens(req.system + req.user),
          tokensOut: estimateTokens(raw.text),
          estimated: true,
        },
        latencyMs: Math.round(performance.now() - started),
        model: raw.model || conn.model,
        attempts,
      };
    } catch (e) {
      const err = toLLMError(e);
      lastError = err;
      if (err.kind === 'aborted' || req.signal?.aborted) throw err;
      if (err.kind === 'http' && err.status === 400 && !minimal && preset.protocol === 'openai') {
        minimal = true;
        continue;
      }
      // A timed-out request is usually still being computed by the server (local models process
      // requests one by one), so retrying it only lengthens the queue — retry real failures only.
      const retryable = err.kind === 'network' || (err.kind === 'http' && RETRYABLE_STATUS.has(err.status ?? 0));
      if (!retryable || attempts >= 2) throw err;
      await sleep(700 * attempts);
    }
  }
  throw lastError ?? new LLMError('network', 'Unknown LLM failure');
}

/** Lists models exposed by an OpenAI-compatible server (GET /models). */
export async function listModels(conn: LLMConnection): Promise<string[]> {
  const preset = LLM_PROVIDERS[conn.provider];
  if (!preset || preset.protocol !== 'openai' || !conn.baseUrl.trim()) return [];
  const headers: Record<string, string> = {};
  if (conn.apiKey.trim()) headers.Authorization = `Bearer ${conn.apiKey.trim()}`;
  const json = await fetchJSON(`${conn.baseUrl.replace(/\/+$/, '')}/models`, { headers }, {
    system: '',
    user: '',
    maxTokens: 0,
    timeoutMs: 10000,
  });
  const data: unknown[] = Array.isArray(json?.data) ? json.data : [];
  return data
    .map(m => (m && typeof m === 'object' ? String((m as { id?: unknown }).id ?? '') : ''))
    .filter(Boolean)
    .slice(0, 200);
}

interface RawReply {
  text: string;
  usage: LLMUsage | null;
  model?: string;
}

async function callOpenAI(conn: LLMConnection, req: LLMRequest, minimal: boolean): Promise<RawReply> {
  const preset = LLM_PROVIDERS[conn.provider];
  const url = `${conn.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (conn.apiKey.trim()) headers.Authorization = `Bearer ${conn.apiKey.trim()}`;
  if (conn.provider === 'openrouter') {
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'http://localhost';
    headers['X-Title'] = 'Iron Core AI RTS';
  }

  const body: Record<string, unknown> = {
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    max_tokens: req.maxTokens,
    temperature: req.temperature ?? 0.4,
  };
  if (conn.model.trim()) body.model = conn.model.trim();
  if (!minimal) {
    if (preset.jsonMode) body.response_format = { type: 'json_object' };
    // Qwen3 hybrid-thinking models: hidden reasoning burns the token budget and adds
    // seconds of latency, so ask every server flavour to answer directly.
    const qwen = /qwen/i.test(conn.model) || conn.provider === 'proxy';
    if (conn.provider === 'groq' && qwen) body.reasoning_effort = 'none';
    if (conn.provider === 'dashscope') body.enable_thinking = false;
    if ((conn.provider === 'custom' || conn.provider === 'proxy') && qwen) {
      body.chat_template_kwargs = { enable_thinking: false };
    }
  }

  const json = await fetchJSON(url, { method: 'POST', headers, body: JSON.stringify(body) }, req);
  const msg = json?.choices?.[0]?.message;
  const text: string = typeof msg?.content === 'string' ? msg.content : '';
  const usage = json?.usage
    ? { tokensIn: Number(json.usage.prompt_tokens) || 0, tokensOut: Number(json.usage.completion_tokens) || 0, estimated: false }
    : null;
  return { text, usage, model: json?.model };
}

async function callAnthropic(conn: LLMConnection, req: LLMRequest): Promise<RawReply> {
  const url = `${conn.baseUrl.replace(/\/+$/, '')}/messages`;
  const json = await fetchJSON(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': conn.apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: conn.model.trim(),
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0.4,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      }),
    },
    req,
  );
  const text = Array.isArray(json?.content)
    ? json.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('')
    : '';
  const usage = json?.usage
    ? { tokensIn: Number(json.usage.input_tokens) || 0, tokensOut: Number(json.usage.output_tokens) || 0, estimated: false }
    : null;
  return { text, usage, model: json?.model };
}

/**
 * Sends the request and parses the JSON reply. The timeout and the caller's abort signal cover the whole
 * exchange, body included: some providers (OpenRouter) send headers and keep-alive whitespace
 * right away and the reply only later, so a timer stopped at the headers would never fire.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchJSON(url: string, init: RequestInit, req: LLMRequest): Promise<any> {
  const controller = new AbortController();
  const timeoutMs = req.timeoutMs ?? 25000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  req.signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      throw new LLMError('http', `HTTP ${res.status}: ${detail}`, res.status);
    }
    try {
      return await res.json();
    } catch (e) {
      if (controller.signal.aborted) throw e; // reported below as timeout / aborted
      throw new LLMError('parse', 'Provider returned non-JSON body');
    }
  } catch (e) {
    if (e instanceof LLMError) throw e;
    if (timedOut) throw new LLMError('timeout', `No reply within ${timeoutMs} ms`);
    if (req.signal?.aborted) throw new LLMError('aborted', 'Request aborted');
    throw new LLMError('network', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onAbort);
  }
}

function toLLMError(e: unknown): LLMError {
  if (e instanceof LLMError) return e;
  return new LLMError('network', e instanceof Error ? e.message : String(e));
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
