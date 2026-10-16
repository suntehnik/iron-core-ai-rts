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
  label: string;
  hint: string;
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
    hint: 'Рекомендуется: быстрые недорогие модели Qwen, работает прямо из браузера',
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
    hint: 'Официальный API Qwen. Если браузер блокирует CORS — используйте серверный прокси',
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
    hint: 'Очень низкая задержка, модель Qwen3 32B',
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
    hint: 'Любая chat-completions модель OpenAI',
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
    hint: 'OpenAI-совместимый эндпоинт Gemini',
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
    hint: 'Claude Haiku через Messages API',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-haiku-5-5',
    needsKey: true,
    jsonMode: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  proxy: {
    id: 'proxy',
    label: 'Серверный прокси (.env)',
    hint: 'Ключ хранится на dev-сервере (LLM_API_KEY в .env.local) и не попадает в браузер',
    protocol: 'openai',
    baseUrl: '/api/llm',
    defaultModel: '',
    needsKey: false,
    jsonMode: true,
  },
  custom: {
    id: 'custom',
    label: 'Локальный / свой OpenAI-совместимый',
    hint: 'oMLX, vLLM, LM Studio, Ollama, корпоративный шлюз… (сервер должен разрешать CORS)',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: 'Qwen3.6-35B-A3B-UD-MLX-4bit',
    needsKey: false,
    jsonMode: true,
  },
  device: {
    id: 'device',
    label: 'На устройстве · Apple Intelligence',
    hint: 'Модель Apple на Neural Engine, без сети и ключей. Она не знает русского: агенты думают на английском, а приказы и ответы переводятся на устройстве',
    protocol: 'native',
    baseUrl: '',
    defaultModel: 'apple-on-device',
    needsKey: false,
    jsonMode: false,
    promptLanguage: 'en',
  },
  offline: {
    id: 'offline',
    label: 'Без облака',
    hint: 'Агенты работают на локальных эвристиках — для проверки без ключа',
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
