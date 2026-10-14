import React, { useEffect, useRef } from 'react';
import { GameState } from '../engine/GameState';
import { GAME_BALANCE } from '../config/balance';
import { 
  Zap, 
  Layers, 
  Clock, 
  Pause, 
  Play, 
  Settings, 
  ShieldAlert, 
  Factory,
  RotateCcw
} from 'lucide-react';

interface GameHUDProps {
  state: GameState;
  onTogglePause: () => void;
  onOpenSettings: () => void;
  onRestartMatch: () => void;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  state,
  onTogglePause,
  onOpenSettings,
  onRestartMatch,
}) => {
  const minimapRef = useRef<HTMLCanvasElement>(null);

  // Render Minimap
  useEffect(() => {
    const canvas = minimapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scaleX = canvas.width / GAME_BALANCE.MAP_WIDTH;
    const scaleY = canvas.height / GAME_BALANCE.MAP_HEIGHT;

    // Center divider
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();

    // Resources
    ctx.fillStyle = '#38bdf8';
    for (const r of state.resourcePatches) {
      if (r.metalRemaining > 0) {
        ctx.beginPath();
        ctx.arc(r.pos.x * scaleX, r.pos.y * scaleY, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Scrap
    ctx.fillStyle = '#f59e0b';
    for (const s of state.scrapPiles) {
      ctx.fillRect(s.pos.x * scaleX - 1.5, s.pos.y * scaleY - 1.5, 3, 3);
    }

    // Buildings
    for (const b of state.buildings) {
      ctx.fillStyle = b.team === 'player' ? '#3b82f6' : '#ef4444';
      const size = b.type === 'command_center' ? 7 : 5;
      ctx.fillRect(b.pos.x * scaleX - size / 2, b.pos.y * scaleY - size / 2, size, size);
    }

    // Units
    for (const u of state.units) {
      if (u.state === 'dead') continue;
      ctx.fillStyle = u.team === 'player' ? '#60a5fa' : '#f87171';
      ctx.beginPath();
      ctx.arc(u.pos.x * scaleX, u.pos.y * scaleY, u.kind === 'combat' ? 2 : 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [state, state.gameTime]);

  const pCenter = state.buildings.find(b => b.id === 'p_hq');
  const eCenter = state.buildings.find(b => b.id === 'e_hq');
  const pFactory = state.buildings.find(b => b.id === 'p_factory');

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const queue = pFactory?.productionQueue;

  return (
    <div className="absolute top-0 left-0 right-0 pointer-events-none p-3 flex flex-col gap-2 z-10">
      {/* Top Bar */}
      <div className="flex justify-between items-center bg-slate-900/90 border border-slate-700/80 rounded-xl px-4 py-2 shadow-2xl backdrop-blur-md pointer-events-auto">
        {/* Resources Group */}
        <div className="flex items-center gap-6">
          {/* Metal */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-blue-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase text-slate-400 font-medium tracking-wider">Металл</div>
              <div className="text-lg font-bold text-blue-300 font-heading">
                {Math.round(state.playerEconomy.metal)}
              </div>
            </div>
          </div>

          {/* Energy */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase text-slate-400 font-medium tracking-wider">Энергия базы</div>
              <div className="text-lg font-bold text-amber-300 font-heading">
                {state.playerEconomy.powerConsumed} / {state.playerEconomy.powerAvailable} kW
              </div>
            </div>
          </div>

          {/* Scrap Salvaged */}
          <div className="flex items-center gap-2 border-l border-slate-700/60 pl-4">
            <div>
              <div className="text-xs uppercase text-slate-400 font-medium tracking-wider">Собрано обломков</div>
              <div className="text-sm font-semibold text-amber-200">
                +{Math.round(state.playerEconomy.totalScrapReclaimed)}
              </div>
            </div>
          </div>
        </div>

        {/* Center Bases HP & Timer */}
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-xs font-semibold text-blue-400 uppercase">Штаб игрока</span>
            <div className="w-28 bg-slate-800 h-2 rounded-full overflow-hidden border border-slate-700">
              <div
                className="bg-blue-500 h-full transition-all duration-300"
                style={{ width: `${Math.max(0, ((pCenter?.hp || 0) / (pCenter?.maxHp || 1)) * 100)}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1 bg-slate-800/80 rounded-lg border border-slate-700">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-bold text-slate-200 font-heading tracking-widest">
              {formatTime(state.gameTime)}
            </span>
          </div>

          <div className="flex flex-col items-start">
            <span className="text-xs font-semibold text-red-400 uppercase">Штаб врага</span>
            <div className="w-28 bg-slate-800 h-2 rounded-full overflow-hidden border border-slate-700">
              <div
                className="bg-red-500 h-full transition-all duration-300"
                style={{ width: `${Math.max(0, ((eCenter?.hp || 0) / (eCenter?.maxHp || 1)) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Controls and Settings */}
        <div className="flex items-center gap-3">
          <button
            onClick={onTogglePause}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            title={state.isPaused ? 'Продолжить' : 'Пауза'}
          >
            {state.isPaused ? <Play className="w-4 h-4 text-emerald-400" /> : <Pause className="w-4 h-4" />}
          </button>
          <button
            onClick={onRestartMatch}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            title="Перезапустить матч"
          >
            <RotateCcw className="w-4 h-4 text-amber-400" />
          </button>
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            title="Настройки ИИ и API"
          >
            <Settings className="w-4 h-4 text-cyan-400" />
          </button>
        </div>
      </div>

      {/* Secondary Row: Factory status & Minimap */}
      <div className="flex justify-between items-start">
        {/* Factory Status Box */}
        <div className="bg-slate-900/85 border border-slate-700/80 rounded-xl p-3 shadow-xl backdrop-blur-md pointer-events-auto flex items-center gap-3 min-w-[280px]">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Factory className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="flex justify-between text-xs">
              <span className="font-semibold text-slate-300">
                {queue ? `Сборка партии #${state.playerBatchNumber}` : 'Завод простаивает'}
              </span>
              {queue && (
                <span className="text-blue-400 font-bold">
                  {queue.batchRemaining} / {queue.batchSize} шт
                </span>
              )}
            </div>

            {queue ? (
              <div className="mt-1.5">
                <div className="text-[11px] text-slate-400 truncate mb-1">
                  Модель: <span className="text-slate-200 font-medium">{queue.design.name}</span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-blue-400 h-full transition-all duration-100"
                    style={{ width: `${(queue.progressSec / queue.totalTimeSec) * 100}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 mt-0.5">
                Ожидание металла или нового приказа
              </div>
            )}
          </div>
        </div>

        {/* Minimap */}
        <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-2 shadow-2xl backdrop-blur-md pointer-events-auto">
          <canvas
            ref={minimapRef}
            width={160}
            height={96}
            className="rounded border border-slate-800 block cursor-crosshair"
          />
        </div>
      </div>
    </div>
  );
};
