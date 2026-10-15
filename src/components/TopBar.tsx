import React, { useState } from 'react';
import { Box, Clock, Cog, Coins, Cpu, Eye, Home, Pause, Play, RotateCcw, Settings, Users, Volume2, VolumeX, Zap } from 'lucide-react';
import { GAME_BALANCE } from '../config/balance';
import { GameController, TIME_SCALES } from '../game/GameController';
import { CoinPanel } from './CoinPanel';
import { IconButton, cx, fmtCoins, formatTime } from './ui';

const Resource: React.FC<{ icon: React.ReactNode; value: React.ReactNode; title: string; warn?: boolean; sub?: React.ReactNode }> = ({
  icon,
  value,
  title,
  warn,
  sub,
}) => (
  <div className="flex items-center gap-1.5 px-2.5" title={title}>
    <span className={cx('flex', warn ? 'text-rose-300' : 'text-slate-200')}>{icon}</span>
    <div className="leading-none">
      <div className={cx('font-heading font-bold text-[15px] tabular-nums', warn ? 'text-rose-300' : 'text-slate-50')}>{value}</div>
      {sub && <div className="text-[9px] text-slate-400 mt-0.5 tracking-wide">{sub}</div>}
    </div>
  </div>
);

export const TopBar: React.FC<{ ctrl: GameController; onOpenSettings: () => void }> = ({ ctrl, onOpenSettings }) => {
  const [coinsOpen, setCoinsOpen] = useState(false);
  const s = ctrl.state;
  const e = s.teams.player.economy;
  const army = s.combatCount('player');
  const billing = ctrl.director.billing.snapshot();
  const cloud = ctrl.director.cloudEnabled();
  const busy = ctrl.director.busy;

  return (
    <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-3 pointer-events-none z-20">
      {/* Resources (concept: metal • components • power • army) */}
      <div className="hud-panel pointer-events-auto flex items-center divide-x divide-white/10 py-1.5">
        <Resource icon={<Box className="w-4 h-4" />} value={Math.floor(e.metal)} title="Металл: корпуса, броня, здания" sub={`+${e.miningRatePerMin}/мин`} />
        <Resource
          icon={<Cog className="w-4 h-4" />}
          value={Math.floor(e.components)}
          title="Компоненты: из металла на фабрикаторе штаба; двигатели, оружие, сенсоры"
          sub={e.fabricatorActive ? 'фабрикатор ▲' : `резерв ${e.componentReserve}`}
        />
        <Resource
          icon={<Zap className="w-4 h-4" />}
          value={`${Math.round(e.powerDemand)}/${e.powerCapacity}`}
          title="Энергия базы, кВт: заводы, добыча, фабрикатор и ремонт"
          warn={e.powerEfficiency < 0.99}
          sub={e.powerEfficiency < 0.99 ? `дефицит ${Math.round((1 - e.powerEfficiency) * 100)}%` : 'кВт'}
        />
        <Resource icon={<Users className="w-4 h-4" />} value={`${army}/${GAME_BALANCE.MAX_ACTIVE_COMBAT_BOTS}`} title="Боевые машины / предел армии" sub="армия" />
        <div className="flex items-center gap-1.5 px-2.5 text-slate-300" title="Время матча">
          <Clock className="w-3.5 h-3.5" />
          <span className="font-heading font-bold tabular-nums text-sm">{formatTime(s.gameTime)}</span>
        </div>
      </div>

      {/* Base health */}
      <div className="hud-panel pointer-events-auto hidden xl:flex items-center gap-3 px-3 py-2">
        <BaseHp label="Наш штаб" pct={s.baseHpPct('player')} color="#2dd4bf" />
        <span className="text-slate-500 font-heading text-xs">VS</span>
        <BaseHp label="Штаб врага" pct={s.baseHpPct('enemy')} color="#fb923c" />
      </div>

      {/* AI coins, model status, controls */}
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={() => setCoinsOpen(o => !o)}
            className={cx(
              'hud-panel flex items-center gap-2 px-3 py-1.5 hover:brightness-125 transition',
              billing.status === 'low' && 'ring-1 ring-amber-400/70',
              billing.status === 'exhausted' && 'ring-1 ring-rose-400/80',
            )}
            title="AI-монеты: баланс и расходы на облачные сервисы"
          >
            <Coins className="w-4 h-4 text-amber-300" />
            <div className="leading-none text-left">
              <div className="font-heading font-bold text-[15px] text-amber-200 tabular-nums">{fmtCoins(billing.wallet)}</div>
              <div className="text-[9px] text-slate-400 mt-0.5">
                матч {fmtCoins(billing.spentThisMatch)}/{billing.matchLimit}
              </div>
            </div>
          </button>
          <div
            className={cx('hud-panel hidden xl:flex items-center gap-1.5 px-2.5 py-2 max-w-[260px]', cloud ? 'text-emerald-200' : 'text-amber-200')}
            title={cloud ? 'Агенты думают облачным LLM' : 'Облачный LLM не настроен — работают локальные эвристики'}
          >
            <Cpu className={cx('w-3.5 h-3.5 shrink-0', (busy.engineer || busy.tactician || busy.enemy) && 'animate-pulse text-cyan-300')} />
            <span className="text-[11px] font-semibold truncate">{ctrl.director.providerLabel()}</span>
          </div>
          {ctrl.mode === 'spectator' && (
            <div className="hud-panel flex items-center gap-1 p-1" title="Режим наблюдения: скорость игры">
              <span className="flex items-center gap-1 px-1.5 text-[11px] font-semibold text-cyan-200 whitespace-nowrap">
                <Eye className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">ИИ vs ИИ</span>
              </span>
              {TIME_SCALES.map(k => (
                <IconButton key={k} onClick={() => ctrl.setTimeScale(k)} active={ctrl.timeScale === k} title={`Скорость ×${k}`}>
                  <span className="font-heading font-bold text-[11px]">×{k}</span>
                </IconButton>
              ))}
            </div>
          )}
          <div className="hud-panel flex items-center gap-1 p-1">
            <IconButton onClick={() => ctrl.backToMenu()} title="В меню: выбрать режим игры">
              <Home className="w-4 h-4" />
            </IconButton>
            <IconButton onClick={() => ctrl.togglePause()} title={s.isPaused ? 'Продолжить' : 'Пауза'}>
              {s.isPaused ? <Play className="w-4 h-4 text-emerald-300" /> : <Pause className="w-4 h-4" />}
            </IconButton>
            <IconButton onClick={() => ctrl.restart()} title="Перезапустить матч">
              <RotateCcw className="w-4 h-4" />
            </IconButton>
            <IconButton onClick={() => ctrl.toggleMute()} title={ctrl.settings.soundMuted ? 'Включить звук' : 'Выключить звук'}>
              {ctrl.settings.soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </IconButton>
            <IconButton onClick={onOpenSettings} title="Настройки LLM и AI-расходов">
              <Settings className="w-4 h-4" />
            </IconButton>
          </div>
        </div>
        {coinsOpen && <CoinPanel ctrl={ctrl} onClose={() => setCoinsOpen(false)} />}
      </div>
    </div>
  );
};

const BaseHp: React.FC<{ label: string; pct: number; color: string }> = ({ label, pct, color }) => (
  <div className="w-28">
    <div className="flex justify-between text-[10px] text-slate-300 font-semibold">
      <span>{label}</span>
      <span className="tabular-nums">{pct}%</span>
    </div>
    <div className="h-1.5 mt-1 rounded-full bg-slate-700 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  </div>
);
