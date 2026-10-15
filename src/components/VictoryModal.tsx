import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Home, RotateCcw, Skull, Trophy } from 'lucide-react';
import { COMMANDERS } from '../config/commanders';
import { TEAM_COLORS } from '../config/balance';
import { GameController } from '../game/GameController';
import { Team } from '../types/game';
import { CommanderPortrait } from './Portraits';
import { fmtCoins, formatTime } from './ui';

export const VictoryModal: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const s = ctrl.state;
  const spectator = ctrl.mode === 'spectator';
  const won = s.gameOver === 'player_won';
  const winner: Team = won ? 'player' : 'enemy';

  useEffect(() => {
    if (won || spectator) {
      const c = TEAM_COLORS[winner];
      confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 }, colors: [c.main, c.light, '#f2b134', '#efe4cc'] });
    }
  }, [won, spectator, winner]);

  if (spectator) return <SpectatorResult ctrl={ctrl} winner={winner} />;

  const t = s.teams.player.economy.totals;
  const b = ctrl.director.billing.snapshot();
  const aiCalls = b.services.production.calls + b.services.tactical.calls;

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
        <Buttons ctrl={ctrl} again="Следующий матч" />
      </div>
    </div>
  );
};

const SpectatorResult: React.FC<{ ctrl: GameController; winner: Team }> = ({ ctrl, winner }) => {
  const s = ctrl.state;
  const b = ctrl.director.billing.snapshot();
  const usage = { player: b.ally, enemy: b.enemy };
  const color = TEAM_COLORS[winner];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="hud-panel w-full max-w-[600px] p-6 text-center text-slate-100">
        <div className="mx-auto w-fit">
          <CommanderPortrait team={winner} size={64} />
        </div>
        <h1 className="font-heading text-3xl font-bold mt-2" style={{ color: color.light }}>
          Победа: {COMMANDERS[winner].name}
        </h1>
        <p className="text-sm text-slate-300 mt-1">
          Матч ИИ против ИИ завершён за {formatTime(s.gameTime)}: штаб {winner === 'player' ? 'оранжевых' : 'бирюзовых'} уничтожен.
        </p>
        <table className="w-full mt-4 text-xs tabular-nums">
          <thead className="text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left font-semibold pb-1" />
              {(['player', 'enemy'] as Team[]).map(team => (
                <th key={team} className="text-right font-semibold pb-1" style={{ color: TEAM_COLORS[team].light }}>
                  {COMMANDERS[team].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label="Добыто металла" v={team => Math.round(s.teams[team].economy.totals.metalMined + s.teams[team].economy.totals.scrapReclaimed)} />
            <Row label="Выпущено машин" v={team => s.teams[team].economy.totals.unitsBuilt} />
            <Row label="Уничтожено врагов" v={team => s.teams[team].economy.totals.kills} />
            <Row label="Потеряно машин" v={team => s.teams[team].economy.totals.unitsLost} />
            <Row label="Финальная модель" v={team => s.teams[team].design.name} />
            <Row label="Решений LLM / ошибок" v={team => `${usage[team].calls} / ${usage[team].errors}`} />
            <Row label="Токенов вх/вых" v={team => `${usage[team].tokensIn}/${usage[team].tokensOut}`} />
          </tbody>
        </table>
        <div className="text-[10px] text-slate-400 mt-2">Режим наблюдения не списывает AI-монеты: это демонстрация, а не ваши приказы.</div>
        <Buttons ctrl={ctrl} again="Ещё матч ИИ против ИИ" />
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; v: (team: Team) => React.ReactNode }> = ({ label, v }) => (
  <tr className="border-t border-white/5">
    <td className="text-left py-1 text-slate-400">{label}</td>
    <td className="text-right py-1 font-semibold truncate max-w-[180px]">{v('player')}</td>
    <td className="text-right py-1 font-semibold truncate max-w-[180px]">{v('enemy')}</td>
  </tr>
);

const Buttons: React.FC<{ ctrl: GameController; again: string }> = ({ ctrl, again }) => (
  <div className="mt-5 flex gap-2">
    <button
      type="button"
      onClick={() => ctrl.restart()}
      className="flex-1 py-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-heading font-bold flex items-center justify-center gap-2"
    >
      <RotateCcw className="w-5 h-5" /> {again}
    </button>
    <button
      type="button"
      onClick={() => ctrl.backToMenu()}
      className="px-4 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold flex items-center justify-center gap-2"
    >
      <Home className="w-5 h-5" /> В меню
    </button>
  </div>
);

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-lg bg-slate-800/60 border border-white/10 p-2">
    <div className="text-[9px] uppercase tracking-wider text-slate-400">{label}</div>
    <div className="font-heading font-bold text-sm truncate">{value}</div>
  </div>
);
