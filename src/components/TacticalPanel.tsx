import React from 'react';
import { Compass, Undo2 } from 'lucide-react';
import { GAME_BALANCE } from '../config/balance';
import { PRIORITIES, RANGES, STANCES, priorityLabel, rangeLabel, stanceLabel } from '../ai/parsing';
import { GameController } from '../game/GameController';
import { EngagementRange, Stance, TargetPriority } from '../types/game';
import { Chip, Panel, cx, usePanelOpen } from './ui';
import { t } from '../i18n';

const SOURCE_KEY = { default: 'tac.source.default', player: 'tac.source.player', agent: 'tac.source.agent', fallback: 'tac.source.fallback' } as const;

/** Combat-control plan executed by the game AI (brief §5). */
export const TacticalPanel: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const plan = ctrl.state.teams.player.plan;
  const d = ctrl.director;
  const set = ctrl.setManualPlan.bind(ctrl);
  const army = ctrl.state.armySummary('player');
  const autonomousIn = Math.ceil(
    Math.max(0, GAME_BALANCE.AI_EVENT_REPLAN_COOLDOWN_SEC - (ctrl.state.gameTime - (d.lastCall.tactician?.at ?? -999))),
  );

  const open = true;

  return (
    <Panel
      className="embedded-panel"
      open={open}
      summary={plan.summaryRu}
      title={<><Compass className="w-3.5 h-3.5 text-teal-300" /> {t('tac.title')}</>}
      right={
        <span className={cx('text-[9px] font-semibold', plan.source === 'agent' ? 'text-cyan-300' : 'text-slate-400')}>{t(SOURCE_KEY[plan.source])}</span>
      }
    >
      <div className="p-2.5 flex flex-col gap-1.5 text-[11px]">
        <div className="text-slate-100 leading-snug line-clamp-2" title={plan.summaryRu}>{plan.summaryRu}</div>
        <Row label={t('tac.stance')}>
          {STANCES.map(k => (
            <Chip key={k} active={plan.stance === k} onClick={() => set({ stance: k })} title={stanceLabel(k)}>
              {stanceLabel(k, true)}
            </Chip>
          ))}
        </Row>
        <Row label={t('tac.range')}>
          {RANGES.map(k => (
            <Chip key={k} active={plan.engagementRange === k} onClick={() => set({ engagementRange: k })} title={rangeLabel(k)}>
              {rangeLabel(k, true)}
            </Chip>
          ))}
        </Row>
        <Row label={t('tac.targets')}>
          {PRIORITIES.map(k => (
            <Chip key={k} active={plan.targetPriority === k} onClick={() => set({ targetPriority: k })} title={priorityLabel(k)}>
              {priorityLabel(k, true)}
            </Chip>
          ))}
        </Row>
        <div className="flex items-center gap-2">
          <span className="text-slate-400 shrink-0">{t('tac.repairAt')}</span>
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={plan.retreatHpThreshold}
            onChange={e => set({ retreatHpThreshold: Number(e.target.value) })}
            className="flex-1 accent-teal-400"
            aria-label={t('tac.repairAria')}
          />
          <span className="w-8 text-right tabular-nums">{plan.retreatHpThreshold ? `${plan.retreatHpThreshold}%` : t('tac.none')}</span>
        </div>
        <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
          <input type="checkbox" checked={plan.guardHarvesters} onChange={e => set({ guardHarvesters: e.target.checked })} className="accent-teal-400" />
          {t('tac.guard')}
        </label>
        <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-white/5 pt-1.5">
          <span>
            {t('tac.armyCount', { count: army.combatUnits })} · {t('tac.armyHp', { n: army.avgHpPct })}
            {plan.stance === 'advance' && ` · ${t('tac.wave', { n: ctrl.state.waveSize() })}`}
          </span>
          {ctrl.settings.autonomousTactics && d.cloudEnabled() ? (
            <span title={t('tac.autoHint')}>
              {d.busy.tactician ? t('tac.thinking') : autonomousIn > 0 ? t('tac.autoIn', { n: autonomousIn }) : t('tac.autoReady')}
            </span>
          ) : (
            <span>{t('tac.autoOff')}</span>
          )}
        </div>
        {ctrl.lastTactical && ctrl.lastTactical.source === 'llm' && (
          <button
            type="button"
            onClick={() => ctrl.revertTactical()}
            className="flex items-center justify-center gap-1 py-1 rounded-md bg-slate-800 border border-white/10 hover:bg-slate-700 text-slate-200"
          >
            <Undo2 className="w-3 h-3" /> {t('tac.revert')}
          </button>
        )}
      </div>
    </Panel>
  );
};

const Row: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => (
  <div>
    <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
    <div className="flex flex-wrap gap-1">{children}</div>
  </div>
);
