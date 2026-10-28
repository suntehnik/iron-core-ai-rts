import React, { useEffect, useRef, useState } from "react";
import {
  Maximize,
  Minimize,
  Coins,
  Play,
  RotateCcw,
  Settings,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useFullscreen, toggleFullscreen } from "./device";
import { GameController, TIME_SCALES } from "../game/GameController";
import { LanguageSwitch } from "./ui";
import { t } from "../i18n";

export const GameMenu: React.FC<{
  ctrl: GameController;
  onSettings: () => void;
  onCoins: () => void;
}> = ({ ctrl, onSettings, onCoins }) => {
  const fullscreen = useFullscreen();
  const [confirm, setConfirm] = useState<"restart" | "exit" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        ctrl.closeMenu();
      }
      if (e.key !== "Tab") return;
      const buttons = [
        ...ref.current!.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input",
        ),
      ];
      const first = buttons[0],
        last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      (document.getElementById("match-menu-trigger") ?? previous)?.focus();
    };
  }, [ctrl]);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>(
        confirm
          ? ".menu-confirm button:last-child"
          : ".menu-options > button:first-child",
      )
      ?.focus();
  }, [confirm]);
  return (
    <div className="menu-backdrop">
      <div
        ref={ref}
        className="hud-panel match-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-menu-title"
      >
        <header>
          <h2 id="match-menu-title">{t("layout.menu")}</h2>
          <button
            onClick={() => ctrl.closeMenu()}
            aria-label={t("common.close")}
          >
            <X />
          </button>
        </header>
        {confirm ? (
          <div className="menu-confirm">
            <p>{t("layout.confirm")}</p>
            <button
              className="danger"
              onClick={() =>
                confirm === "restart" ? ctrl.restart() : ctrl.leaveMatch()
              }
            >
              {t("layout.yes")}
            </button>
            <button onClick={() => setConfirm(null)}>
              {t("common.cancel")}
            </button>
          </div>
        ) : (
          <div className="menu-options">
            <button className="primary" onClick={() => ctrl.closeMenu()}>
              <Play />
              {t("layout.resume")}
            </button>
            {fullscreen.supported && <button onClick={() => void toggleFullscreen()}>
              {fullscreen.active ? <Minimize /> : <Maximize />}
              {t(fullscreen.active ? 'top.exitFullscreen' : 'top.fullscreen')}
            </button>}
            <button onClick={onSettings}>
              <Settings />
              {t("top.settings")}
            </button>
            <button onClick={onCoins}>
              <Coins />
              {t("layout.ai")}
            </button>
            <button onClick={() => ctrl.toggleMute()}>
              {ctrl.settings.soundMuted ? <VolumeX /> : <Volume2 />}
              {t(ctrl.settings.soundMuted ? "top.soundOn" : "top.soundOff")}
            </button>
            {ctrl.mode === "spectator" && (
              <div className="speed-controls">
                {TIME_SCALES.map((k) => (
                  <button
                    key={k}
                    aria-pressed={ctrl.timeScale === k}
                    onClick={() => ctrl.setTimeScale(k)}
                  >
                    ×{k}
                  </button>
                ))}
              </div>
            )}
            <LanguageSwitch
              value={ctrl.language}
              onChange={(lang) => ctrl.setLanguage(lang)}
            />
            <button onClick={() => setConfirm("restart")}>
              <RotateCcw />
              {t("layout.restart")}
            </button>
            <button className="danger-text" onClick={() => setConfirm("exit")}>
              {t("layout.exit")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
