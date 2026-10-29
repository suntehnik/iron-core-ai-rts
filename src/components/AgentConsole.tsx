import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Crosshair,
  FlaskConical,
  Gauge,
  Mic,
  MicOff,
  Radar,
  Send,
  Shield,
  X,
} from "lucide-react";
import {
  MODULES_CATALOG,
  chassisName,
  partDescription,
  partName,
} from "../config/catalog";
import { describeAction } from "../ai/parsing";
import { RobotBuilder } from "../engine/RobotBuilder";
import { GameController } from "../game/GameController";
import { AgentId } from "../types/agent";
import { ModuleCategory } from "../types/robot";
import { EngineerPortrait, TacticianPortrait } from "./Portraits";
import { RobotVisualizer } from "./RobotVisualizer";
import { TrialPanel } from "./TrialPanel";
import { StatBar, fmtCoins } from "./ui";
import { MessageKey, t } from "../i18n";

const QUICK: Record<AgentId, MessageKey[]> = {
  engineer: [
    "quick.engineer.1",
    "quick.engineer.2",
    "quick.engineer.3",
    "quick.engineer.4",
  ],
  tactician: [
    "quick.tactician.1",
    "quick.tactician.2",
    "quick.tactician.3",
    "quick.tactician.4",
  ],
};
const AGENT_NAME: Record<AgentId, MessageKey> = {
  engineer: "agent.engineer",
  tactician: "agent.tactician",
};
const CAT_ICON: Record<ModuleCategory, React.ReactNode> = {
  armor: <Shield />,
  weapon: <Crosshair />,
  engine: <Gauge />,
  utility: <Radar />,
};

/** One persistent agent workspace. Only its body scrolls; orders and approval stay on screen. */
export const AgentConsole: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const [drafts, setDrafts] = useState<Record<AgentId, string>>({
    engineer: "",
    tactician: "",
  });
  const agent = ctrl.activeAgent,
    proposal = ctrl.proposal;
  const current = ctrl.state.teams.player.design,
    shown = proposal?.design ?? current;
  const curStats = RobotBuilder.calculateStats(current),
    nextStats = proposal?.stats ?? null;
  const shownStats = nextStats ?? curStats,
    curBars = RobotBuilder.bars(curStats),
    nextBars = nextStats ? RobotBuilder.bars(nextStats) : null;
  const busy = ctrl.director.busy[agent],
    voice = ctrl.voice;
  const chat = ctrl.chat
    .filter((m) =>
      m.role === "commander"
        ? m.to === agent
        : m.role === agent || m.role === "system",
    )
    .slice(-6);
  const lastReply = [...chat].reverse().find((m) => m.role !== "commander");
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [chat.length, busy, agent]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const order = drafts[agent].trim();
    if (!order || busy) return;
    void ctrl.sendOrder(order);
    setDrafts((d) => ({ ...d, [agent]: "" }));
  };
  return (
    <div className="agent-workspace">
      <div className="agent-tabs" role="group" aria-label={t("layout.agent")}>
        {(["engineer", "tactician"] as AgentId[]).map((a) => (
          <button
            key={a}
            aria-pressed={agent === a}
            onClick={() => ctrl.setActiveAgent(a)}
          >
            {t(AGENT_NAME[a])}
          </button>
        ))}
      </div>
      <div className="agent-scroll">
        <div className="agent-status">
          <span>{busy ? t("common.thinking") : lastCallLine(ctrl, agent)}</span>
        </div>
        {proposal && agent === "engineer" ? (
          <>
            <div className="design-summary">
              <RobotVisualizer design={shown} width={88} height={78} />
              <div>
                <strong>{shown.name}</strong>
                <span>
                  {t("console.costLine", {
                    metal: shownStats.metalCost,
                    comp: shownStats.componentCost,
                    sec: shownStats.buildTimeSec,
                  })}
                </span>
                <b className="text-amber-200">{t("console.proposal")}</b>
              </div>
            </div>
            <div className="proposal-diff">
              {nextStats &&
                RobotBuilder.diff(curStats, nextStats).map((d) => (
                  <div key={d}>{d}</div>
                ))}
            </div>
            <p className="design-cost">
              {t("console.costLine", {
                metal: shownStats.metalCost,
                comp: shownStats.componentCost,
                sec: shownStats.buildTimeSec,
              })}
              {ctrl.state.crystals && shownStats.crystalCost > 0
                ? ` · ${t("console.crystals", { n: shownStats.crystalCost })}`
                : ""}
            </p>
            {proposal.actions.length > 0 && (
              <ul className="proposal-orders">
                {proposal.actions.map((a, i) => (
                  <li key={i}>{describeAction(a)}</li>
                ))}
              </ul>
            )}
            {proposal.warnings.map((w) => (
              <p className="proposal-warning" key={w}>
                <AlertTriangle />
                {w}
              </p>
            ))}
            <p className="proposal-hint">{t("console.voiceHint")}</p>
            <TrialPanel ctrl={ctrl} />
          </>
        ) : (
          <>
            <div className="agent-last-reply">
              {agent === "engineer" ? (
                <EngineerPortrait size={40} talking={busy || voice.speaking} />
              ) : (
                <TacticianPortrait size={40} talking={busy || voice.speaking} />
              )}
              <p aria-live="polite">
                {busy ? t("common.thinking") : lastReply?.text}
              </p>
            </div>
          </>
        )}
        <details className="agent-details">
          <summary>
            {t("layout.model")} · {shown.name}
          </summary>
          <div className="design-summary">
            <RobotVisualizer design={shown} width={100} height={84} />
            <div>
              <strong>{shown.name}</strong>
              <span>{chassisName(shown.chassisId)}</span>
              <b>
                {proposal?.design
                  ? t("console.proposal")
                  : t("console.inSeries")}
              </b>
            </div>
          </div>
          <StatBar
            label={t("bar.armor")}
            value={curBars.armor}
            next={nextBars?.armor}
          />
          <StatBar
            label={t("bar.power")}
            value={curBars.power}
            next={nextBars?.power}
          />
          <StatBar
            label={t("bar.speed")}
            value={curBars.speed}
            next={nextBars?.speed}
          />
          <StatBar
            label={t("bar.range")}
            value={curBars.range}
            next={nextBars?.range}
          />
          <p>
            {t("console.costLine", {
              metal: shownStats.metalCost,
              comp: shownStats.componentCost,
              sec: shownStats.buildTimeSec,
            })}
          </p>
          <p>
            {shownStats.mass}/{shownStats.maxMass} {t("unit.kg")} ·{" "}
            {shownStats.powerDraw}/{shownStats.powerOutput} {t("unit.kw")}
          </p>
          <div className="module-slots">
            {Array.from({ length: shownStats.maxSlots }, (_, i) => {
              const m = MODULES_CATALOG[shown.modules[i]];
              return (
                <span
                  key={i}
                  title={
                    m
                      ? `${partName(m.id)}: ${partDescription(m.id)}`
                      : t("console.freeSlot")
                  }
                >
                  {m ? CAT_ICON[m.category] : null}
                </span>
              );
            })}
          </div>
        </details>
        <details className="agent-details">
          <summary>{t("layout.history")}</summary>
          <div
            ref={logRef}
            className="chat-history"
            role="log"
            aria-live="polite"
          >
            {chat.map((m) => (
              <p
                key={m.id}
                className={m.role === "commander" ? "commander-message" : ""}
              >
                {m.text}
                {m.source && m.source !== "local" && (
                  <small>
                    {" "}
                    [{m.source === "llm" ? "LLM" : t("console.local")}]
                  </small>
                )}
              </p>
            ))}
          </div>
        </details>
        <div className="quick-orders">
          {QUICK[agent].map((q) => (
            <button
              key={q}
              disabled={busy}
              onClick={() => void ctrl.sendOrder(t(q), agent, "quick")}
            >
              {t(q)}
            </button>
          ))}
        </div>
      </div>
      <div className="agent-footer">
        {voice.error && (
          <p className="voice-error" role="alert">
            {voice.error}
          </p>
        )}
        <form onSubmit={submit} className="order-form">
          <button
            type="button"
            className={`order-mic ${voice.listening ? "listening" : ""}`}
            onClick={() => ctrl.toggleListening()}
            aria-label={t(
              voice.listening ? "console.stopRec" : "console.voiceOrder",
            )}
          >
            {voice.listening ? <MicOff /> : <Mic />}
          </button>
          {voice.listening ? (
            <div className="live-transcript" aria-live="polite">
              {voice.transcript || t("console.listening")}
            </div>
          ) : (
            <input
              aria-label={t(
                agent === "engineer"
                  ? "console.placeholderEngineer"
                  : "console.placeholderTactician",
              )}
              value={drafts[agent]}
              onChange={(e) =>
                setDrafts((d) => ({ ...d, [agent]: e.target.value }))
              }
              placeholder={t(
                agent === "engineer"
                  ? "console.placeholderEngineer"
                  : "console.placeholderTactician",
              )}
            />
          )}
          <button
            type="submit"
            disabled={busy || !drafts[agent].trim()}
            aria-label={t("console.send")}
          >
            <Send />
          </button>
        </form>
        {proposal && agent === "engineer" && (
          <div className="proposal-actions">
            <button className="primary" onClick={() => ctrl.confirmProposal()}>
              <Check />
              {proposal.design ? t("console.approve") : t("console.execute")}
            </button>
            {proposal.design && (
              <button
                onClick={() => ctrl.startTrial()}
                disabled={
                  ctrl.trial?.proposalId === proposal.id &&
                  ctrl.trial.status === "running"
                }
                title={t("console.trialHint")}
              >
                <FlaskConical />
                {t("console.trial")}
              </button>
            )}
            <button
              onClick={() => ctrl.cancelProposal()}
              aria-label={t("common.cancel")}
            >
              <X />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
function lastCallLine(ctrl: GameController, agent: AgentId): string {
  const c = ctrl.director.lastCall[agent];
  if (!c)
    return ctrl.director.cloudEnabled()
      ? t("console.online")
      : t("console.noCloud");
  if (c.source === "llm")
    return t("console.callLine", {
      model: c.model ?? "LLM",
      s: (c.latencyMs / 1000).toFixed(1),
      coins: fmtCoins(c.coins),
    });
  return c.error
    ? t("console.localWhy", { why: c.error })
    : t("console.localCopro");
}
