import React from 'react';
import { FlaskConical } from 'lucide-react';
import { TrialSummary } from '../engine/DesignTrial';
import { GameController } from '../game/GameController';
import { ProgressBar, cx } from './ui';
import { t } from '../i18n';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const winTone = (v: number) => (v >= 0.6 ? 'text-emerald-300' : v >= 0.4 ? 'text-amber-200' : 'text-rose-300');

/** Test bench result for the pending design (brief §9): win rate, fight length, HP left, vs the serial model. */
export const TrialPanel: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const trial = ctrl.trial;
  if (!trial || trial.proposalId !== ctrl.proposal?.id) return null;
  const r = trial.report;
  const opponentLabel = r.opponentSource === 'observed' ? t('trial.observed') : t('trial.baseline');

  if (trial.status === 'running') {
    const total = Math.max(0.01, trial.readyAt - trial.startedAt);
    const progress = (ctrl.state.gameTime - trial.startedAt) / total;
    return (
      <div className="mt-1.5 rounded-lg bg-slate-900/60 border border-cyan-400/20 p-2 text-[10px] text-slate-300">
        <div className="flex items-center gap-1.5 text-cyan-200 font-semibold">
          <FlaskConical className="w-3.5 h-3.5 animate-pulse" />
          {t('trial.running', { n: r.opponentCount, candidate: r.candidate.design.name, opponent: r.opponent.name })}
        </div>
        <ProgressBar value={progress} color="#22d3ee" className="mt-1.5" />
        {ctrl.state.isPaused && <div className="mt-1 text-amber-200">{t('trial.pausedWait')}</div>}
      </div>
    );
  }

  return (
    <div className="mt-1.5 rounded-lg bg-slate-900/60 border border-cyan-400/20 p-2 text-[10px] text-slate-300" data-testid="trial-result">
      <div className="flex items-center gap-1.5 text-cyan-200 font-semibold">
        <FlaskConical className="w-3.5 h-3.5" />
        <span className="truncate" title={`${r.opponent.name}: ${opponentLabel}`}>
          {t('trial.against', { opponent: r.opponent.name, count: r.candidate.count, n: r.opponentCount })} · {t('trial.fights', { count: r.candidate.runs.length })}
        </span>
      </div>
      <table className="w-full mt-1 tabular-nums">
        <thead className="text-[9px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left font-semibold">{t('trial.design')}</th>
            <th className="text-right font-semibold">{t('trial.wins')}</th>
            <th className="text-right font-semibold">{t('trial.fight')}</th>
            <th className="text-right font-semibold">{t('trial.hpLeft')}</th>
          </tr>
        </thead>
        <tbody>
          <Row label={t('trial.candidate')} s={r.candidate} highlight />
          {r.serial && <Row label={t('trial.serial')} s={r.serial} />}
          {r.equalBudget && <Row label={t('trial.equalBudget', { count: r.equalBudget.count, n: r.opponentCount })} s={r.equalBudget} />}
        </tbody>
      </table>
      <div className="mt-1 text-slate-400">
        {t('trial.cost', { a: r.candidateCost, b: r.opponentCost })} {r.opponentSource === 'baseline' && t('trial.noIntel')}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; s: TrialSummary; highlight?: boolean }> = ({ label, s, highlight }) => (
  <tr className={cx(highlight && 'text-slate-100 font-semibold')}>
    <td className="text-left py-0.5">{label}</td>
    <td className={cx('text-right', winTone(s.winRate))}>{pct(s.winRate)}</td>
    <td className="text-right">{t('unit.sec', { n: s.avgDuration.toFixed(0) })}</td>
    <td className="text-right">{pct(s.avgHpLeft)}</td>
  </tr>
);
