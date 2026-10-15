import React from 'react';
import { Compass, Undo2 } from 'lucide-react';
import { GAME_BALANCE } from '../config/balance';
import { PRIORITY_RU, PRIORITY_SHORT, RANGE_RU, RANGE_SHORT, STANCE_RU, STANCE_SHORT } from '../ai/parsing';
import { GameController } from '../game/GameController';
import { EngagementRange, Stance, TargetPriority } from '../types/game';
import { Chip, Panel, cx } from './ui';

const SOURCE_RU = { default: 'стандартный', player: 'ваш приказ', agent: 'решение Кобры', fallback: 'локальный AI' } as const;

/** Combat-control plan executed by the game AI (brief §5). */
export const TacticalPanel: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const plan = ctrl.state.teams.player.plan;
  const d = ctrl.director;
  const set = ctrl.setManualPlan.bind(ctrl);
  const army = ctrl.state.armySummary('player');
  const autonomousIn = Math.ceil(
    Math.max(0, GAME_BALANCE.AI_AUTONOMOUS_MIN_INTERVAL_SEC - (ctrl.state.gameTime - (d.lastCall.tactician?.at ?? -999))),
  );

  return (
    <Panel
      className="w-[300px]"
      title={<><Compass className="w-3.5 h-3.5 text-teal-300" /> План армии</>}
      right={
        <span className={cx('text-[9px] font-semibold', plan.source === 'agent' ? 'text-cyan-300' : 'text-slate-400')}>{SOURCE_RU[plan.source]}</span>
      }
    >
      <div className="p-2.5 flex flex-col gap-1.5 text-[11px]">
        <div className="text-slate-100 leading-snug line-clamp-2" title={plan.summaryRu}>{plan.summaryRu}</div>
        <Row label="Стойка">
          {(Object.keys(STANCE_RU) as Stance[]).map(k => (
            <Chip key={k} active={plan.stance === k} onClick={() => set({ stance: k })} title={STANCE_RU[k]}>
              {STANCE_SHORT[k]}
            </Chip>
          ))}
        </Row>
        <Row label="Дистанция">
          {(Object.keys(RANGE_RU) as EngagementRange[]).map(k => (
            <Chip key={k} active={plan.engagementRange === k} onClick={() => set({ engagementRange: k })} title={RANGE_RU[k]}>
              {RANGE_SHORT[k]}
            </Chip>
          ))}
        </Row>
        <Row label="Цели">
          {(Object.keys(PRIORITY_RU) as TargetPriority[]).map(k => (
            <Chip key={k} active={plan.targetPriority === k} onClick={() => set({ targetPriority: k })} title={PRIORITY_RU[k]}>
              {PRIORITY_SHORT[k]}
            </Chip>
          ))}
        </Row>
        <div className="flex items-center gap-2">
          <span className="text-slate-400 shrink-0">Ремонт при &lt;</span>
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={plan.retreatHpThreshold}
            onChange={e => set({ retreatHpThreshold: Number(e.target.value) })}
            className="flex-1 accent-teal-400"
            aria-label="Порог отступления на ремонт"
          />
          <span className="w-8 text-right tabular-nums">{plan.retreatHpThreshold ? `${plan.retreatHpThreshold}%` : 'нет'}</span>
        </div>
        <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
          <input type="checkbox" checked={plan.guardHarvesters} onChange={e => set({ guardHarvesters: e.target.checked })} className="accent-teal-400" />
          Прикрывать добытчиков
        </label>
        <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-white/5 pt-1.5">
          <span>
            {army.combatUnits} машин · {army.avgHpPct}% прочности
            {plan.stance === 'advance' && ` · волна от ${ctrl.state.waveSize()}`}
          </span>
          {ctrl.settings.autonomousTactics && d.cloudEnabled() ? (
            <span title="Кобра пересматривает план по значимым событиям, не чаще установленного предела">
              {d.busy.tactician ? 'Кобра думает…' : autonomousIn > 0 ? `автопересмотр через ${autonomousIn}с` : 'автопересмотр готов'}
            </span>
          ) : (
            <span>автопересмотр выкл.</span>
          )}
        </div>
        {ctrl.lastTactical && ctrl.lastTactical.source === 'llm' && (
          <button
            type="button"
            onClick={() => ctrl.revertTactical()}
            className="flex items-center justify-center gap-1 py-1 rounded-md bg-slate-800 border border-white/10 hover:bg-slate-700 text-slate-200"
          >
            <Undo2 className="w-3 h-3" /> Вернуть прежний план
          </button>
        )}
      </div>
    </Panel>
  );
};

const Row: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => (
  <div>
    <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
    <div className="flex gap-1">{children}</div>
  </div>
);
