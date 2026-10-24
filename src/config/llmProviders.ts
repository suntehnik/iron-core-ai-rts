import { MessageKey, t } from '../i18n';

export type LLMProviderId =
  | 'openrouter'
  | 'dashscope'
  | 'groq'
  | 'openai'
  | 'gemini'
  | 'anthropic'
  | 'proxy'
  | 'custom'
  | 'device'
  | 'offline';

/** 'native' = the on-device model of the iOS app, reached through the WebView bridge */
export type LLMProtocol = 'openai' | 'anthropic' | 'native' | 'none';

export interface LLMProviderPreset {
  id: LLMProviderId;
  /** brand name; our own providers (proxy, custom, device, offline) are localized by providerLabel() */
  label: string;
  protocol: LLMProtocol;
  baseUrl: string;
  defaultModel: string;
  needsKey: boolean;
  /** Whether the provider accepts `response_format: {type: "json_object"}` */
  jsonMode: boolean;
  keyUrl?: string;
  /** Language of the agent prompts; 'en' for models without Russian (fragments are translated on the device) */
  promptLanguage?: 'ru' | 'en';
}

/**
 * Cloud LLM presets. The brief (§10) points at fast, inexpensive models such as the
 * Qwen family, so the default is a Qwen3 MoE instruct model served via OpenRouter.
 * Every field stays editable in the settings dialog.
 */
export const LLM_PROVIDERS: Record<LLMProviderId, LLMProviderPreset> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter · Qwen',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'qwen/qwen3-30b-a3b-instruct-2507',
    needsKey: true,
    jsonMode: true,
    keyUrl: 'https://openrouter.ai/keys',
  },
  dashscope: {
    id: 'dashscope',
    label: 'Alibaba Qwen (DashScope)',
    protocol: 'openai',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-flash',
    needsKey: true,
    jsonMode: true,
    keyUrl: 'https://modelstudio.console.alibabacloud.com/',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    protocol: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'qwen/qwen3-32b',
    needsKey: true,
    jsonMode: true,
    keyUrl: 'https://console.groq.com/keys',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    needsKey: true,
    jsonMode: true,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash-lite',
    needsKey: true,
    jsonMode: true,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-haiku-5-5',
    needsKey: true,
    jsonMode: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  proxy: {
    id: 'proxy',
    label: 'Server proxy (.env)',
    protocol: 'openai',
    baseUrl: '/api/llm',
    defaultModel: '',
    needsKey: false,
    jsonMode: true,
  },
  custom: {
    id: 'custom',
    label: 'Local / OpenAI-compatible',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: 'Qwen3.6-35B-A3B-UD-MLX-4bit',
    needsKey: false,
    jsonMode: true,
  },
  device: {
    id: 'device',
    label: 'On device · Apple Intelligence',
    protocol: 'native',
    baseUrl: '',
    defaultModel: 'apple-on-device',
    needsKey: false,
    jsonMode: false,
    promptLanguage: 'en',
  },
  offline: {
    id: 'offline',
    label: 'No LLM',
    protocol: 'none',
    baseUrl: '',
    defaultModel: '',
    needsKey: false,
    jsonMode: false,
  },
};

export const PROVIDER_ORDER: LLMProviderId[] = [
  'openrouter',
  'dashscope',
  'groq',
  'openai',
  'gemini',
  'anthropic',
  'proxy',
  'custom',
  'device',
  'offline',
];

/**
 * Providers the settings dialog offers. The on-device model exists only in the iOS app. The server proxy
 * exists only where the Vite dev/preview server answered /api/llm/status: static hosting (Firebase, the
 * release zip) has no proxy, so it is hidden there unless it is the current choice, which stays visible
 * so the dialog can say why it does not work.
 */
export function visibleProviders(opts: { inApp: boolean; proxyFound: boolean; current: LLMProviderId }): LLMProviderId[] {
  return PROVIDER_ORDER.filter(id => {
    if (id === 'device') return opts.inApp;
    if (id === 'proxy') return !opts.inApp && (opts.proxyFound || opts.current === 'proxy');
    return true;
  });
}

const LOCALIZED_LABELS: Partial<Record<LLMProviderId, MessageKey>> = {
  proxy: 'provider.proxy.label',
  custom: 'provider.custom.label',
  device: 'provider.device.label',
  offline: 'provider.offline.label',
};

/** Provider name for the UI: brands as they are, our own options in the game language. */
export function providerLabel(id: LLMProviderId): string {
  const key = LOCALIZED_LABELS[id];
  return key ? t(key) : LLM_PROVIDERS[id].label;
}

/** One-line description of a provider in the game language. */
export function providerHint(id: LLMProviderId): string {
  return t(`provider.${id}.hint` as MessageKey);
}
