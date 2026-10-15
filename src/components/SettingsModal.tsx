import React, { useState } from 'react';
import { Cpu, ListRestart, PlugZap, X } from 'lucide-react';
import { LLM_PROVIDERS, LLMProviderId, PROVIDER_ORDER } from '../config/llmProviders';
import { listModels } from '../ai/llm/LLMClient';
import { GameController } from '../game/GameController';
import { LLMSettings } from '../types/agent';
import { cx } from './ui';

export const SettingsModal: React.FC<{ ctrl: GameController; onClose: () => void }> = ({ ctrl, onClose }) => {
  const [s, setS] = useState<LLMSettings>({ ...ctrl.settings });
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState('');
  const preset = LLM_PROVIDERS[s.provider];
  const proxy = ctrl.proxyStatus;

  const pick = (p: LLMProviderId) => {
    setS(prev => ({ ...prev, provider: p, ...ctrl.presetFor(p), apiKey: p === prev.provider ? prev.apiKey : '' }));
    setTest(null);
    setModels([]);
    setModelsError('');
  };

  const conn = { provider: s.provider, apiKey: s.apiKey, model: s.model, baseUrl: s.baseUrl };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    setTest(await ctrl.director.testConnection(conn));
    setTesting(false);
  };

  const loadModels = async () => {
    setModelsError('');
    try {
      const list = await listModels(conn);
      setModels(list);
      if (!list.length) setModelsError('Сервер не вернул список моделей');
    } catch (e) {
      setModelsError(`Не удалось получить список: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
    }
  };

  const save = () => {
    ctrl.applySettings(s);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="hud-panel w-full max-w-[620px] max-h-[92vh] overflow-y-auto text-slate-100">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2 font-heading font-bold">
            <Cpu className="w-5 h-5 text-teal-300" /> Облачный LLM для ботов
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Закрыть">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">Провайдер</div>
            <div className="grid grid-cols-3 gap-1.5">
              {PROVIDER_ORDER.map(id => {
                const p = LLM_PROVIDERS[id];
                const ready = id === 'proxy' ? proxy?.configured : true;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => pick(id)}
                    className={cx(
                      'text-left p-2 rounded-lg border transition',
                      s.provider === id ? 'bg-teal-600/30 border-teal-300/70' : 'bg-slate-800/60 border-white/10 hover:bg-slate-700/60',
                    )}
                  >
                    <div className="font-semibold text-[11px]">{p.label}</div>
                    <div className="text-[9px] text-slate-400 mt-0.5 leading-tight">
                      {id === 'proxy' ? (ready ? `настроен: ${proxy?.host} · ${proxy?.model || 'модель по умолчанию'}` : 'не настроен (.env.local)') : p.defaultModel || p.hint}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="text-[10px] text-slate-400 mt-1.5">{preset.hint}</div>
          </div>

          {preset.protocol !== 'none' && (
            <div className="grid grid-cols-1 gap-3">
              {s.provider !== 'proxy' && (
                <Field label="Base URL">
                  <input value={s.baseUrl} onChange={e => setS({ ...s, baseUrl: e.target.value })} className="field" spellCheck={false} />
                </Field>
              )}
              {s.provider !== 'proxy' && (
                <Field
                  label={`API-ключ ${preset.needsKey ? '' : '(если сервер требует)'}`}
                  hint={preset.keyUrl ? <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="text-teal-300 underline">получить ключ</a> : undefined}
                >
                  <input
                    type="password"
                    value={s.apiKey}
                    onChange={e => setS({ ...s, apiKey: e.target.value })}
                    placeholder="Хранится только в этом браузере (localStorage)"
                    className="field"
                    autoComplete="off"
                  />
                </Field>
              )}
              <Field
                label="Модель"
                hint={
                  preset.protocol === 'openai' ? (
                    <button type="button" onClick={loadModels} className="flex items-center gap-1 text-teal-300 hover:text-teal-200">
                      <ListRestart className="w-3 h-3" /> список моделей
                    </button>
                  ) : undefined
                }
              >
                <input
                  value={s.model}
                  onChange={e => setS({ ...s, model: e.target.value })}
                  placeholder={s.provider === 'proxy' ? 'пусто = модель из LLM_MODEL на сервере' : preset.defaultModel}
                  className="field"
                  spellCheck={false}
                />
                {models.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {models.map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setS({ ...s, model: m })}
                        className={cx(
                          'px-2 py-0.5 rounded-md border text-[10px]',
                          s.model === m ? 'bg-teal-600/40 border-teal-300/70' : 'bg-slate-800 border-white/10 hover:bg-slate-700',
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
                {modelsError && <div className="text-[10px] text-rose-300 mt-1">{modelsError}</div>}
              </Field>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={runTest}
                  disabled={testing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 font-semibold"
                >
                  <PlugZap className="w-3.5 h-3.5" /> {testing ? 'Проверяю…' : 'Проверить подключение'}
                </button>
                {test && <span className={cx('text-[11px]', test.ok ? 'text-emerald-300' : 'text-rose-300')}>{test.text}</span>}
              </div>
            </div>
          )}

          <div className="border-t border-white/10 pt-3 grid grid-cols-1 gap-2">
            <Toggle checked={s.enemyUsesLLM} onChange={v => setS({ ...s, enemyUsesLLM: v })} label="AI-противник тоже думает облачным LLM" hint="иначе — классический игровой AI на правилах" />
            <Toggle checked={s.autonomousTactics} onChange={v => setS({ ...s, autonomousTactics: v })} label="Автономные пересмотры тактики по значимым событиям" hint="не чаще одного раза в 25 с — одинаково для обоих участников" />
            <Toggle checked={s.chargeEnemyToPlayer} onChange={v => setS({ ...s, chargeEnemyToPlayer: v })} label="Включить AI-противника в мой тариф" hint="открытое решение брифа: по умолчанию не списывается" />
            <Toggle checked={s.autoSpeakResponse} onChange={v => setS({ ...s, autoSpeakResponse: v })} label="Озвучивать ответы агентов (TTS)" />
            <div className="flex items-center gap-2">
              <span className="text-slate-300">Лимит AI-монет на матч</span>
              <input
                type="range"
                min={0}
                max={200}
                step={5}
                value={s.matchCoinLimit}
                onChange={e => setS({ ...s, matchCoinLimit: Number(e.target.value) })}
                className="flex-1 accent-amber-400"
              />
              <span className="w-10 text-right font-bold text-amber-200">{s.matchCoinLimit}</span>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold">
            Отмена
          </button>
          <button type="button" onClick={save} className="px-5 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold">
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<React.PropsWithChildren<{ label: string; hint?: React.ReactNode }>> = ({ label, hint, children }) => (
  <label className="block">
    <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400 mb-1">
      <span>{label}</span>
      {hint && <span className="normal-case tracking-normal">{hint}</span>}
    </div>
    {children}
  </label>
);

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }> = ({ checked, onChange, label, hint }) => (
  <label className="flex items-start gap-2 cursor-pointer">
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 accent-teal-400" />
    <span>
      <span className="text-slate-100">{label}</span>
      {hint && <span className="block text-[10px] text-slate-400">{hint}</span>}
    </span>
  </label>
);
