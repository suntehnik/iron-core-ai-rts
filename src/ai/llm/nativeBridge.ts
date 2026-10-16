/**
 * Bridge to the on-device model of the iOS app (Apple Foundation Models + Apple Translation).
 * The Swift side registers a WKScriptMessageHandlerWithReply named `ironcoreLLM`; every
 * postMessage resolves with the reply or rejects with the native error text.
 * Outside the iOS app the handler does not exist and the "device" provider stays hidden.
 */

import { t } from '../../i18n';

export type TranslationStatus = 'installed' | 'supported' | 'unsupported' | 'unknown';

export interface NativeStatus {
  /** the on-device model can generate right now */
  available: boolean;
  /** why not: deviceNotEligible | appleIntelligenceNotEnabled | modelNotReady | … */
  reason?: string;
  /** ru⇄en on-device translation: installed, downloadable, or impossible */
  translation: TranslationStatus;
  contextSize?: number;
}

export interface NativeGenerateRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}

export interface NativeGenerateReply {
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** token counts are estimates (the exact API needs iOS 26.4) */
  estimated: boolean;
}

interface Handler {
  postMessage(message: unknown): Promise<unknown>;
}

function handler(): Handler | null {
  const w = globalThis as { webkit?: { messageHandlers?: { ironcoreLLM?: Handler } } };
  return w.webkit?.messageHandlers?.ironcoreLLM ?? null;
}

/** True inside the iOS app (the native handler is installed). */
export function hasNativeBridge(): boolean {
  return handler() !== null;
}

let status: NativeStatus | null = null;

/** Last known status of the on-device model; null until refreshed or outside the iOS app. */
export function nativeStatus(): NativeStatus | null {
  return status;
}

export async function refreshNativeStatus(): Promise<NativeStatus | null> {
  const h = handler();
  if (!h) return (status = null);
  try {
    status = (await h.postMessage({ op: 'status' })) as NativeStatus;
  } catch (e) {
    status = { available: false, reason: e instanceof Error ? e.message : String(e), translation: 'unknown' };
  }
  return status;
}

export async function nativeGenerate(req: NativeGenerateRequest): Promise<NativeGenerateReply> {
  const h = handler();
  if (!h) throw new Error('on-device model bridge is missing');
  return (await h.postMessage({ op: 'generate', ...req })) as NativeGenerateReply;
}

/** On-device translation; `from`/`to` are BCP-47 language codes such as "ru" and "en". */
export async function nativeTranslate(texts: string[], from: string, to: string): Promise<string[]> {
  const h = handler();
  if (!h) throw new Error('on-device model bridge is missing');
  if (!texts.length) return [];
  const out = (await h.postMessage({ op: 'translate', texts, from, to })) as { texts: string[] };
  if (!Array.isArray(out?.texts) || out.texts.length !== texts.length) throw new Error('translation reply does not match the request');
  return out.texts;
}

let translationAsked = false;

/**
 * Asks the app to download the ru⇄en translation languages (a system sheet), once per launch;
 * only the Russian game needs them, so the app does not offer the download by itself.
 */
export async function nativePrepareTranslation(): Promise<void> {
  const h = handler();
  if (!h || translationAsked || status?.translation !== 'supported') return;
  translationAsked = true;
  try {
    await h.postMessage({ op: 'prepareTranslation' });
  } catch {
    /* an older app build without the op: translation stays unavailable */
  }
}

// ───────────────────────────── Translation marks ─────────────────────────────

/**
 * Russian fragments inside an English prompt (an order, an event, a model name) are wrapped in
 * these marks and translated on the device before generation.
 */
export function markRussian(text: string): string {
  const clean = text.replace(/[⟦⟧]/g, '').trim();
  return clean ? `⟦${clean}⟧` : '';
}

const MARKED = /⟦([^⟦⟧]*)⟧/g;

/** Replaces every marked fragment with its translation; `translate` gets each unique fragment once. */
export async function resolveMarked(texts: string[], translate: (fragments: string[]) => Promise<string[]>): Promise<string[]> {
  const fragments = [...new Set(texts.flatMap(t => [...t.matchAll(MARKED)].map(m => m[1])))];
  let map = new Map<string, string>();
  if (fragments.length) {
    try {
      const out = await translate(fragments);
      map = new Map(fragments.map((f, i) => [f, out[i] || f]));
    } catch {
      /* translation unavailable: the model gets the original fragments */
    }
  }
  return texts.map(t => t.replace(MARKED, (_, f: string) => map.get(f) ?? f));
}

/** Reply fields a player reads; everything else (ids, enums, numbers) stays as the model wrote it. */
const READABLE_KEYS = new Set(['reply', 'compromise', 'taunt', 'summary', 'name']);

/** Translates the human-readable string fields of a reply in place (nested objects included). */
export async function translateReadableFields(data: Record<string, unknown>, translate: (texts: string[]) => Promise<string[]>) {
  const slots: { obj: Record<string, unknown>; key: string }[] = [];
  const walk = (o: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && v.trim() && READABLE_KEYS.has(k)) slots.push({ obj: o, key: k });
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v as Record<string, unknown>);
    }
  };
  walk(data);
  if (!slots.length) return;
  try {
    const out = await translate(slots.map(s => s.obj[s.key] as string));
    slots.forEach((s, i) => {
      if (out[i]) s.obj[s.key] = out[i];
    });
  } catch {
    /* keep the English text */
  }
}

/** Why the on-device model cannot answer, for the player. */
export function nativeUnavailableText(s: NativeStatus | null): string {
  if (!s) return t('device.noBridge');
  switch (s.reason) {
    case 'deviceNotEligible':
      return t('device.notEligible');
    case 'appleIntelligenceNotEnabled':
      return t('device.aiOff');
    case 'modelNotReady':
      return t('device.modelNotReady');
    default:
      return s.reason ? t('device.unavailableWhy', { why: s.reason }) : t('device.unavailable');
  }
}

/**
 * The iOS side reports failures as codes (`context`, `guardrail`, `simulator:-1`, …) so the text
 * follows the game language; anything else is shown as it came.
 */
export function deviceErrorText(code: string): string {
  const [kind, detail = ''] = code.split(':');
  switch (kind) {
    case 'context':
      return t('device.err.context');
    case 'guardrail':
      return t('device.err.guardrail');
    case 'refusal':
      return t('device.err.refusal');
    case 'language':
      return t('device.err.language');
    case 'assets':
      return t('device.err.assets');
    case 'busy':
      return t('device.err.busy');
    case 'timeout':
      return t('device.err.timeout');
    case 'simulator':
      return t('device.err.simulator', { code: detail });
    case 'translation':
      return t('device.err.translation');
    default:
      return code;
  }
}
