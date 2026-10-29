import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { ArrowRight, Home, RotateCcw, Skull, Trophy } from 'lucide-react';
import { commanderName } from '../config/commanders';
import { TEAM_COLORS } from '../config/balance';
import { GameController } from '../game/GameController';
import { Team } from '../types/game';
import { usePhoneLayout } from './device';
import { CommanderPortrait } from './Portraits';
import { cx, fmtCoins, formatTime } from './ui';
import { t } from '../i18n';
import { levelConfig } from '../config/levels';
import { levelName } from '../game/levelText';

export const VictoryModal: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const s = ctrl.state;
  const spectator = ctrl.mode === 'spectator';
  const won = s.gameOver === 'player_won';
  const winner: Team = won ? 'player' : 'enemy';
  // Phone in landscape: the trophy beside the title and the stats in two rows, so the buttons stay on screen
  const phone = usePhoneLayout();

  useEffect(() => {
    if (won || spectator) {
      const c = TEAM_COLORS[winner];
      confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 }, colors: [c.main, c.light, '#f2b134', '#efe4cc'] });
    }
  }, [won, spectator, winner]);

  if (spectator) return <SpectatorResult ctrl={ctrl} winner={winner} />;

  const totals = s.teams.player.economy.totals;
  const b = ctrl.director.billing.snapshot();
  const aiCalls = b.services.production.calls + b.services.tactical.calls;

  return (
    <div className="safe-pad fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={cx('hud-panel w-full max-h-full overflow-y-auto text-center text-slate-100', phone ? 'max-w-[700px] p-4' : 'max-w-[520px] p-6')}>
        <div className={cx(phone && 'flex items-center gap-4 text-left')}>
          <div className={`${phone ? 'shrink-0' : 'mx-auto'} w-16 h-16 rounded-2xl flex items-center justify-center ${won ? 'bg-amber-400/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'}`}>
            {won ? <Trophy className="w-9 h-9" /> : <Skull className="w-9 h-9" />}
          </div>
          <div>
            <h1 className={cx('font-heading font-bold', phone ? 'text-2xl' : 'text-3xl mt-3')}>{won ? t('victory.won') : t('victory.lost')}</h1>
            <p className="text-sm text-slate-300 mt-1">
              {won ? t('victory.wonText') : t('victory.lostText')}
            </p>
            {s.level && (
              <p className={`text-sm font-semibold mt-1 ${won ? 'text-amber-200' : 'text-slate-200'}`}>
                {t(won ? 'victory.levelCleared' : 'victory.levelFailed', { n: s.level.n, name: levelName(s.level) })}
              </p>
            )}
          </div>
        </div>
        <div className={cx('grid text-xs', phone ? 'grid-cols-5 gap-1.5 mt-3' : 'grid-cols-3 gap-2 mt-4')}>
          <Stat label={t('stat.matchTime')} value={formatTime(s.gameTime)} />
          <Stat label={t('stat.metal')} value={Math.round(totals.metalMined + totals.scrapReclaimed)} />
          <Stat label={t('stat.built')} value={totals.unitsBuilt} />
          <Stat label={t('stat.kills')} value={totals.kills} />
          <Stat label={t('stat.lost')} value={totals.unitsLost} />
          <Stat label={t('stat.finalModel')} value={s.teams.player.design.name} />
          <Stat label={t('stat.aiCalls')} value={aiCalls} />
          <Stat label={t('stat.coins')} value={fmtCoins(b.spentThisMatch)} />
          <Stat label={t('stat.tokens')} value={`${b.services.production.tokensIn + b.services.tactical.tokensIn}/${b.services.production.tokensOut + b.services.tactical.tokensOut}`} />
        </div>
        {s.level ? (
          won ? (
            <Buttons
              ctrl={ctrl}
              again={t('victory.nextLevel', { n: s.level.n + 1, name: levelName(levelConfig(s.level.n + 1)) })}
              icon={<ArrowRight className="w-5 h-5" />}
              onAgain={() => ctrl.nextLevel()}
            />
          ) : (
            <Buttons ctrl={ctrl} again={t('victory.retryLevel')} />
          )
        ) : (
          <Buttons ctrl={ctrl} again={t('victory.next')} />
        )}
      </div>
    </div>
  );
};

const SpectatorResult: React.FC<{ ctrl: GameController; winner: Team }> = ({ ctrl, winner }) => {
  const s = ctrl.state;
  const b = ctrl.director.billing.snapshot();
  const usage = { player: b.ally, enemy: b.enemy };
  const color = TEAM_COLORS[winner];
  const phone = usePhoneLayout();
  return (
    <div className="safe-pad fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={cx('hud-panel w-full max-w-[600px] max-h-full overflow-y-auto text-center text-slate-100', phone ? 'p-4' : 'p-6')}>
        <div className={cx(phone && 'flex items-center gap-3 text-left')}>
          <div className={phone ? 'shrink-0' : 'mx-auto w-fit'}>
            <CommanderPortrait team={winner} size={phone ? 48 : 64} />
          </div>
          <div>
            <h1 className={cx('font-heading font-bold', phone ? 'text-2xl' : 'text-3xl mt-2')} style={{ color: color.light }}>
              {t('victory.spectatorWinner', { name: commanderName(winner) })}
            </h1>
            <p className="text-sm text-slate-300 mt-1">
              {t('victory.spectatorText', { time: formatTime(s.gameTime), loser: winner === 'player' ? t('army.orangeGen') : t('army.tealGen') })}
            </p>
          </div>
        </div>
        <table className={cx('w-full text-xs tabular-nums', phone ? 'mt-2' : 'mt-4')}>
          <thead className="text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left font-semibold pb-1" />
              {(['player', 'enemy'] as Team[]).map(team => (
                <th key={team} className="text-right font-semibold pb-1" style={{ color: TEAM_COLORS[team].light }}>
                  {commanderName(team)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label={t('stat.metal')} v={team => Math.round(s.teams[team].economy.totals.metalMined + s.teams[team].economy.totals.scrapReclaimed)} />
            <Row label={t('stat.built')} v={team => s.teams[team].economy.totals.unitsBuilt} />
            <Row label={t('stat.kills')} v={team => s.teams[team].economy.totals.kills} />
            <Row label={t('stat.lost')} v={team => s.teams[team].economy.totals.unitsLost} />
            <Row label={t('stat.finalModel')} v={team => s.teams[team].design.name} />
            <Row label={t('stat.llmDecisions')} v={team => `${usage[team].calls} / ${usage[team].errors}`} />
            <Row label={t('stat.tokens')} v={team => `${usage[team].tokensIn}/${usage[team].tokensOut}`} />
          </tbody>
        </table>
        <div className="text-[10px] text-slate-400 mt-2">{t('victory.spectatorNote')}</div>
        <Buttons ctrl={ctrl} again={t('victory.againAi')} />
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

const Buttons: React.FC<{ ctrl: GameController; again: string; icon?: React.ReactNode; onAgain?: () => void }> = ({ ctrl, again, icon, onAgain }) => (
  <div className="mt-5 flex gap-2 phone:mt-3">
    <button
      type="button"
      onClick={() => (onAgain ? onAgain() : ctrl.restart())}
      className="flex-1 py-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-heading font-bold flex items-center justify-center gap-2"
    >
      {icon ?? <RotateCcw className="w-5 h-5" />} {again}
    </button>
    <button
      type="button"
      onClick={() => ctrl.leaveMatch()}
      className="px-4 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold flex items-center justify-center gap-2"
    >
      <Home className="w-5 h-5" /> {t('common.toMenu')}
    </button>
  </div>
);

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-lg bg-slate-800/60 border border-white/10 p-2">
    <div className="text-[9px] uppercase tracking-wider text-slate-400">{label}</div>
    <div className="font-heading font-bold text-sm truncate">{value}</div>
  </div>
);
