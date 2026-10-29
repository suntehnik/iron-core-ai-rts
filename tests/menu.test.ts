import { afterEach, describe, expect, it } from "vitest";
import { GameController } from "../src/game/GameController";
import { setLanguage } from "../src/i18n";

function match() {
  const ctrl = new GameController();
  ctrl.applySettings({
    ...ctrl.settings,
    provider: "offline",
    enemyUsesLLM: false,
    autonomousTactics: false,
    autoSpeakResponse: false,
    soundMuted: true,
  });
  ctrl.start();
  ctrl.fastForward(12);
  return ctrl;
}
afterEach(() => setLanguage("ru"));

describe("match menu preserves the active match", () => {
  it("pauses without replacing the world, queue, design, proposal, chat or spending", async () => {
    const ctrl = match();
    await ctrl.sendOrder("Больше брони, меньше скорости");
    const state = ctrl.state,
      queue = state.buildings.find(
        (b) => b.team === "player" && b.type === "factory",
      )!.job;
    const proposal = ctrl.proposal,
      chat = [...ctrl.chat],
      time = state.gameTime;
    const economy = { ...state.teams.player.economy },
      billing = ctrl.director.billing.snapshot();
    expect(proposal).not.toBeNull();
    ctrl.backToMenu();
    ctrl.backToMenu(); // repeated opening must not overwrite the original running state
    ctrl.fastForward(10);
    expect(ctrl.menuOpen).toBe(true);
    expect(ctrl.started).toBe(true);
    expect(ctrl.state).toBe(state);
    expect(ctrl.state.gameTime).toBe(time);
    expect(ctrl.state.teams.player.economy).toEqual(economy);
    expect(
      ctrl.state.buildings.find(
        (b) => b.team === "player" && b.type === "factory",
      )!.job,
    ).toBe(queue);
    expect(ctrl.proposal).toBe(proposal);
    expect(ctrl.chat).toEqual(chat);
    expect(ctrl.director.billing.snapshot()).toEqual(billing);
    ctrl.closeMenu();
    expect(ctrl.state.isPaused).toBe(false);
    ctrl.fastForward(1);
    expect(ctrl.state.gameTime).toBeGreaterThan(time);
  });

  it("keeps a manually paused match paused after closing the menu", () => {
    const ctrl = match();
    ctrl.togglePause();
    ctrl.backToMenu();
    ctrl.closeMenu();
    expect(ctrl.state.isPaused).toBe(true);
  });

  it("only explicit restart replaces the match and clears its menu", () => {
    const ctrl = match(),
      before = ctrl.state;
    ctrl.backToMenu();
    ctrl.restart();
    expect(ctrl.menuOpen).toBe(false);
    expect(ctrl.state).not.toBe(before);
    expect(ctrl.state.gameTime).toBe(0);
    expect(ctrl.started).toBe(true);
    expect(ctrl.state.isPaused).toBe(false);
  });

  it("explicit exit returns to mode selection, which can start a new match", () => {
    const ctrl = match();
    ctrl.backToMenu();
    ctrl.leaveMatch();
    expect(ctrl.started).toBe(false);
    expect(ctrl.menuOpen).toBe(false);
    expect(ctrl.state.gameTime).toBe(0);
    ctrl.start("spectator");
    expect(ctrl.started).toBe(true);
    expect(ctrl.mode).toBe("spectator");
  });

  it("does not open a match menu before a match exists", () => {
    const ctrl = new GameController();
    ctrl.backToMenu();
    expect(ctrl.menuOpen).toBe(false);
    expect(ctrl.started).toBe(false);
  });
});
