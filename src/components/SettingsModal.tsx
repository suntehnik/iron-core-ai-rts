import React, { useState } from 'react';
import { LLMProviderType, LLMSettings } from '../types/agent';
import { X, Key, Cpu, Volume2, Shield, Sparkles } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: LLMSettings;
  onSaveSettings: (settings: LLMSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
}) => {
  const [provider, setProvider] = useState<LLMProviderType>(settings.provider);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState(settings.model);
  const [apiEndpoint, setApiEndpoint] = useState(settings.apiEndpoint || '');
  const [autoSpeak, setAutoSpeak] = useState(settings.autoSpeakResponse);
  const [coinLimit, setCoinLimit] = useState(settings.aiCoinLimit);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveSettings({
      provider,
      apiKey,
      model,
      apiEndpoint: apiEndpoint.trim() || undefined,
      autoSpeakResponse: autoSpeak,
      aiCoinLimit: coinLimit,
    });
    onClose();
  };

  const handleProviderChange = (p: LLMProviderType) => {
    setProvider(p);
    if (p === 'gemini') {
      setModel('gemini-1.5-flash');
      setApiEndpoint('');
    } else if (p === 'openai') {
      setModel('gpt-4o-mini');
      setApiEndpoint('https://api.openai.com/v1/chat/completions');
    } else if (p === 'groq') {
      setModel('llama-3.1-70b-versatile');
      setApiEndpoint('https://api.groq.com/openai/v1/chat/completions');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-800/40">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-cyan-400" />
            <h2 className="font-heading font-bold text-slate-100 text-base">
              Конфигурация облачного LLM API
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-4 text-xs">
          {/* Provider Selection */}
          <div>
            <label className="block text-slate-400 font-semibold mb-1.5 uppercase tracking-wider text-[11px]">
              Провайдер искусственного интеллекта
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleProviderChange('gemini')}
                className={`p-2.5 rounded-xl border text-left transition ${
                  provider === 'gemini'
                    ? 'bg-blue-600/30 border-blue-400 text-white font-bold'
                    : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                Google Gemini
                <div className="text-[10px] text-slate-400 font-normal mt-0.5">Flash 1.5 / 2.0</div>
              </button>

              <button
                type="button"
                onClick={() => handleProviderChange('openai')}
                className={`p-2.5 rounded-xl border text-left transition ${
                  provider === 'openai'
                    ? 'bg-blue-600/30 border-blue-400 text-white font-bold'
                    : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                OpenAI
                <div className="text-[10px] text-slate-400 font-normal mt-0.5">GPT-4o mini</div>
              </button>

              <button
                type="button"
                onClick={() => handleProviderChange('groq')}
                className={`p-2.5 rounded-xl border text-left transition ${
                  provider === 'groq'
                    ? 'bg-blue-600/30 border-blue-400 text-white font-bold'
                    : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                Groq (Ultra-Fast)
                <div className="text-[10px] text-slate-400 font-normal mt-0.5">Llama 3.1</div>
              </button>

              <button
                type="button"
                onClick={() => handleProviderChange('mock')}
                className={`p-2.5 rounded-xl border text-left transition ${
                  provider === 'mock'
                    ? 'bg-emerald-600/30 border-emerald-400 text-white font-bold'
                    : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                Локальный сопроцессор
                <div className="text-[10px] text-emerald-400 font-normal mt-0.5">Без API-ключа</div>
              </button>
            </div>
          </div>

          {/* API Key (if not mock) */}
          {provider !== 'mock' && (
            <div>
              <label className="block text-slate-400 font-semibold mb-1 uppercase tracking-wider text-[11px] flex items-center justify-between">
                <span>API Ключ ({provider.toUpperCase()})</span>
                <span className="text-slate-500 font-normal text-[10px]">Хранится локально</span>
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={`Вставьте ваш ${provider} API ключ...`}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>
          )}

          {/* Model Name */}
          {provider !== 'mock' && (
            <div>
              <label className="block text-slate-400 font-semibold mb-1 uppercase tracking-wider text-[11px]">
                Идентификатор модели
              </label>
              <input
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="gemini-1.5-flash / gpt-4o-mini"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
              />
            </div>
          )}

          {/* Custom API Endpoint */}
          {(provider === 'openai' || provider === 'groq') && (
            <div>
              <label className="block text-slate-400 font-semibold mb-1 uppercase tracking-wider text-[11px]">
                API Endpoint (Опционально)
              </label>
              <input
                type="text"
                value={apiEndpoint}
                onChange={e => setApiEndpoint(e.target.value)}
                placeholder="https://api.openai.com/v1/chat/completions"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
              />
            </div>
          )}

          {/* Audio & Coin toggles */}
          <div className="pt-2 border-t border-slate-800 flex flex-col gap-2.5">
            <label className="flex items-center gap-2 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={autoSpeak}
                onChange={e => setAutoSpeak(e.target.checked)}
                className="rounded bg-slate-800 border-slate-700 text-blue-500 focus:ring-0"
              />
              <span>Озвучивать ответы инженера синтезом речи (TTS)</span>
            </label>

            <div className="flex items-center justify-between text-slate-400 pt-1">
              <span>Лимит AI-монет на матч:</span>
              <span className="font-bold text-amber-400">{coinLimit} монет</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-800/40 border-t border-slate-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg transition"
          >
            Сохранить настройки
          </button>
        </div>
      </div>
    </div>
  );
};
