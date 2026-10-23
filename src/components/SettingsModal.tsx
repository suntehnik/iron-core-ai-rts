import React, { useState } from 'react';
import { Cpu, ListRestart, PlugZap, X } from 'lucide-react';
import { GAME_BALANCE } from '../config/balance';
import { LLM_PROVIDERS, LLMProviderId, PROVIDER_ORDER, providerHint, providerLabel } from '../config/llmProviders';
import { listModels } from '../ai/llm/LLMClient';
import { TranslationStatus, hasNativeBridge, nativeStatus, nativeUnavailableText } from '../ai/llm/nativeBridge';
import { GameController } from '../game/GameController';
import { analytics } from '../analytics';
import { LLMSettings } from '../types/agent';
import { LanguageSwitch, cx } from './ui';
import { Lang, t } from '../i18n';

export const SettingsModal: React.FC<{ ctrl: GameController; onClose: () => void }> = ({ ctrl, onClose }) => {
  const [s, setS] = useState<LLMSettings>({ ...ctrl.settings });
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState('');
  const [stats, setStats] = useState(analytics.consent === 'granted');
  const preset = LLM_PROVIDERS[s.provider];
  const proxy = ctrl.proxyStatus;
  // In the iOS app there is the on-device model and no dev-server proxy; in a browser it is the other way round
  const inApp = hasNativeBridge();
  const device = nativeStatus();
  const providers = PROVIDER_ORDER.filter(id => (id === 'device' ? inApp : id === 'proxy' ? !inApp : true));

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
    setTest(await ctrl.testConnection(conn));
    setTesting(false);
  };

  const loadModels = async () => {
    setModelsError('');
    try {
      const list = await listModels(conn);
      setModels(list);
      if (!list.length) setModelsError(t('set.noModels'));
    } catch (e) {
      setModelsError(t('set.modelsFailed', { err: e instanceof Error ? e.message.slice(0, 120) : String(e) }));
    }
  };

  const save = () => {
    ctrl.applySettings(s);
    // an untouched switch is not an answer: the start screen still asks
    if (stats !== (analytics.consent === 'granted')) analytics.setConsent(stats);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="hud-panel w-full max-w-[620px] max-h-[92vh] overflow-y-auto text-slate-100">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2 font-heading font-bold">
            <Cpu className="w-5 h-5 text-teal-300" /> {t('set.title')}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white" aria-label={t('common.close')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">{t('brief.language')}</div>
            <LanguageSwitch value={ctrl.language} onChange={lang => ctrl.setLanguage(lang)} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">{t('set.provider')}</div>
            <div className="grid grid-cols-3 gap-1.5">
              {providers.map(id => {
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
                    <div className="font-semibold text-[11px]">{providerLabel(id)}</div>
                    <div className="text-[9px] text-slate-400 mt-0.5 leading-tight">
                      {id === 'proxy'
                        ? ready
                          ? t('set.proxyReady', { host: proxy?.host ?? '', model: proxy?.model || t('set.defaultModel') })
                          : t('set.proxyMissing')
                        : id === 'device'
                          ? device?.available
                            ? t('set.deviceReady')
                            : nativeUnavailableText(device)
                          : p.defaultModel || providerHint(id)}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="text-[10px] text-slate-400 mt-1.5">{providerHint(s.provider)}</div>
          </div>

          {preset.protocol === 'native' && (
            <div className="rounded-lg bg-slate-800/60 border border-white/10 p-2.5 leading-relaxed">
              <div>
                {t('set.deviceModel')}<b>{device?.available ? t('set.ready') : nativeUnavailableText(device)}</b>
                {device?.contextSize ? t('set.window', { n: device.contextSize }) : ''}
              </div>
              <div>
                {t('set.translation')}
                <b>{translationText(ctrl.language, device?.translation)}</b>
              </div>
            </div>
          )}

          {(preset.protocol === 'openai' || preset.protocol === 'anthropic') && (
            <div className="grid grid-cols-1 gap-3">
              {s.provider !== 'proxy' && (
                <Field label="Base URL">
                  <input value={s.baseUrl} onChange={e => setS({ ...s, baseUrl: e.target.value })} className="field" spellCheck={false} />
                </Field>
              )}
              {s.provider !== 'proxy' && (
                <Field
                  label={preset.needsKey ? t('set.apiKey') : t('set.apiKeyOptional')}
                  hint={preset.keyUrl ? <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="text-teal-300 underline">{t('set.getKey')}</a> : undefined}
                >
                  <input
                    type="password"
                    value={s.apiKey}
                    onChange={e => setS({ ...s, apiKey: e.target.value })}
                    placeholder={t('set.keyPlaceholder')}
                    className="field"
                    autoComplete="off"
                  />
                </Field>
              )}
              <Field
                label={t('set.model')}
                hint={
                  preset.protocol === 'openai' ? (
                    <button type="button" onClick={loadModels} className="flex items-center gap-1 text-teal-300 hover:text-teal-200">
                      <ListRestart className="w-3 h-3" /> {t('set.modelList')}
                    </button>
                  ) : undefined
                }
              >
                <input
                  value={s.model}
                  onChange={e => setS({ ...s, model: e.target.value })}
                  placeholder={s.provider === 'proxy' ? t('set.proxyModelPlaceholder') : preset.defaultModel}
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
                  <PlugZap className="w-3.5 h-3.5" /> {testing ? t('set.testing') : t('set.test')}
                </button>
                {test && <span className={cx('text-[11px]', test.ok ? 'text-emerald-300' : 'text-rose-300')}>{test.text}</span>}
              </div>
            </div>
          )}

          <div className="border-t border-white/10 pt-3 grid grid-cols-1 gap-2">
            <Toggle checked={s.enemyUsesLLM} onChange={v => setS({ ...s, enemyUsesLLM: v })} label={t('set.enemyLlm')} hint={t('set.enemyLlmHint')} />
            <Toggle checked={s.autonomousTactics} onChange={v => setS({ ...s, autonomousTactics: v })} label={t('set.autoTactics')} hint={t('set.autoTacticsHint', { n: GAME_BALANCE.AI_EVENT_REPLAN_COOLDOWN_SEC })} />
            <Toggle checked={s.chargeEnemyToPlayer} onChange={v => setS({ ...s, chargeEnemyToPlayer: v })} label={t('set.chargeEnemy')} hint={t('set.chargeEnemyHint')} />
            <Toggle checked={s.autoSpeakResponse} onChange={v => setS({ ...s, autoSpeakResponse: v })} label={t('set.speak')} />
            {analytics.available && (
              <Toggle
                checked={stats}
                onChange={setStats}
                label={t('set.stats')}
                hint={analytics.debug ? `${t('set.statsHint')} ${t('set.statsDebug')}` : t('set.statsHint')}
              />
            )}
            <div className="flex items-center gap-2">
              <span className="text-slate-300">{t('set.coinLimit')}</span>
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
            {t('common.cancel')}
          </button>
          <button type="button" onClick={save} className="px-5 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold">
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

const TRANSLATION_KEY = { installed: 'set.trInstalled', supported: 'set.trSupported', unsupported: 'set.trUnsupported', unknown: 'set.trUnknown' } as const;

/** Only the Russian game translates for the on-device model; it speaks English and Italian itself. */
function translationText(lang: Lang, status: TranslationStatus | undefined): string {
  return lang === 'ru' ? t(TRANSLATION_KEY[status ?? 'unknown']) : t('set.trNotNeeded');
}

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
