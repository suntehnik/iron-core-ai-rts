import { LLM_PROVIDERS, LLMProviderId } from '../../config/llmProviders';
import { estimateTokens, extractJSONObject } from './jsonExtract';
import { deviceErrorText, nativeGenerate, nativeStatus, nativeTranslate, resolveMarked, translateReadableFields } from './nativeBridge';
import { getLanguage, t } from '../../i18n';

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

export type LLMErrorKind = 'not_configured' | 'network' | 'http' | 'timeout' | 'parse' | 'aborted' | 'device';

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
        return t('llm.notConfigured');
      case 'timeout':
        return t('llm.timeout');
      case 'network':
        return t('llm.network');
      case 'parse':
        return t('llm.parse');
      case 'aborted':
        return t('llm.aborted');
      case 'device':
        return t('llm.device', { msg: deviceErrorText(this.message) });
      default:
        if (this.status === 401 || this.status === 403) return t('llm.keyRejected');
        if (this.status === 429) return t('llm.rateLimited');
        return t('llm.http', { status: this.status ?? '?' });
    }
  }
}

export function cloudReady(c: LLMConnection): boolean {
  const preset = LLM_PROVIDERS[c.provider];
  if (!preset || preset.protocol === 'none') return false;
  if (preset.protocol === 'native') return !!nativeStatus()?.available;
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
  if (preset.protocol === 'native') return chatOnDevice(req);
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
      if (err.kind === 'http' && err.status === 400 && preset.protocol === 'openai') {
        // A reasoning model that wants another effort names the ones it takes: retry with the lowest
        if (conn.provider === 'openai' && learnReasoningEffort(conn.model, err.message)) continue;
        if (!minimal) {
          minimal = true;
          continue;
        }
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

/**
 * The on-device model (iOS app): the prompt's Russian fragments (marked by the English prompt set)
 * are translated to English first; the fields a player reads come back translated to Russian.
 * One attempt only: a local model that failed will fail the same way again.
 */
async function chatOnDevice(req: LLMRequest): Promise<LLMResponse> {
  const started = performance.now();
  const timeoutMs = req.timeoutMs ?? 25000;
  // Only the Russian game needs translation: the model itself speaks English and Italian
  const translate = getLanguage() === 'ru';
  const [system, user] = translate ? await resolveMarked([req.system, req.user], f => nativeTranslate(f, 'ru', 'en')) : [req.system, req.user];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LLMError('timeout', `No reply within ${timeoutMs} ms`)), timeoutMs);
  });
  let reply;
  try {
    reply = await Promise.race([
      nativeGenerate({ system, user, maxTokens: req.maxTokens, temperature: req.temperature ?? 0.4, timeoutMs }),
      timeout,
    ]);
  } catch (e) {
    if (e instanceof LLMError) throw e;
    throw new LLMError('device', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
  const data = extractJSONObject(reply.text);
  if (!data) throw new LLMError('parse', `Model reply is not JSON: ${reply.text.slice(0, 160)}`);
  if (translate) await translateReadableFields(data, texts => nativeTranslate(texts, 'en', 'ru'));
  return {
    data,
    text: reply.text,
    usage: { tokensIn: reply.tokensIn, tokensOut: reply.tokensOut, estimated: reply.estimated },
    latencyMs: Math.round(performance.now() - started),
    model: 'apple-on-device',
    attempts: 1,
  };
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

  const model = conn.model.trim();
  const body: Record<string, unknown> = {
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
  };
  if (model) body.model = model;
  // OpenAI's own API: max_tokens is deprecated in favour of max_completion_tokens and rejected by
  // reasoning models, so every OpenAI model gets the new one. Reasoning models take only the default
  // temperature and spend part of the budget on hidden reasoning. Other servers keep max_tokens.
  const openai = conn.provider === 'openai';
  const effort = openai ? openAIReasoningEffort(model) : null;
  body[openai ? 'max_completion_tokens' : 'max_tokens'] = effort ? req.maxTokens + REASONING_HEADROOM_TOKENS : req.maxTokens;
  if (!effort) body.temperature = req.temperature ?? 0.4;
  if (!minimal) {
    if (effort) body.reasoning_effort = effort;
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

/**
 * Extra output budget for OpenAI's hidden reasoning. Billing follows the tokens actually used; at the
 * lowest effort our short JSON answers need far less, the cap only keeps a long think from cutting the answer.
 */
const REASONING_HEADROOM_TOKENS = 4000;

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Efforts learned from OpenAI's replies, per model, for this session */
const learnedEffort = new Map<string, ReasoningEffort>();

/**
 * The reasoning effort to ask an OpenAI model for: the lowest it takes, or null for a model without
 * reasoning (gpt-4.1, gpt-4o, the chat models). Per the model docs: gpt-5, gpt-5-mini and gpt-5-nano
 * start at "minimal", the o-series at "low", gpt-5.1 and later (gpt-5.5, gpt-5.6, gpt-6 Sol, gpt-6 Luna)
 * take "none". Models that do not (gpt-6 Astra, gpt-6.1 Sol, the pro models) name the efforts they take
 * in the HTTP 400 reply, and learnReasoningEffort() picks from those.
 */
export function openAIReasoningEffort(model: string): ReasoningEffort | null {
  const m = model.trim().toLowerCase();
  if (!/^(gpt-([5-9]|\d{2,})|o\d)/.test(m) || /chat/.test(m)) return null;
  const learned = learnedEffort.get(m);
  if (learned) return learned;
  if (/^o\d/.test(m)) return 'low';
  if (/^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/.test(m)) return 'minimal';
  return 'none';
}

/**
 * OpenAI rejects an effort a model does not take with a list of the ones it does ("Supported values
 * are: 'low', 'medium', …"); remembers the lowest of them. True if there is a new effort to retry with.
 */
export function learnReasoningEffort(model: string, error: string): boolean {
  if (!/reasoning/i.test(error)) return false;
  const listed = error.match(/supported values are:?([^.]*)/i)?.[1] ?? '';
  const lowest = REASONING_EFFORTS.find(e => new RegExp(`'${e}'`).test(listed));
  const m = model.trim().toLowerCase();
  if (!lowest || lowest === openAIReasoningEffort(m)) return false;
  learnedEffort.set(m, lowest);
  return true;
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
        detail = (await res.text()).slice(0, 600);
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
