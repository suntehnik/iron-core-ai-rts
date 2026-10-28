import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ChevronsUp,
  ChevronUp,
  Factory,
  Crosshair,
  Map,
  Mic,
  MicOff,
  X,
  Coins,
  Plus,
  Minus,
} from "lucide-react";
import { useBackClose } from "./backButton";
import { usePhoneLayout, blockPagePinchZoom } from "./components/device";
import { RotateOverlay } from "./components/RotateOverlay";
import { GameController } from "./game/GameController";
import { AgentConsole } from "./components/AgentConsole";
import { BriefingOverlay } from "./components/BriefingOverlay";
import { EventFeed } from "./components/EventFeed";
import { InterceptPanel, Notices } from "./components/InterceptPanel";
import { Minimap } from "./components/Minimap";
import { ProductionPanel } from "./components/ProductionPanel";
import { SettingsModal } from "./components/SettingsModal";
import { SpectatorPanel } from "./components/SpectatorPanel";
import { TacticalPanel } from "./components/TacticalPanel";
import { TopBar } from "./components/TopBar";
import { VictoryModal } from "./components/VictoryModal";
import { GameMenu } from "./components/GameMenu";
import { CoinPanel } from "./components/CoinPanel";
import {
  CommanderPortrait,
  EngineerPortrait,
  TacticianPortrait,
} from "./components/Portraits";
import { GAME_BALANCE } from "./config/balance";
import { MessageKey, t } from "./i18n";
import { fmtCoins } from "./components/ui";

const controller = new GameController();
blockPagePinchZoom();
if (import.meta.env.DEV || import.meta.env.MODE === "ios")
  (window as unknown as { __game: GameController }).__game = controller;
type Surface = "agent" | "production" | "tactics" | "map" | "coins";
const TITLES: Record<Surface, MessageKey> = {
  agent: "layout.agent",
  production: "layout.production",
  tactics: "tac.title",
  map: "layout.journal",
  coins: "coins.title",
};

export const App: React.FC = () => {
  const ctrl = controller;
  const version = useSyncExternalStore(ctrl.subscribe, ctrl.getVersion);
  const canvasRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const [panel, setPanel] = useState<Surface | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const spectator = ctrl.mode === "spectator";
  const phone = usePhoneLayout();
  const billing = ctrl.director.billing.snapshot();
  const lastReply = [...ctrl.chat]
    .reverse()
    .find((m) => m.role === ctrl.activeAgent || m.role === "system");
  const busy = ctrl.director.busy[ctrl.activeAgent];
  const toggle = (next: Surface) => setPanel((p) => (p === next ? null : next));
  const close = () => {
    setPanel(null);
    railRef.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus();
  };
  useBackClose(!!panel && ctrl.started && !ctrl.menuOpen && !settingsOpen && !ctrl.state.gameOver, close);
  useBackClose(ctrl.menuOpen && !settingsOpen, () => ctrl.closeMenu());
  useBackClose(settingsOpen, () => setSettingsOpen(false));
  useEffect(() => {
    if (!canvasRef.current) return;
    ctrl.attachScene(canvasRef.current);
    return () => ctrl.detachScene();
  }, [ctrl]);
  useEffect(() => {
    if (panel) closeRef.current?.focus();
  }, [panel]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !ctrl.menuOpen && !settingsOpen) {
        close();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ctrl, settingsOpen]);
  useEffect(() => {
    // Use the actual visible height and a focused editing mode when a keyboard consumes the field.
    let frame = 0;
    const update = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      const editing =
        document.activeElement?.matches(
          "input:not([type=range]):not([type=checkbox]),textarea",
        ) ?? false;
      document.documentElement.style.setProperty(
        "--visible-height",
        `${height}px`,
      );
      document.documentElement.dataset.keyboardOpen = String(
        editing && (height < 300 || height < window.innerHeight - 80),
      );
    };
    const focus = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    window.addEventListener("focusin", focus);
    window.addEventListener("focusout", focus);
    return () => {
      cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("focusin", focus);
      window.removeEventListener("focusout", focus);
      delete document.documentElement.dataset.keyboardOpen;
    };
  }, []);
  return (
    <div className={`game-shell ${phone ? "phone" : ""} ${panel ? "has-panel" : ""}`}>
      <div ref={canvasRef} className="game-scene" />
      <div
        className="game-hud"
        {...(ctrl.menuOpen ||
        settingsOpen ||
        !ctrl.started ||
        !!ctrl.state.gameOver
          ? { inert: "" }
          : {})}
      >
        <TopBar ctrl={ctrl} />
        <nav
          ref={railRef}
          className="command-rail hud-panel"
          aria-label={t("layout.rail")}
        >
          <RailButton
            icon={<ChevronsUp />}
            name={t(spectator ? "top.aiVsAi" : "layout.order")}
            selected={panel === "agent"}
            onClick={() => toggle("agent")}
            badge={!!ctrl.proposal}
          />
          <RailButton
            icon={<Factory />}
            name={t("layout.factory")}
            selected={panel === "production"}
            onClick={() => toggle("production")}
            disabled={spectator}
          />
          <RailButton
            icon={<Crosshair />}
            name={t("layout.tactics")}
            selected={panel === "tactics"}
            onClick={() => toggle("tactics")}
            disabled={spectator}
          />
          <RailButton
            icon={<Map />}
            name={t("layout.map")}
            selected={panel === "map"}
            onClick={() => toggle("map")}
          />
          <button
            className={`rail-mic ${ctrl.voice.listening ? "listening" : ""}`}
            aria-label={t(
              ctrl.voice.listening ? "console.stopRec" : "console.voiceOrder",
            )}
            onClick={() => {
              setPanel("agent");
              ctrl.toggleListening();
            }}
            disabled={spectator}
          >
            {ctrl.voice.listening ? <MicOff /> : <Mic />}
          </button>
        </nav>
        <div className="minimap-slot">
          <Minimap ctrl={ctrl} version={version} />
        </div>
        {!panel && (
          <button
            className="agent-reply hud-panel"
            onClick={() => setPanel("agent")}
            aria-label={t("console.expand")}
          >
            {spectator ? (
              <CommanderPortrait team="player" size={34} />
            ) : ctrl.activeAgent === "engineer" ? (
              <EngineerPortrait size={34} />
            ) : (
              <TacticianPortrait size={34} />
            )}
            <span aria-live="polite">
              {spectator
                ? (ctrl.intercepts[0]?.text ?? t("spec.firstDecision"))
                : busy
                  ? t("common.thinking")
                  : ctrl.proposal
                    ? t("layout.ready")
                    : (lastReply?.text ?? t("console.online"))}
            </span>
            <ChevronUp />
          </button>
        )}
        <button
          className={`ai-budget ${billing.status !== "ok" ? "is-warning" : ""}`}
          aria-label={t("top.coins")}
          onClick={() => toggle("coins")}
        >
          <Coins />
          {fmtCoins(billing.spentThisMatch)}/{billing.matchLimit}
        </button>
        {ctrl.state.isPaused && ctrl.started && !ctrl.menuOpen && (
          <div className="pause-indicator">{t("app.paused")}</div>
        )}
        <aside
          className="work-panel hud-panel"
          hidden={!panel}
          aria-label={
            panel
              ? t(
                  panel === "agent" && spectator
                    ? "spec.titleShort"
                    : TITLES[panel],
                )
              : undefined
          }
        >
          <header className="work-heading">
            <h2>
              {panel
                ? t(
                    panel === "agent" && spectator
                      ? "spec.titleShort"
                      : TITLES[panel],
                  )
                : ""}
            </h2>
            <button
              ref={closeRef}
              onClick={close}
              aria-label={t("common.close")}
            >
              <X />
            </button>
          </header>
          <div className="work-content">
            <div className="agent-pane" hidden={panel !== "agent"}>
              {spectator ? (
                <SpectatorPanel ctrl={ctrl} />
              ) : (
                <AgentConsole ctrl={ctrl} />
              )}
            </div>
            <div className="scroll-pane" hidden={panel !== "production"}>
              <ProductionPanel ctrl={ctrl} />
            </div>
            <div className="scroll-pane" hidden={panel !== "tactics"}>
              <TacticalPanel ctrl={ctrl} />
            </div>
            <div className="scroll-pane map-pane" hidden={panel !== "map"}>
              <div className="camera-actions">
                <button
                  onClick={() => {
                    const hq = ctrl.state.getHQ("player");
                    if (hq) ctrl.focusCamera(hq.pos.x, hq.pos.y);
                  }}
                >
                  {t("layout.base")}
                </button>
                <button
                  onClick={() =>
                    ctrl.focusCamera(
                      GAME_BALANCE.MAP_WIDTH / 2,
                      GAME_BALANCE.MAP_HEIGHT / 2,
                    )
                  }
                >
                  {t("layout.front")}
                </button>
                <button
                  onClick={() => ctrl.zoomCamera(0.85)}
                  aria-label={t("layout.zoomIn")}
                >
                  <Plus />
                </button>
                <button
                  onClick={() => ctrl.zoomCamera(1.15)}
                  aria-label={t("layout.zoomOut")}
                >
                  <Minus />
                </button>
              </div>
              <InterceptPanel ctrl={ctrl} />
              <EventFeed ctrl={ctrl} />
            </div>
            <div className="scroll-pane" hidden={panel !== "coins"}>
              <CoinPanel ctrl={ctrl} onClose={close} />
            </div>
          </div>
        </aside>
        <Notices ctrl={ctrl} />
      </div>
      <RotateOverlay />
      {!ctrl.started && (
        <BriefingOverlay
          ctrl={ctrl}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {ctrl.state.gameOver && <VictoryModal ctrl={ctrl} />}
      {ctrl.menuOpen && !settingsOpen && (
        <GameMenu
          ctrl={ctrl}
          onSettings={() => setSettingsOpen(true)}
          onCoins={() => {
            ctrl.closeMenu();
            setPanel("coins");
          }}
        />
      )}
      {settingsOpen && (
        <SettingsModal ctrl={ctrl} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
};
const RailButton: React.FC<{
  icon: React.ReactNode;
  name: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  badge?: boolean;
}> = ({ icon, name, selected, onClick, disabled, badge }) => (
  <button
    className="rail-button"
    aria-label={name}
    aria-pressed={selected}
    onClick={onClick}
    disabled={disabled}
  >
    {icon}
    <span>{name}</span>
    {badge && <i className="proposal-dot" />}
  </button>
);
