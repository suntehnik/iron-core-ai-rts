import React from 'react';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { AI_TARIFFS } from '../config/tariffs';
import { ServiceStats } from '../ai/AIBilling';
import { GameController } from '../game/GameController';
import { cx, fmtCoins } from './ui';

const Row: React.FC<{ name: string; hint: string; s: ServiceStats; audio?: boolean; muted?: boolean }> = ({ name, hint, s, audio, muted }) => (
  <tr className={cx('border-t border-white/5', muted && 'opacity-70')}>
    <td className="py-1 pr-2">
      <div className="text-slate-100 font-semibold">{name}</div>
      <div className="text-[9px] text-slate-400">{hint}</div>
    </td>
    <td className="text-right tabular-nums">{s.calls}{s.errors ? <span className="text-rose-300"> /{s.errors}✕</span> : null}</td>
    <td className="text-right tabular-nums text-slate-300">
      {audio ? `${s.seconds.toFixed(1)} с` : `${s.tokensIn}/${s.tokensOut}`}
    </td>
    <td className="text-right tabular-nums text-slate-300">{s.calls ? `${Math.round(s.totalLatencyMs / s.calls)} мс` : '—'}</td>
    <td className="text-right tabular-nums text-amber-200 font-semibold">{fmtCoins(s.coins)}</td>
  </tr>
);

/** Transparent AI spending (brief §10): balance, match spend, four services, per-match limit. */
export const CoinPanel: React.FC<{ ctrl: GameController; onClose: () => void }> = ({ ctrl, onClose }) => {
  const b = ctrl.director.billing.snapshot();
  const setLimit = (v: number) => ctrl.applySettings({ ...ctrl.settings, matchCoinLimit: v });
  return (
    <div className="hud-panel pointer-events-auto w-[430px] p-3 text-[11px] text-slate-200">
      <div className="flex items-center justify-between mb-2">
        <div className="font-heading font-bold uppercase tracking-wider text-xs">AI-монеты · расход за матч</div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Закрыть">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <Stat label="Баланс (тест)" value={fmtCoins(b.wallet)} />
        <Stat label="Потрачено в матче" value={fmtCoins(b.spentThisMatch)} />
        <Stat label="Доступно" value={fmtCoins(b.remaining)} tone={b.status} />
      </div>
      {b.status !== 'ok' && (
        <div className={cx('flex gap-2 items-start p-2 rounded-lg mb-2', b.status === 'low' ? 'bg-amber-500/15 text-amber-100' : 'bg-rose-500/15 text-rose-100')}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {b.status === 'low'
              ? 'Монеты на исходе: скоро новые AI-запросы станут недоступны. Армия продолжит последний утверждённый план обычным игровым AI.'
              : 'AI-запросы недоступны: исполняется последний допустимый план, агенты отвечают локальными эвристиками.'}
          </span>
        </div>
      )}
      <table className="w-full">
        <thead className="text-[9px] uppercase tracking-wider text-slate-400">
          <tr>
            <th className="text-left font-semibold pb-1">Сервис</th>
            <th className="text-right font-semibold">Вызовы</th>
            <th className="text-right font-semibold">Токены вх/вых</th>
            <th className="text-right font-semibold">Отклик</th>
            <th className="text-right font-semibold">Монеты</th>
          </tr>
        </thead>
        <tbody>
          <Row name="Агент производства" hint="проекты, партии, очереди" s={b.services.production} />
          <Row name="Агенты управления" hint="тактические планы, пересмотры" s={b.services.tactical} />
          <Row name="Распознавание речи" hint="ASR, голосовые приказы" s={b.services.asr} audio />
          <Row name="Синтез речи" hint="TTS, ответы агентов" s={b.services.tts} audio />
          {(ctrl.mode === 'spectator' || b.ally.calls > 0) && (
            <Row name="ИИ-союзник (ИИ против ИИ)" hint="Командор Бирюзов, не списывается" s={b.ally} muted />
          )}
          <Row
            name="AI-противник"
            hint={b.chargeEnemyToPlayer ? 'включён в ваш тариф' : 'не списывается с вашего баланса'}
            s={b.enemy}
            muted={!b.chargeEnemyToPlayer}
          />
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-slate-400 whitespace-nowrap">Лимит на матч</span>
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={b.matchLimit}
          onChange={e => setLimit(Number(e.target.value))}
          className="flex-1 accent-amber-400"
          aria-label="Лимит AI-расходов на матч"
        />
        <span className="w-10 text-right font-bold text-amber-200 tabular-nums">{b.matchLimit}</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
        <span>
          Тариф: {AI_TARIFFS.LLM_INPUT_PER_1K}/{AI_TARIFFS.LLM_OUTPUT_PER_1K} за 1K токенов, ASR {AI_TARIFFS.ASR_PER_SEC}/с, TTS {AI_TARIFFS.TTS_PER_SEC}/с. Ошибки не списываются.
        </span>
        <button
          type="button"
          onClick={() => ctrl.topUpTestBalance()}
          className="ml-2 shrink-0 flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-100 hover:bg-amber-500/30"
        >
          <Plus className="w-3 h-3" /> Тест-баланс
        </button>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; tone?: 'ok' | 'low' | 'exhausted' }> = ({ label, value, tone }) => (
  <div className="rounded-lg bg-slate-800/70 border border-white/5 px-2 py-1.5">
    <div className="text-[9px] uppercase tracking-wider text-slate-400">{label}</div>
    <div className={cx('font-heading font-bold text-base tabular-nums', tone === 'low' ? 'text-amber-300' : tone === 'exhausted' ? 'text-rose-300' : 'text-slate-50')}>
      {value}
    </div>
  </div>
);
