import React from 'react';
import { GameController } from '../game/GameController';
import { GeneralPortrait } from './Portraits';
import { cx } from './ui';
import { t } from '../i18n';
import { commanderName } from '../config/commanders';

/** Intercepted radio from the LLM-driven enemy commander (humour allowed by the brief §7). */
export const InterceptPanel: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const last = ctrl.intercepts[0];
  const call = ctrl.director.lastCall.enemy;
  const enemy = ctrl.state.teams.enemy;
  if (!last && !call) return null;
  return (
    <div className="hud-panel pointer-events-auto w-[300px] p-2 flex gap-2 items-start">
      <GeneralPortrait size={38} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-heading font-bold text-orange-300 tracking-wide">{t('intercept.title', { name: commanderName('enemy').toUpperCase() })}</span>
          {call && (
            <span className={cx(call.source === 'llm' ? 'text-emerald-300' : 'text-amber-300')}>
              {call.source === 'llm' ? 'LLM' : t('source.rules')}
            </span>
          )}
        </div>
        {last && <div className="text-[11px] text-slate-100 leading-snug mt-0.5">«{last.text}»</div>}
        <div className="text-[10px] text-slate-400 mt-0.5 truncate" title={enemy.plan.summaryRu}>
          {t('hud.series', { name: enemy.design.name })} · {enemy.plan.summaryRu}
        </div>
      </div>
    </div>
  );
};

export const Notices: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const now = performance.now();
  const list = ctrl.notices.filter(n => now - n.time < (n.tone === 'warn' ? 9000 : 3500)).slice(0, 1);
  if (!list.length) return null;
  return (
    <div className="hud-notices" role="status">
      {list.map(n => (
        <div
          key={n.id}
          className={cx(
            'hud-panel px-3 py-1.5 text-xs max-w-[520px] text-center',
            n.tone === 'warn' ? 'text-amber-100 ring-1 ring-amber-400/60' : 'text-slate-100',
          )}
        >
          {n.text}
        </div>
      ))}
    </div>
  );
};
