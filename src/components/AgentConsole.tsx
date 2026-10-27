import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Crosshair, FlaskConical, Gauge, Mic, MicOff, Radar, Send, Shield, X } from 'lucide-react';
import { MODULES_CATALOG, chassisName, partDescription, partName } from '../config/catalog';
import { describeAction } from '../ai/parsing';
import { RobotBuilder } from '../engine/RobotBuilder';
import { GameController } from '../game/GameController';
import { AgentId, ProductionProposal } from '../types/agent';
import { CalculatedRobotStats, ModuleCategory } from '../types/robot';
import { EngineerPortrait, TacticianPortrait } from './Portraits';
import { RobotVisualizer } from './RobotVisualizer';
import { TrialPanel } from './TrialPanel';
import { StatBar, cx, fmtCoins, useCompactHud, usePanelOpen } from './ui';
import { MessageKey, t } from '../i18n';

const QUICK: Record<AgentId, MessageKey[]> = {
  engineer: ['quick.engineer.1', 'quick.engineer.2', 'quick.engineer.3', 'quick.engineer.4'],
  tactician: ['quick.tactician.1', 'quick.tactician.2', 'quick.tactician.3', 'quick.tactician.4'],
};

const CAT_ICON: Record<ModuleCategory, React.ReactNode> = {
  armor: <Shield className="w-4 h-4" />,
  weapon: <Crosshair className="w-4 h-4" />,
  engine: <Gauge className="w-4 h-4" />,
  utility: <Radar className="w-4 h-4" />,
};

const AGENT_NAME: Record<AgentId, MessageKey> = { engineer: 'agent.engineer', tactician: 'agent.tactician' };

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
  // Short screens (a phone in landscape): a slim command bar; the robot card and the history open on demand
  const compact = useCompactHud();
  const [open, toggle] = usePanelOpen();

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [chat.length, busy, agent, open]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || busy) return;
    void ctrl.sendOrder(input);
    setInput('');
  };

  const form = <OrderForm ctrl={ctrl} agent={agent} busy={busy} input={input} setInput={setInput} onSubmit={submit} />;
  const agentTabs = (
    <div className="flex bg-slate-800/80 p-0.5 rounded-lg border border-white/10 text-[11px] w-fit">
      {(['engineer', 'tactician'] as AgentId[]).map(a => (
        <button
          key={a}
          type="button"
          onClick={() => ctrl.setActiveAgent(a)}
          className={cx(
            'px-2 py-0.5 rounded-md font-semibold transition phone:min-h-[40px] phone:px-3 phone:text-xs',
            agent === a ? 'bg-teal-600 text-white' : 'text-slate-300 hover:text-white',
          )}
        >
          {t(AGENT_NAME[a])}
        </button>
      ))}
    </div>
  );

  if (!open) {
    const lastReply = [...chat].reverse().find(m => m.role !== 'commander');
    return (
      <div className="hud-panel pointer-events-auto w-[360px] flex flex-col gap-1.5 p-2 phone:w-[380px]">
        <div className="flex items-center gap-2">
          {agent === 'engineer' ? <EngineerPortrait size={30} talking={voice.speaking || busy} /> : <TacticianPortrait size={30} talking={voice.speaking || busy} />}
          {agentTabs}
          {busy && <span className="text-[10px] text-cyan-300 animate-pulse">{t('common.thinking')}</span>}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={false}
            title={t('console.expandTitle')}
            aria-label={t('console.expand')}
            className="ml-auto w-7 h-7 rounded-lg bg-slate-800/80 border border-white/10 flex items-center justify-center text-slate-200 hover:bg-slate-700 phone:w-11 phone:h-11"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
        {proposal && <ProposalBox ctrl={ctrl} proposal={proposal} curStats={curStats} nextStats={nextStats} compact />}
        {lastReply && !proposal && <div className="px-1 text-[11px] text-slate-200 leading-snug line-clamp-2 phone:text-xs">{lastReply.text}</div>}
        {form}
      </div>
    );
  }

  const shownStats = nextStats ?? curStats;
  const slots = Array.from({ length: shownStats.maxSlots }, (_, i) => shown.modules[i]);

  return (
    <div className="hud-panel pointer-events-auto w-[408px] flex flex-col overflow-x-hidden overflow-y-auto overscroll-contain max-h-[calc(100vh-84px)] phone:max-h-full">
      {/* ── Design preview & comparison */}
      <div className="p-2.5 flex gap-2.5 border-b border-white/5">
        <div className="flex flex-col items-center gap-1">
          <RobotVisualizer design={shown} width={142} height={118} />
          <div className="text-[10px] text-slate-400">{chassisName(shown.chassisId)}</div>
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-heading font-bold text-sm text-slate-50 truncate">{shown.name}</div>
            <div className={cx('text-[9px] uppercase font-bold tracking-wider shrink-0', proposal?.design ? 'text-amber-300' : 'text-teal-300')}>
              {proposal?.design ? t('console.proposal') : t('console.inSeries')}
            </div>
          </div>
          <StatBar label={t('bar.armor')} value={curBars.armor} next={nextBars?.armor} />
          <StatBar label={t('bar.power')} value={curBars.power} next={nextBars?.power} />
          <StatBar label={t('bar.speed')} value={curBars.speed} next={nextBars?.speed} />
          <StatBar label={t('bar.range')} value={curBars.range} next={nextBars?.range} />
          <div className="text-[10px] text-slate-300 mt-0.5 tabular-nums">
            {t('console.costLine', { metal: shownStats.metalCost, comp: shownStats.componentCost, sec: shownStats.buildTimeSec })}
            {ctrl.state.crystals && shownStats.crystalCost > 0 && <span className="text-fuchsia-300"> · {t('console.crystals', { n: shownStats.crystalCost })}</span>}
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
              title={m ? `${partName(m.id)}: ${partDescription(m.id)}` : t('console.freeSlot')}
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
          {shownStats.mass}/{shownStats.maxMass} {t('unit.kg')}
          <br />
          {shownStats.powerDraw}/{shownStats.powerOutput} {t('unit.kw')}
        </div>
      </div>

      {/* ── Pending proposal: confirmation with changes, cost and time */}
      {proposal && <ProposalBox ctrl={ctrl} proposal={proposal} curStats={curStats} nextStats={nextStats} />}

      {/* ── Agent dialogue */}
      <div className="p-2.5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className={cx('rounded-xl p-0.5', voice.speaking && 'ring-2 ring-teal-300/70 animate-pulse')}>
            {agent === 'engineer' ? <EngineerPortrait size={44} talking={voice.speaking || busy} /> : <TacticianPortrait size={44} talking={voice.speaking || busy} />}
          </div>
          <div className="flex-1 min-w-0">
            {agentTabs}
            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
              {busy ? (
                <span className="text-cyan-300">{ctrl.director.cloudEnabled() ? t('console.thinkingCloud') : t('common.thinking')}</span>
              ) : (
                lastCallLine(ctrl, agent)
              )}
            </div>
          </div>
          {compact && (
            <button
              type="button"
              onClick={toggle}
              aria-expanded
              aria-label={t('console.collapse')}
              title={t('console.collapseTitle')}
              className="self-start w-7 h-7 rounded-lg bg-slate-800/80 border border-white/10 flex items-center justify-center text-slate-200 hover:bg-slate-700 phone:w-11 phone:h-11"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          )}
        </div>

        <div ref={logRef} className={cx('overflow-y-auto flex flex-col gap-1 pr-1 shrink-0', proposal ? 'h-[60px]' : 'h-[104px]')}>
          {chat.map(m => (
            <div
              key={m.id}
              className={cx(
                'px-2 py-1 rounded-lg text-[11px] leading-snug max-w-[94%] phone:text-xs',
                m.role === 'commander' ? 'self-end bg-teal-700/70 text-white' : 'self-start bg-slate-800/90 text-slate-100 border border-white/5',
              )}
            >
              {m.text}
              {m.role !== 'commander' && m.source && m.source !== 'local' && (
                <span className={cx('ml-1 text-[9px]', m.source === 'llm' ? 'text-emerald-300' : 'text-amber-300')}>
                  [{m.source === 'llm' ? `LLM ${m.latencyMs ? t('unit.sec', { n: (m.latencyMs / 1000).toFixed(1) }) : ''}${m.costCoins ? ` · ${fmtCoins(m.costCoins)}◎` : ''}` : t('console.local')}]
                </span>
              )}
            </div>
          ))}
          {busy && <div className="self-start px-2 py-1 rounded-lg text-[11px] bg-slate-800/70 text-cyan-200 animate-pulse">…</div>}
        </div>

        {form}

        <div className="flex gap-1 overflow-x-auto no-scrollbar pb-0.5">
          {QUICK[agent].map(q => (
            <button
              key={q}
              type="button"
              disabled={busy}
              onClick={() => void ctrl.sendOrder(t(q), agent, 'quick')}
              className="text-[10px] whitespace-nowrap px-2 py-1 rounded-full bg-slate-800/80 border border-white/10 text-slate-300 hover:bg-slate-700 disabled:opacity-40 phone:min-h-[40px] phone:px-3 phone:text-xs"
            >
              {t(q)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/** The engineer's pending proposal: what changes, what it costs, and «В серию / Испытать / Отмена». */
const ProposalBox: React.FC<{
  ctrl: GameController;
  proposal: ProductionProposal;
  curStats: CalculatedRobotStats;
  nextStats: CalculatedRobotStats | null;
  /** command-bar variant for short screens: fewer lines, no hint */
  compact?: boolean;
}> = ({ ctrl, proposal, curStats, nextStats, compact }) => {
  const diff = nextStats ? RobotBuilder.diff(curStats, nextStats).slice(0, compact ? 4 : 6) : [];
  return (
    <div className={cx(compact ? 'rounded-lg px-2 py-1.5 bg-amber-500/10 border border-amber-300/20' : 'px-2.5 py-2 border-b border-white/5 bg-amber-500/5')}>
      {compact && proposal.design && <div className="text-[11px] font-semibold text-amber-100 truncate">{t('console.proposalName', { name: proposal.design.name })}</div>}
      {diff.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-slate-200">
          {diff.map(d => (
            <div key={d} className="truncate" title={d}>
              {d}
            </div>
          ))}
        </div>
      )}
      {proposal.actions.length > 0 && (
        <ul className="mt-1 text-[10px] text-cyan-200 list-disc pl-4">
          {proposal.actions.slice(0, compact ? 2 : undefined).map((a, i) => (
            <li key={i}>{describeAction(a)}</li>
          ))}
        </ul>
      )}
      {proposal.warnings.slice(0, compact ? 1 : undefined).map(w => (
        <div key={w} className={cx('mt-1 text-[10px] text-amber-200 flex gap-1', compact && 'line-clamp-2')}>
          <AlertTriangle className="w-3 h-3 shrink-0 mt-px" /> {w}
        </div>
      ))}
      <div className="flex items-center gap-2 mt-1.5">
        <button
          type="button"
          onClick={() => ctrl.confirmProposal()}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold phone:min-h-[44px]"
        >
          <Check className="w-3.5 h-3.5" /> {proposal.design ? t('console.approve') : t('console.execute')}
        </button>
        {proposal.design && (
          <button
            type="button"
            onClick={() => ctrl.startTrial()}
            disabled={ctrl.trial?.proposalId === proposal.id && ctrl.trial.status === 'running'}
            aria-label={t('console.trial')}
            title={t('console.trialHint')}
            className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-700/80 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs font-semibold phone:min-h-[44px]"
          >
            <FlaskConical className="w-3.5 h-3.5" /> {t('console.trial')}
          </button>
        )}
        <button
          type="button"
          onClick={() => ctrl.cancelProposal()}
          className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-semibold phone:min-h-[44px]"
        >
          <X className="w-3.5 h-3.5" /> {t('common.cancel')}
        </button>
      </div>
      <TrialPanel ctrl={ctrl} />
      {!compact && (
        <div className="text-[9px] text-slate-400 mt-1">
          {t('console.voiceHint')}
        </div>
      )}
    </div>
  );
};

/** Microphone, order field (or the live transcript while listening) and send. */
const OrderForm: React.FC<{
  ctrl: GameController;
  agent: AgentId;
  busy: boolean;
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
}> = ({ ctrl, agent, busy, input, setInput, onSubmit }) => {
  const voice = ctrl.voice;
  return (
    <>
      <form onSubmit={onSubmit} className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => ctrl.toggleListening()}
          title={voice.listening ? t('console.stopRec') : t('console.voiceOrder')}
          aria-label={voice.listening ? t('console.stopRec') : t('console.voiceOrder')}
          className={cx(
            'w-9 h-9 rounded-full flex items-center justify-center border transition shrink-0 phone:w-11 phone:h-11',
            voice.listening ? 'bg-rose-600 border-rose-300 text-white' : 'bg-teal-600/80 border-teal-300/50 text-white hover:bg-teal-500',
          )}
        >
          {voice.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        {voice.listening ? (
          <div className="flex-1 h-9 rounded-xl border border-teal-300/50 bg-slate-900/80 px-2 flex items-center gap-2 overflow-hidden phone:h-11">
            <div className="flex items-end gap-[2px] h-4 shrink-0">
              {[0, 1, 2, 3, 4].map(i => (
                <span key={i} className="w-[3px] bg-teal-300 rounded-full voice-bar" style={{ animationDelay: `${i * 0.12}s` }} />
              ))}
            </div>
            <span className="text-[11px] text-slate-100 truncate">{voice.transcript || t('console.listening')}</span>
          </div>
        ) : (
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={agent === 'engineer' ? t('console.placeholderEngineer') : t('console.placeholderTactician')}
            className="flex-1 min-w-0 h-9 rounded-xl bg-slate-900/80 border border-white/10 px-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-400 phone:h-11 phone:text-sm"
          />
        )}
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="w-9 h-9 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-40 flex items-center justify-center text-white shrink-0 phone:w-11 phone:h-11"
          aria-label={t('console.send')}
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
      {voice.error && <div className="text-[10px] text-rose-300">{voice.error}</div>}
    </>
  );
};

function lastCallLine(ctrl: GameController, agent: AgentId): string {
  const c = ctrl.director.lastCall[agent];
  if (!c) return ctrl.director.cloudEnabled() ? t('console.online') : t('console.noCloud');
  if (c.source === 'llm') return t('console.callLine', { model: c.model ?? 'LLM', s: (c.latencyMs / 1000).toFixed(1), coins: fmtCoins(c.coins) });
  return c.error ? t('console.localWhy', { why: c.error }) : t('console.localCopro');
}
