import React from 'react';
import { Box, Pickaxe, Radio, Shield, Users } from 'lucide-react';
import { CHASSIS_CATALOG, MODULES_CATALOG } from '../config/catalog';
import { COMMANDERS } from '../config/commanders';
import { GAME_BALANCE, TEAM_COLORS } from '../config/balance';
import { GameController } from '../game/GameController';
import { Team } from '../types/game';
import { CommanderPortrait } from './Portraits';
import { cx } from './ui';

/** AI-vs-AI mode: both commanders side by side — what they think, build and plan. */
export const SpectatorPanel: React.FC<{ ctrl: GameController }> = ({ ctrl }) => (
  <div className="hud-panel pointer-events-auto w-[640px] max-w-[calc(100vw-560px)] min-w-[480px] p-2.5 flex flex-col gap-2">
    <div className="flex items-center justify-between px-0.5">
      <div className="font-heading text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300 flex items-center gap-1.5">
        <Radio className="w-3.5 h-3.5 text-cyan-300" /> ИИ против ИИ · эфир командиров
      </div>
      <div className="text-[10px] text-slate-400">
        сводка раз в {GAME_BALANCE.AI_COMMANDER_HEARTBEAT_SEC} с, по событиям боя — не чаще раза в {GAME_BALANCE.AI_EVENT_REPLAN_COOLDOWN_SEC} с; одинаково для обоих
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <CommanderColumn ctrl={ctrl} team="player" />
      <CommanderColumn ctrl={ctrl} team="enemy" />
    </div>
  </div>
);

const CommanderColumn: React.FC<{ ctrl: GameController; team: Team }> = ({ ctrl, team }) => {
  const s = ctrl.state;
  const t = s.teams[team];
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
  const modules = t.design.modules.map(id => MODULES_CATALOG[id]).filter(Boolean);

  return (
    <div className="rounded-xl bg-slate-900/60 border p-2 flex flex-col gap-1.5 text-[11px]" style={{ borderColor: `${color.main}55` }}>
      <div className="flex items-center gap-2">
        <div className={cx('rounded-lg', busy && 'animate-pulse')}>
          <CommanderPortrait team={team} size={36} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-heading font-bold text-[13px] truncate" style={{ color: color.light }}>
            {profile.name}
          </div>
          <div className="text-[10px] text-slate-400 truncate">
            {busy ? (
              <span className="text-cyan-300">думает…</span>
            ) : call ? (
              call.source === 'llm' ? (
                <span className="text-emerald-300">LLM · {(call.latencyMs / 1000).toFixed(1)} с</span>
              ) : (
                <span className="text-amber-300">правила{call.error ? ` (${call.error})` : ''}</span>
              )
            ) : (
              'готовится к первому решению'
            )}
          </div>
        </div>
      </div>

      <div className="min-h-[30px] rounded-lg bg-slate-800/70 px-2 py-1 text-slate-100 leading-snug">
        {lastTaunt ? `«${lastTaunt.text}»` : <span className="text-slate-500">эфир молчит</span>}
      </div>
      {instructions && (
        <div className="text-[10px] text-teal-200/90 leading-snug line-clamp-2" title={instructions}>
          <span className="text-slate-400">Указания штаба: </span>
          {instructions}
        </div>
      )}

      <div className="leading-snug">
        <span className="text-slate-400">Серия: </span>
        <span className="text-slate-100 font-semibold">{t.design.name}</span>
        <span className="text-slate-400"> · {CHASSIS_CATALOG[t.design.chassisId]?.nameRu}</span>
        <div className="text-[10px] text-slate-400 truncate" title={modules.map(m => m.nameRu).join(', ')}>
          {modules.map(m => m.nameRu).join(' · ') || 'без модулей'}
        </div>
      </div>
      <div className="text-[10px] text-slate-300 leading-snug line-clamp-2" title={t.plan.summaryRu}>
        <span className="text-slate-400">План: </span>
        {t.plan.summaryRu}
      </div>

      <div className="grid grid-cols-4 gap-1 text-[10px] tabular-nums">
        <Stat icon={<Users className="w-3 h-3" />} value={army} title="Боевые машины" />
        <Stat icon={<Pickaxe className="w-3 h-3" />} value={harvesters} title="Добытчики" />
        <Stat icon={<Box className="w-3 h-3" />} value={Math.floor(t.economy.metal)} title="Металл" />
        <Stat icon={<Shield className="w-3 h-3" />} value={`${hq}%`} title="Прочность штаба" />
      </div>
      <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden" title={`Штаб ${hq}%`}>
        <div className="h-full rounded-full" style={{ width: `${hq}%`, background: color.main }} />
      </div>
      <div className="text-[10px] text-slate-400">
        Уничтожено {t.economy.totals.kills} · потеряно {t.economy.totals.unitsLost} · выпущено {t.economy.totals.unitsBuilt}
      </div>
    </div>
  );
};

const Stat: React.FC<{ icon: React.ReactNode; value: React.ReactNode; title: string }> = ({ icon, value, title }) => (
  <div className="flex items-center gap-1 rounded-md bg-slate-800/60 px-1.5 py-0.5 text-slate-200" title={title}>
    <span className="text-slate-400">{icon}</span>
    {value}
  </div>
);
