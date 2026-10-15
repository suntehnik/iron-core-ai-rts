import React from 'react';
import { GameController } from '../game/GameController';
import { GameEventType } from '../types/game';
import { cx, formatTime } from './ui';

const COLORS: Partial<Record<GameEventType, string>> = {
  base_attack: 'bg-rose-400',
  harvester_attacked: 'bg-rose-400',
  heavy_losses: 'bg-rose-400',
  power_shortage: 'bg-amber-400',
  enemy_new_design: 'bg-orange-400',
  batch_complete: 'bg-teal-300',
  design_changed: 'bg-cyan-300',
  intercept: 'bg-orange-300',
  build_complete: 'bg-emerald-300',
};

export const EventFeed: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const events = ctrl.state.events.filter(e => e.team === 'player' && e.type !== 'loss' && e.type !== 'batch_started').slice(0, 5);
  if (!events.length) return null;
  return (
    <div className="flex flex-col gap-1 w-[264px] pointer-events-none">
      {events.map((e, i) => (
        <div
          key={e.id}
          className={cx('hud-panel !rounded-lg px-2 py-1 text-[11px] text-slate-100 flex items-start gap-1.5', i > 2 && 'opacity-60')}
        >
          <span className={cx('mt-1 w-1.5 h-1.5 rounded-full shrink-0', COLORS[e.type] ?? 'bg-slate-400', e.significant && 'animate-pulse')} />
          <span className="text-slate-500 tabular-nums shrink-0">{formatTime(e.time)}</span>
          <span className="leading-snug">{e.text}</span>
        </div>
      ))}
    </div>
  );
};
