import React, { useEffect, useState } from 'react';
import { ChevronDown, Languages, X } from 'lucide-react';
import { LANGS, LANG_LABEL, Lang, t } from '../i18n';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const COMPACT_QUERY = '(max-height: 640px)';

/** Short screens (a phone in landscape): the side panels start collapsed so they do not cover each other. */
export function useCompactHud(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(COMPACT_QUERY).matches);
  useEffect(() => {
    const m = window.matchMedia?.(COMPACT_QUERY);
    if (!m) return;
    const update = () => setCompact(m.matches);
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, []);
  return compact;
}

/**
 * True for `ms` after the player last touched, clicked, scrolled or typed anywhere — panels that
 * would cover the battlefield on a phone fade out while the player just watches.
 */
export function useRecentInteraction(ms = 4000): boolean {
  const [active, setActive] = useState(true);
  useEffect(() => {
    let timer = setTimeout(() => setActive(false), ms);
    const poke = () => {
      setActive(true);
      clearTimeout(timer);
      timer = setTimeout(() => setActive(false), ms);
    };
    const events = ['pointerdown', 'wheel', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, poke, { passive: true, capture: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, poke, { capture: true });
    };
  }, [ms]);
  return active;
}

/** Open state of a collapsible panel: follows the screen size until the player toggles it. */
export function usePanelOpen(): [boolean, () => void] {
  const compact = useCompactHud();
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? !compact;
  return [open, () => setChoice(!open)];
}

export const Panel: React.FC<
  React.PropsWithChildren<{
    className?: string;
    title?: React.ReactNode;
    right?: React.ReactNode;
    /** collapsible panel: the title toggles the body; `summary` stands in for it while collapsed */
    open?: boolean;
    onToggle?: () => void;
    summary?: React.ReactNode;
    /** drawer on the phone: a close button, the body scrolls under a sticky title */
    onClose?: () => void;
  }>
> = ({ className, title, right, open = true, onToggle, summary, onClose, children }) => (
  <div className={cx('hud-panel pointer-events-auto', onClose && 'max-h-full overflow-y-auto overscroll-contain', className)}>
    {title && (
      <div
        className={cx(
          'flex items-center justify-between px-3 pt-2 pb-1.5',
          open && 'border-b border-white/5',
          onClose && 'sticky top-0 z-10 rounded-t-[14px] bg-[#1d2834]',
        )}
      >
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="font-heading text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300 hover:text-white flex items-center gap-1.5"
          >
            {title}
            <ChevronDown className={cx('w-3.5 h-3.5 transition-transform', !open && '-rotate-90')} />
          </button>
        ) : (
          <div className="font-heading text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300 flex items-center gap-1.5">{title}</div>
        )}
        {onClose ? (
          <span className="flex items-center gap-2">
            {right}
            <button
              type="button"
              onClick={onClose}
              title={t('common.close')}
              aria-label={t('common.close')}
              className="w-11 h-11 -my-2 -mr-2 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/5"
            >
              <X className="w-5 h-5" />
            </button>
          </span>
        ) : (
          right
        )}
      </div>
    )}
    {open ? children : summary && <div className="px-3 pb-2 -mt-0.5 text-[11px] text-slate-300 leading-snug line-clamp-2">{summary}</div>}
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
      'h-8 min-w-8 px-2 rounded-lg border flex items-center justify-center gap-1 text-xs transition disabled:opacity-40 phone:h-11 phone:min-w-11 phone:rounded-xl',
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
      'px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold border transition whitespace-nowrap phone:min-h-[40px] phone:px-2.5 phone:text-xs',
      active ? 'bg-teal-500/30 border-teal-300/70 text-white' : 'bg-slate-800/60 border-white/10 text-slate-300 hover:bg-slate-700/70',
    )}
  >
    {children}
  </button>
);

/** RU / EN / IT switch; `short` shows language codes instead of the names. */
export const LanguageSwitch: React.FC<{ value: Lang; onChange: (lang: Lang) => void; short?: boolean }> = ({ value, onChange, short }) => (
  <div className="flex items-center gap-1" role="radiogroup" aria-label={t('brief.language')}>
    <Languages className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden />
    {LANGS.map(lang => (
      <button
        key={lang}
        type="button"
        role="radio"
        aria-checked={value === lang}
        title={LANG_LABEL[lang]}
        onClick={() => onChange(lang)}
        className={cx(
          'px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold border transition whitespace-nowrap phone:min-h-[40px] phone:min-w-[40px] phone:text-xs',
          value === lang ? 'bg-teal-500/30 border-teal-300/70 text-white' : 'bg-slate-800/60 border-white/10 text-slate-300 hover:bg-slate-700/70',
        )}
      >
        {short ? lang.toUpperCase() : LANG_LABEL[lang]}
      </button>
    ))}
  </div>
);

export function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtCoins(v: number): string {
  return v >= 100 ? Math.round(v).toString() : v.toFixed(1);
}
