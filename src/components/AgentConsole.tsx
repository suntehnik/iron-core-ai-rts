import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Crosshair, FlaskConical, Gauge, Mic, MicOff, Radar, Send, Shield, X } from 'lucide-react';
import { CHASSIS_CATALOG, MODULES_CATALOG } from '../config/catalog';
import { describeAction } from '../ai/parsing';
import { RobotBuilder } from '../engine/RobotBuilder';
import { GameController } from '../game/GameController';
import { AgentId } from '../types/agent';
import { ModuleCategory } from '../types/robot';
import { EngineerPortrait, TacticianPortrait } from './Portraits';
import { RobotVisualizer } from './RobotVisualizer';
import { TrialPanel } from './TrialPanel';
import { StatBar, cx, fmtCoins } from './ui';

const QUICK: Record<AgentId, string[]> = {
  engineer: [
    'Больше брони, меньше скорости',
    'Усиль переднюю броню и поставь дальнобойную пушку, но не дороже чем на четверть',
    'Быстрые роботы с пилами для фланга',
    'Построй электростанцию и ещё двух добытчиков',
  ],
  tactician: [
    'Держите центр и отводите повреждённых на ремонт',
    'Рейд на вражеских добытчиков',
    'Все в атаку на штаб врага',
    'Бейте с дальней дистанции, фокус огня',
  ],
};

const CAT_ICON: Record<ModuleCategory, React.ReactNode> = {
  armor: <Shield className="w-4 h-4" />,
  weapon: <Crosshair className="w-4 h-4" />,
  engine: <Gauge className="w-4 h-4" />,
  utility: <Radar className="w-4 h-4" />,
};

const AGENT_NAME: Record<AgentId, string> = { engineer: 'Болт · конструктор', tactician: 'Кобра · тактика' };

/** Constructor panel from the concept art + agent dialogue (brief §5, §7). */
export const AgentConsole: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const agent = ctrl.activeAgent;
  const proposal = ctrl.proposal;
  const current = ctrl.state.teams.player.design;
  const shown = proposal?.design ?? current;
  const curStats = RobotBuilder.calculateStats(current);
  const nextStats = proposal?.stats ?? null;
  const curBars = RobotBuilder.bars(curStats);
  const nextBars = nextStats ? RobotBuilder.bars(nextStats) : null;
  const busy = ctrl.director.busy[agent];
  const voice = ctrl.voice;
  const chat = ctrl.chat.filter(m => (m.role === 'commander' ? m.to === agent : m.role === agent || m.role === 'system')).slice(-6);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [chat.length, busy, agent]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || busy) return;
    void ctrl.sendOrder(input);
    setInput('');
  };

  const shownStats = nextStats ?? curStats;
  const slots = Array.from({ length: shownStats.maxSlots }, (_, i) => shown.modules[i]);

  return (
    <div className="hud-panel pointer-events-auto w-[408px] flex flex-col overflow-x-hidden overflow-y-auto max-h-[calc(100vh-84px)]">
      {/* ── Design preview & comparison */}
      <div className="p-2.5 flex gap-2.5 border-b border-white/5">
        <div className="flex flex-col items-center gap-1">
          <RobotVisualizer design={shown} width={142} height={118} />
          <div className="text-[10px] text-slate-400">{CHASSIS_CATALOG[shown.chassisId]?.nameRu}</div>
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-heading font-bold text-sm text-slate-50 truncate">{shown.name}</div>
            <div className={cx('text-[9px] uppercase font-bold tracking-wider shrink-0', proposal?.design ? 'text-amber-300' : 'text-teal-300')}>
              {proposal?.design ? 'проект' : 'в серии'}
            </div>
          </div>
          <StatBar label="БРОНЯ" value={curBars.armor} next={nextBars?.armor} />
          <StatBar label="МОЩЬ" value={curBars.power} next={nextBars?.power} />
          <StatBar label="СКОРОСТЬ" value={curBars.speed} next={nextBars?.speed} />
          <StatBar label="ДАЛЬНОСТЬ" value={curBars.range} next={nextBars?.range} />
          <div className="text-[10px] text-slate-300 mt-0.5 tabular-nums">
            {shownStats.metalCost} М · {shownStats.componentCost} К · сборка {shownStats.buildTimeSec} с
            {nextStats && nextStats.metalCost !== curStats.metalCost && (
              <span className={nextStats.metalCost > curStats.metalCost ? 'text-rose-300' : 'text-emerald-300'}>
                {' '}({nextStats.metalCost > curStats.metalCost ? '+' : ''}
                {Math.round(((nextStats.metalCost - curStats.metalCost) / curStats.metalCost) * 100)}%)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Module slots */}
      <div className="px-2.5 py-1.5 flex items-center gap-1.5 border-b border-white/5">
        {slots.map((id, i) => {
          const m = id ? MODULES_CATALOG[id] : null;
          return (
            <div
              key={i}
              title={m ? `${m.nameRu}: ${m.descriptionRu}` : 'Свободный слот'}
              className={cx(
                'w-9 h-9 rounded-lg border flex items-center justify-center',
                m ? 'bg-slate-700/70 border-teal-300/30 text-teal-100' : 'bg-slate-800/40 border-dashed border-white/15 text-slate-600',
              )}
            >
              {m ? CAT_ICON[m.category] : '+'}
            </div>
          );
        })}
        <div className="ml-auto text-[10px] text-slate-400 text-right leading-tight">
          {shownStats.mass}/{shownStats.maxMass} кг
          <br />
          {shownStats.powerDraw}/{shownStats.powerOutput} кВт
        </div>
      </div>

      {/* ── Pending proposal: confirmation with changes, cost and time */}
      {proposal && (
        <div className="px-2.5 py-2 border-b border-white/5 bg-amber-500/5">
          {nextStats && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-slate-200">
              {RobotBuilder.diff(curStats, nextStats)
                .slice(0, 6)
                .map(d => (
                  <div key={d} className="truncate" title={d}>
                    {d}
                  </div>
                ))}
            </div>
          )}
          {proposal.actions.length > 0 && (
            <ul className="mt-1 text-[10px] text-cyan-200 list-disc pl-4">
              {proposal.actions.map((a, i) => (
                <li key={i}>{describeAction(a)}</li>
              ))}
            </ul>
          )}
          {proposal.warnings.map(w => (
            <div key={w} className="mt-1 text-[10px] text-amber-200 flex gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-px" /> {w}
            </div>
          ))}
          <div className="flex items-center gap-2 mt-1.5">
            <button
              type="button"
              onClick={() => ctrl.confirmProposal()}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
            >
              <Check className="w-3.5 h-3.5" /> {proposal.design ? 'В серию' : 'Выполнить'}
            </button>
            {proposal.design && (
              <button
                type="button"
                onClick={() => ctrl.startTrial()}
                disabled={ctrl.trial?.proposalId === proposal.id && ctrl.trial.status === 'running'}
                aria-label="Испытать"
                title="Испытательный бой против модели врага до запуска в серию. Бесплатно по AI-монетам, вердикт через несколько секунд игрового времени"
                className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-700/80 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs font-semibold"
              >
                <FlaskConical className="w-3.5 h-3.5" /> Испытать
              </button>
            )}
            <button
              type="button"
              onClick={() => ctrl.cancelProposal()}
              className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-semibold"
            >
              <X className="w-3.5 h-3.5" /> Отмена
            </button>
          </div>
          <TrialPanel ctrl={ctrl} />
          <div className="text-[9px] text-slate-400 mt-1">
            Скажите «в серию», «испытай» или «отмена», либо уточните приказ — инженер переделает проект.
          </div>
        </div>
      )}

      {/* ── Agent dialogue */}
      <div className="p-2.5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className={cx('rounded-xl p-0.5', voice.speaking && 'ring-2 ring-teal-300/70 animate-pulse')}>
            {agent === 'engineer' ? <EngineerPortrait size={44} talking={voice.speaking || busy} /> : <TacticianPortrait size={44} talking={voice.speaking || busy} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex bg-slate-800/80 p-0.5 rounded-lg border border-white/10 text-[11px] w-fit">
              {(['engineer', 'tactician'] as AgentId[]).map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => ctrl.setActiveAgent(a)}
                  className={cx('px-2 py-0.5 rounded-md font-semibold transition', agent === a ? 'bg-teal-600 text-white' : 'text-slate-300 hover:text-white')}
                >
                  {AGENT_NAME[a]}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
              {busy ? (
                <span className="text-cyan-300">думает{ctrl.director.cloudEnabled() ? ' (облачный LLM)' : ''}…</span>
              ) : (
                lastCallLine(ctrl, agent)
              )}
            </div>
          </div>
        </div>

        <div ref={logRef} className={cx('overflow-y-auto flex flex-col gap-1 pr-1 shrink-0', proposal ? 'h-[60px]' : 'h-[104px]')}>
          {chat.map(m => (
            <div
              key={m.id}
              className={cx(
                'px-2 py-1 rounded-lg text-[11px] leading-snug max-w-[94%]',
                m.role === 'commander' ? 'self-end bg-teal-700/70 text-white' : 'self-start bg-slate-800/90 text-slate-100 border border-white/5',
              )}
            >
              {m.text}
              {m.role !== 'commander' && m.source && m.source !== 'local' && (
                <span className={cx('ml-1 text-[9px]', m.source === 'llm' ? 'text-emerald-300' : 'text-amber-300')}>
                  [{m.source === 'llm' ? `LLM ${m.latencyMs ? `${(m.latencyMs / 1000).toFixed(1)}с` : ''}${m.costCoins ? ` · ${fmtCoins(m.costCoins)}◎` : ''}` : 'локально'}]
                </span>
              )}
            </div>
          ))}
          {busy && <div className="self-start px-2 py-1 rounded-lg text-[11px] bg-slate-800/70 text-cyan-200 animate-pulse">…</div>}
        </div>

        <form onSubmit={submit} className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => ctrl.toggleListening()}
            title={voice.listening ? 'Остановить запись' : 'Голосовой приказ'}
            aria-label={voice.listening ? 'Остановить запись' : 'Голосовой приказ'}
            className={cx(
              'w-9 h-9 rounded-full flex items-center justify-center border transition shrink-0',
              voice.listening ? 'bg-rose-600 border-rose-300 text-white' : 'bg-teal-600/80 border-teal-300/50 text-white hover:bg-teal-500',
            )}
          >
            {voice.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          {voice.listening ? (
            <div className="flex-1 h-9 rounded-xl border border-teal-300/50 bg-slate-900/80 px-2 flex items-center gap-2 overflow-hidden">
              <div className="flex items-end gap-[2px] h-4 shrink-0">
                {[0, 1, 2, 3, 4].map(i => (
                  <span key={i} className="w-[3px] bg-teal-300 rounded-full voice-bar" style={{ animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
              <span className="text-[11px] text-slate-100 truncate">{voice.transcript || 'Слушаю…'}</span>
            </div>
          ) : (
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={agent === 'engineer' ? 'Приказ инженеру: что изменить в роботе…' : 'Приказ тактику: как воевать…'}
              className="flex-1 h-9 rounded-xl bg-slate-900/80 border border-white/10 px-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-400"
            />
          )}
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="w-9 h-9 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-40 flex items-center justify-center text-white shrink-0"
            aria-label="Отправить"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        {voice.error && <div className="text-[10px] text-rose-300">{voice.error}</div>}

        <div className="flex gap-1 overflow-x-auto no-scrollbar pb-0.5">
          {QUICK[agent].map(q => (
            <button
              key={q}
              type="button"
              disabled={busy}
              onClick={() => void ctrl.sendOrder(q)}
              className="text-[10px] whitespace-nowrap px-2 py-1 rounded-full bg-slate-800/80 border border-white/10 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

function lastCallLine(ctrl: GameController, agent: AgentId): string {
  const c = ctrl.director.lastCall[agent];
  if (!c) return ctrl.director.cloudEnabled() ? 'на связи' : 'облако не настроено — локальный сопроцессор';
  if (c.source === 'llm') return `${c.model ?? 'LLM'} · ${(c.latencyMs / 1000).toFixed(1)} с · ${fmtCoins(c.coins)} монет`;
  return c.error ? `локально: ${c.error}` : 'локальный сопроцессор';
}
