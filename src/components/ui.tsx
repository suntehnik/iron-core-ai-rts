import React from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const Panel: React.FC<React.PropsWithChildren<{ className?: string; title?: React.ReactNode; right?: React.ReactNode }>> = ({
  className,
  title,
  right,
  children,
}) => (
  <div className={cx('hud-panel pointer-events-auto', className)}>
    {title && (
      <div className="flex items-center justify-between px-3 pt-2 pb-1.5 border-b border-white/5">
        <div className="font-heading text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300 flex items-center gap-1.5">{title}</div>
        {right}
      </div>
    )}
    {children}
  </div>
);

export const IconButton: React.FC<
  React.PropsWithChildren<{ onClick?: () => void; title?: string; active?: boolean; disabled?: boolean; className?: string }>
> = ({ onClick, title, active, disabled, className, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-label={title}
    disabled={disabled}
    className={cx(
      'h-8 min-w-8 px-2 rounded-lg border flex items-center justify-center gap-1 text-xs transition disabled:opacity-40',
      active ? 'bg-teal-500/25 border-teal-300/60 text-teal-100' : 'bg-slate-800/70 border-white/10 text-slate-200 hover:bg-slate-700/80',
      className,
    )}
  >
    {children}
  </button>
);

/** Segmented bar like the concept art (БРОНЯ / МОЩЬ / СКОРОСТЬ). Optional ghost value shows "after". */
export const StatBar: React.FC<{ label: string; value: number; next?: number | null; color?: string }> = ({ label, value, next, color = '#5eead4' }) => {
  const segs = 10;
  const filled = Math.round(value * segs);
  const nextFilled = next === null || next === undefined ? null : Math.round(next * segs);
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] font-heading font-bold tracking-wider text-slate-300">
        <span>{label}</span>
        {nextFilled !== null && nextFilled !== filled && (
          <span className={nextFilled > filled ? 'text-emerald-300' : 'text-rose-300'}>{nextFilled > filled ? '▲' : '▼'}</span>
        )}
      </div>
      <div className="flex gap-[3px] mt-0.5">
        {Array.from({ length: segs }).map((_, i) => {
          const now = i < filled;
          const after = nextFilled !== null ? i < nextFilled : now;
          let bg = 'rgba(148,163,184,0.15)';
          if (now && after) bg = color;
          else if (now && !after) bg = 'rgba(244,63,94,0.55)';
          else if (!now && after) bg = 'rgba(52,211,153,0.75)';
          return <div key={i} className="h-2 flex-1 rounded-[2px]" style={{ background: bg }} />;
        })}
      </div>
    </div>
  );
};

export const ProgressBar: React.FC<{ value: number; color?: string; className?: string }> = ({ value, color = '#2dd4bf', className }) => (
  <div className={cx('h-1.5 rounded-full bg-slate-700/70 overflow-hidden', className)}>
    <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
  </div>
);

export const Chip: React.FC<React.PropsWithChildren<{ active?: boolean; onClick?: () => void; title?: string }>> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={cx(
      'px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold border transition whitespace-nowrap',
      active ? 'bg-teal-500/30 border-teal-300/70 text-white' : 'bg-slate-800/60 border-white/10 text-slate-300 hover:bg-slate-700/70',
    )}
  >
    {children}
  </button>
);

export function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtCoins(v: number): string {
  return v >= 100 ? Math.round(v).toString() : v.toFixed(1);
}
