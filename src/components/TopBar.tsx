import React from "react";
import {
  Box,
  Clock,
  Cog,
  Flag,
  Gem,
  Menu,
  Pause,
  Play,
  Users,
  Zap,
} from "lucide-react";
import { GAME_BALANCE } from "../config/balance";
import { GameController } from "../game/GameController";
import { formatTime } from "./ui";
import { t } from "../i18n";

const Resource: React.FC<{
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  warn?: boolean;
}> = ({ icon, value, label, warn }) => (
  <div
    className={`hud-resource ${warn ? "is-warning" : ""}`}
    title={label}
    aria-label={`${label}: ${value}`}
  >
    {icon}
    <div>
      <strong>{value}</strong>
      <span>{label.split(":")[0]}</span>
    </div>
  </div>
);

export const TopBar: React.FC<{
  ctrl: GameController;
  onOpenSettings?: () => void;
}> = ({ ctrl }) => {
  const s = ctrl.state,
    e = s.teams.player.economy;
  return (
    <>
      <header className="hud-top hud-panel" aria-label={t("layout.controls")}>
        <div className="hud-resources">
          <Resource
            icon={<Box />}
            value={Math.floor(e.metal)}
            label={t("top.metal")}
          />
          <Resource
            icon={<Cog />}
            value={Math.floor(e.components)}
            label={t("top.components")}
          />
          <Resource
            icon={<Zap />}
            value={`${Math.round(e.powerDemand)}/${e.powerCapacity}`}
            label={t("top.power")}
            warn={e.powerEfficiency < 0.99}
          />
          {s.crystals && (
            <Resource
              icon={<Gem />}
              value={Math.floor(e.crystals)}
              label={t("top.crystals")}
            />
          )}
          <Resource
            icon={<Users />}
            value={`${s.combatCount("player")}/${GAME_BALANCE.MAX_ACTIVE_COMBAT_BOTS}`}
            label={t("top.armySub")}
          />
        </div>
        <div className="hud-time" title={t("top.time")}>
          <Clock />
          <strong>{formatTime(s.gameTime)}</strong>
        </div>
        <div className="hq-pair">
          <BaseHp
            label={t("top.ourHq")}
            pct={s.baseHpPct("player")}
            team="player"
          />
          <BaseHp
            label={t("top.enemyHq")}
            pct={s.baseHpPct("enemy")}
            team="enemy"
          />
        </div>
        {s.level && (
          <span className="hud-level">
            <Flag />
            {t("campaign.levelShort", { n: s.level.n })}
          </span>
        )}
      </header>
      <div className="hud-top-actions">
        <button
          className="hud-panel hud-square"
          onClick={() => ctrl.togglePause()}
          aria-label={s.isPaused ? t("top.resume") : t("top.pause")}
        >
          {s.isPaused ? <Play /> : <Pause />}
        </button>
        <button
          id="match-menu-trigger"
          className="hud-panel hud-square"
          onClick={() => ctrl.backToMenu()}
          aria-label={t("layout.menu")}
          aria-expanded={ctrl.menuOpen}
        >
          <Menu />
        </button>
      </div>
    </>
  );
};
const BaseHp: React.FC<{ label: string; pct: number; team: string }> = ({
  label,
  pct,
  team,
}) => (
  <div className={`hq-status ${team}`} aria-label={`${label}: ${pct}%`}>
    <div>
      <span>{label}</span>
      <strong>{pct}%</strong>
    </div>
    <div className="hq-track">
      <div style={{ width: `${pct}%` }} />
    </div>
  </div>
);
