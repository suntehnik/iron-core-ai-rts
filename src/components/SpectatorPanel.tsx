import React from 'react';
import { Box, Pickaxe, Radio, Shield, Users } from 'lucide-react';
import { MODULES_CATALOG, chassisName, partName } from '../config/catalog';
import { COMMANDERS } from '../config/commanders';
import { GAME_BALANCE, TEAM_COLORS } from '../config/balance';
import { GameController } from '../game/GameController';
import { Team } from '../types/game';
import { CommanderPortrait } from './Portraits';
import { cx, useCompactHud, useRecentInteraction } from './ui';
import { t } from '../i18n';

/**
 * AI-vs-AI mode: both commanders side by side — what they think, build and plan. On a phone it is
 * slimmer and fades almost out while the player only watches, coming back on any touch.
 */
export const SpectatorPanel: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const compact = useCompactHud();
  const active = useRecentInteraction();
  const faded = compact && !active;
  return (
    <div
      className={cx(
        'hud-panel flex flex-col transition-opacity duration-700',
        compact ? 'w-[500px] p-2 gap-1.5' : 'w-[640px] max-w-[calc(100vw-560px)] min-w-[480px] p-2.5 gap-2',
        // faded: see-through and click-through, so the battlefield behind stays usable
        faded ? 'opacity-30 pointer-events-none' : 'opacity-100 pointer-events-auto',
      )}
    >
      <div className="flex items-center justify-between px-0.5">
        <div className="font-heading text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300 flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 text-cyan-300" /> {compact ? t('spec.titleShort') : t('spec.title')}
        </div>
        {!compact && (
          <div className="text-[10px] text-slate-400">
            {t('spec.pacing', { beat: GAME_BALANCE.AI_COMMANDER_HEARTBEAT_SEC, cd: GAME_BALANCE.AI_EVENT_REPLAN_COOLDOWN_SEC })}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <CommanderColumn ctrl={ctrl} team="player" compact={compact} />
        <CommanderColumn ctrl={ctrl} team="enemy" compact={compact} />
      </div>
    </div>
  );
};

const CommanderColumn: React.FC<{ ctrl: GameController; team: Team; compact: boolean }> = ({ ctrl, team, compact }) => {
  const s = ctrl.state;
  const side = s.teams[team];
  const profile = COMMANDERS[team];
  const color = TEAM_COLORS[team];
  const key = team === 'enemy' ? 'enemy' : 'ally';
  const call = ctrl.director.lastCall[key];
  const busy = ctrl.director.busy[key];
  const lastTaunt = ctrl.intercepts.find(i => i.team === team);
  const instructions = ctrl.director.commanderInstructions[team];
  const army = s.combatCount(team);
  const harvesters = s.harvesterCount(team);
  const hq = s.baseHpPct(team);
  const modules = side.design.modules.map(id => MODULES_CATALOG[id]).filter(Boolean);

  return (
    <div className={cx('rounded-xl bg-slate-900/60 border flex flex-col text-[11px]', compact ? 'p-1.5 gap-1' : 'p-2 gap-1.5')} style={{ borderColor: `${color.main}55` }}>
      <div className="flex items-center gap-2">
        <div className={cx('rounded-lg', busy && 'animate-pulse')}>
          <CommanderPortrait team={team} size={compact ? 28 : 36} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-heading font-bold text-[13px] truncate" style={{ color: color.light }}>
            {profile.name}
          </div>
          <div className="text-[10px] text-slate-400 truncate">
            {busy ? (
              <span className="text-cyan-300">{t('common.thinking')}</span>
            ) : call ? (
              call.source === 'llm' ? (
                <span className="text-emerald-300">{t('spec.llmLatency', { s: (call.latencyMs / 1000).toFixed(1) })}</span>
              ) : (
                <span className="text-amber-300">{call.error ? t('spec.rulesWhy', { why: call.error }) : t('source.rules')}</span>
              )
            ) : (
              t('spec.firstDecision')
            )}
          </div>
        </div>
      </div>

      <div className={cx('rounded-lg bg-slate-800/70 px-2 py-1 text-slate-100 leading-snug', compact ? 'line-clamp-1' : 'min-h-[30px]')}>
        {lastTaunt ? `«${lastTaunt.text}»` : <span className="text-slate-500">{t('spec.silent')}</span>}
      </div>
      {instructions && (
        <div className={cx('text-[10px] text-teal-200/90 leading-snug', compact ? 'line-clamp-1' : 'line-clamp-2')} title={instructions}>
          <span className="text-slate-400">{t('spec.orders')}</span>
          {instructions}
        </div>
      )}

      <div className={cx('leading-snug', compact && 'truncate')}>
        <span className="text-slate-400">{t('spec.series')}</span>
        <span className="text-slate-100 font-semibold">{side.design.name}</span>
        <span className="text-slate-400"> · {chassisName(side.design.chassisId)}</span>
        {!compact && (
          <div className="text-[10px] text-slate-400 truncate" title={modules.map(m => partName(m.id)).join(', ')}>
            {modules.map(m => partName(m.id)).join(' · ') || t('spec.noModules')}
          </div>
        )}
      </div>
      <div className={cx('text-[10px] text-slate-300 leading-snug', compact ? 'line-clamp-1' : 'line-clamp-2')} title={side.plan.summaryRu}>
        <span className="text-slate-400">{t('spec.plan')}</span>
        {side.plan.summaryRu}
      </div>

      <div className="grid grid-cols-4 gap-1 text-[10px] tabular-nums">
        <Stat icon={<Users className="w-3 h-3" />} value={army} title={t('spec.combat')} />
        <Stat icon={<Pickaxe className="w-3 h-3" />} value={harvesters} title={t('spec.harvesters')} />
        <Stat icon={<Box className="w-3 h-3" />} value={Math.floor(side.economy.metal)} title={t('spec.metal')} />
        <Stat icon={<Shield className="w-3 h-3" />} value={`${hq}%`} title={t('spec.hq')} />
      </div>
      <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden" title={t('spec.hqPct', { n: hq })}>
        <div className="h-full rounded-full" style={{ width: `${hq}%`, background: color.main }} />
      </div>
      {!compact && (
        <div className="text-[10px] text-slate-400">
          {t('spec.totals', { kills: side.economy.totals.kills, lost: side.economy.totals.unitsLost, built: side.economy.totals.unitsBuilt })}
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ icon: React.ReactNode; value: React.ReactNode; title: string }> = ({ icon, value, title }) => (
  <div className="flex items-center gap-1 rounded-md bg-slate-800/60 px-1.5 py-0.5 text-slate-200" title={title}>
    <span className="text-slate-400">{icon}</span>
    {value}
  </div>
);
