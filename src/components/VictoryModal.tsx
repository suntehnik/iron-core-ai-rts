import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { RotateCcw, Skull, Trophy } from 'lucide-react';
import { GameController } from '../game/GameController';
import { fmtCoins, formatTime } from './ui';

export const VictoryModal: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const s = ctrl.state;
  const won = s.gameOver === 'player_won';
  const t = s.teams.player.economy.totals;
  const b = ctrl.director.billing.snapshot();
  const aiCalls = b.services.production.calls + b.services.tactical.calls;

  useEffect(() => {
    if (won) confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 }, colors: ['#14b8a6', '#5eead4', '#f2b134', '#efe4cc'] });
  }, [won]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="hud-panel w-full max-w-[520px] p-6 text-center text-slate-100">
        <div className={`mx-auto w-16 h-16 rounded-2xl flex items-center justify-center ${won ? 'bg-amber-400/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'}`}>
          {won ? <Trophy className="w-9 h-9" /> : <Skull className="w-9 h-9" />}
        </div>
        <h1 className="font-heading text-3xl font-bold mt-3">{won ? 'Победа!' : 'Штаб потерян'}</h1>
        <p className="text-sm text-slate-300 mt-1">
          {won ? 'Командный центр противника уничтожен. Инженерные решения сработали.' : 'Противник прорвал оборону. Попробуйте другую конструкцию или тактику.'}
        </p>
        <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
          <Stat label="Время матча" value={formatTime(s.gameTime)} />
          <Stat label="Добыто металла" value={Math.round(t.metalMined + t.scrapReclaimed)} />
          <Stat label="Выпущено машин" value={t.unitsBuilt} />
          <Stat label="Уничтожено врагов" value={t.kills} />
          <Stat label="Потеряно машин" value={t.unitsLost} />
          <Stat label="Финальная модель" value={s.teams.player.design.name} />
          <Stat label="AI-вызовов" value={aiCalls} />
          <Stat label="Монет за матч" value={fmtCoins(b.spentThisMatch)} />
          <Stat label="Токенов вх/вых" value={`${b.services.production.tokensIn + b.services.tactical.tokensIn}/${b.services.production.tokensOut + b.services.tactical.tokensOut}`} />
        </div>
        <button
          type="button"
          onClick={() => ctrl.restart()}
          className="mt-5 w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-heading font-bold flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-5 h-5" /> Следующий матч
        </button>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-lg bg-slate-800/60 border border-white/10 p-2">
    <div className="text-[9px] uppercase tracking-wider text-slate-400">{label}</div>
    <div className="font-heading font-bold text-sm truncate">{value}</div>
  </div>
);
