import React from 'react';
import { FlaskConical } from 'lucide-react';
import { TrialSummary } from '../engine/DesignTrial';
import { GameController } from '../game/GameController';
import { ProgressBar, cx } from './ui';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const winTone = (v: number) => (v >= 0.6 ? 'text-emerald-300' : v >= 0.4 ? 'text-amber-200' : 'text-rose-300');

/** Test bench result for the pending design (brief §9): win rate, fight length, HP left, vs the serial model. */
export const TrialPanel: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const t = ctrl.trial;
  if (!t || t.proposalId !== ctrl.proposal?.id) return null;
  const r = t.report;
  const opponentLabel = r.opponentSource === 'observed' ? 'по разведке' : 'базовая модель врага, разведданных нет';

  if (t.status === 'running') {
    const total = Math.max(0.01, t.readyAt - t.startedAt);
    const progress = (ctrl.state.gameTime - t.startedAt) / total;
    return (
      <div className="mt-1.5 rounded-lg bg-slate-900/60 border border-cyan-400/20 p-2 text-[10px] text-slate-300">
        <div className="flex items-center gap-1.5 text-cyan-200 font-semibold">
          <FlaskConical className="w-3.5 h-3.5 animate-pulse" />
          Стенд: {r.opponentCount}×«{r.candidate.design.name}» против {r.opponentCount}×«{r.opponent.name}»…
        </div>
        <ProgressBar value={progress} color="#22d3ee" className="mt-1.5" />
        {ctrl.state.isPaused && <div className="mt-1 text-amber-200">Игра на паузе — стенд ждёт.</div>}
      </div>
    );
  }

  return (
    <div className="mt-1.5 rounded-lg bg-slate-900/60 border border-cyan-400/20 p-2 text-[10px] text-slate-300" data-testid="trial-result">
      <div className="flex items-center gap-1.5 text-cyan-200 font-semibold">
        <FlaskConical className="w-3.5 h-3.5" />
        <span className="truncate" title={`${r.opponent.name}: ${opponentLabel}`}>
          Против «{r.opponent.name}» · {r.candidate.count}×{r.opponentCount} · {r.candidate.runs.length} боёв
        </span>
      </div>
      <table className="w-full mt-1 tabular-nums">
        <thead className="text-[9px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left font-semibold">Конструкция</th>
            <th className="text-right font-semibold">Победы</th>
            <th className="text-right font-semibold">Бой</th>
            <th className="text-right font-semibold">Осталось HP</th>
          </tr>
        </thead>
        <tbody>
          <Row label="Проект" s={r.candidate} highlight />
          {r.serial && <Row label="Текущая серия" s={r.serial} />}
          {r.equalBudget && <Row label={`Равный бюджет ${r.equalBudget.count}×${r.opponentCount}`} s={r.equalBudget} />}
        </tbody>
      </table>
      <div className="mt-1 text-slate-400">
        Цена машины {r.candidateCost} против {r.opponentCost} (металл + компоненты). {r.opponentSource === 'baseline' && 'Разведданных о враге нет — бой с базовой моделью.'}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; s: TrialSummary; highlight?: boolean }> = ({ label, s, highlight }) => (
  <tr className={cx(highlight && 'text-slate-100 font-semibold')}>
    <td className="text-left py-0.5">{label}</td>
    <td className={cx('text-right', winTone(s.winRate))}>{pct(s.winRate)}</td>
    <td className="text-right">{s.avgDuration.toFixed(0)} с</td>
    <td className="text-right">{pct(s.avgHpLeft)}</td>
  </tr>
);
