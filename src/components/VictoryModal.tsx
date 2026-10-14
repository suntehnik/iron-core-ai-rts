import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { GameState } from '../engine/GameState';
import { Trophy, Skull, RotateCcw, ShieldCheck, Layers, Wrench } from 'lucide-react';

interface VictoryModalProps {
  outcome: 'player_won' | 'enemy_won';
  state: GameState;
  onRestart: () => void;
}

export const VictoryModal: React.FC<VictoryModalProps> = ({
  outcome,
  state,
  onRestart,
}) => {
  const isVictory = outcome === 'player_won';

  useEffect(() => {
    if (isVictory) {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
      });
    }
  }, [isVictory]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-lg">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col text-center p-6 gap-5">
        {/* Banner Icon */}
        <div className="mx-auto">
          {isVictory ? (
            <div className="w-20 h-20 rounded-2xl bg-amber-500/20 border-2 border-amber-400/50 flex items-center justify-center text-amber-400 shadow-xl shadow-amber-500/20">
              <Trophy className="w-10 h-10 animate-bounce" />
            </div>
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-red-500/20 border-2 border-red-400/50 flex items-center justify-center text-red-400 shadow-xl shadow-red-500/20">
              <Skull className="w-10 h-10" />
            </div>
          )}
        </div>

        {/* Title */}
        <div>
          <h1 className="font-heading font-black text-3xl tracking-wide text-slate-100">
            {isVictory ? 'ПОБЕДА КОМАНДОВАНИЯ!' : 'ПОРАЖЕНИЕ БАЗЫ'}
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
            {isVictory
              ? 'Главный командный центр противника разрушен благодаря инженерной адаптации ваших боевых роботов!'
              : 'Вражеская армия прорвала оборонительный рубеж и уничтожила командный пункт.'}
          </p>
        </div>

        {/* Match Statistics */}
        <div className="grid grid-cols-2 gap-3 bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 text-xs">
          <div className="flex items-center gap-2.5 text-left">
            <Layers className="w-4 h-4 text-blue-400" />
            <div>
              <div className="text-slate-400 font-medium">Добыто металла</div>
              <div className="font-bold text-slate-100 text-sm font-heading">
                {Math.round(state.playerEconomy.totalMetalMined)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 text-left">
            <Wrench className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-slate-400 font-medium">Собрано обломков</div>
              <div className="font-bold text-slate-100 text-sm font-heading">
                +{Math.round(state.playerEconomy.totalScrapReclaimed)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 text-left">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="text-slate-400 font-medium">Выпущено партий</div>
              <div className="font-bold text-slate-100 text-sm font-heading">
                {state.playerBatchNumber - 1}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 text-left">
            <Trophy className="w-4 h-4 text-purple-400" />
            <div>
              <div className="text-slate-400 font-medium">Финальная модель</div>
              <div className="font-bold text-slate-100 text-sm font-heading truncate max-w-[120px]">
                {state.playerDesign.name}
              </div>
            </div>
          </div>
        </div>

        {/* Restart Button */}
        <button
          onClick={onRestart}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-heading font-bold text-base shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 transition"
        >
          <RotateCcw className="w-5 h-5" />
          Играть следующий матч
        </button>
      </div>
    </div>
  );
};
