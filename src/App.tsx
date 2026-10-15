import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GameController } from './game/GameController';
import { AgentConsole } from './components/AgentConsole';
import { BriefingOverlay } from './components/BriefingOverlay';
import { EventFeed } from './components/EventFeed';
import { InterceptPanel, Notices } from './components/InterceptPanel';
import { Minimap } from './components/Minimap';
import { ProductionPanel } from './components/ProductionPanel';
import { SettingsModal } from './components/SettingsModal';
import { SpectatorPanel } from './components/SpectatorPanel';
import { TacticalPanel } from './components/TacticalPanel';
import { TopBar } from './components/TopBar';
import { VictoryModal } from './components/VictoryModal';

const controller = new GameController();
if (import.meta.env.DEV) (window as unknown as { __game: GameController }).__game = controller;

export const App: React.FC = () => {
  const ctrl = controller;
  const version = useSyncExternalStore(ctrl.subscribe, ctrl.getVersion);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    ctrl.attachScene(canvasRef.current);
    return () => ctrl.detachScene();
  }, [ctrl]);

  const spectator = ctrl.mode === 'spectator';

  return (
    <div className="relative w-screen h-screen overflow-hidden select-none font-sans">
      <div ref={canvasRef} className="absolute inset-0 z-0" />

      <TopBar ctrl={ctrl} onOpenSettings={() => setSettingsOpen(true)} />
      <Notices ctrl={ctrl} />

      {/* Left column: production & events */}
      <div className="absolute left-3 top-[76px] z-10 flex flex-col gap-2 pointer-events-none">
        {!spectator && <ProductionPanel ctrl={ctrl} />}
        <EventFeed ctrl={ctrl} />
      </div>

      {/* Right top: intercepted enemy commander radio */}
      {!spectator && (
        <div className="absolute right-3 top-[76px] z-10 pointer-events-none">
          <InterceptPanel ctrl={ctrl} />
        </div>
      )}

      {/* Bottom row: minimap, tactical plan, constructor */}
      <div className="absolute left-3 right-3 bottom-3 z-10 flex items-end gap-2 pointer-events-none">
        <Minimap ctrl={ctrl} version={version} />
        {spectator ? (
          <div className="ml-auto">
            <SpectatorPanel ctrl={ctrl} />
          </div>
        ) : (
          <>
            <TacticalPanel ctrl={ctrl} />
            <div className="ml-auto">
              <AgentConsole ctrl={ctrl} />
            </div>
          </>
        )}
      </div>

      {ctrl.state.isPaused && ctrl.started && !ctrl.state.gameOver && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="hud-panel px-6 py-3 font-heading text-xl font-bold tracking-widest text-slate-100">ПАУЗА</div>
        </div>
      )}

      {!ctrl.started && <BriefingOverlay ctrl={ctrl} onOpenSettings={() => setSettingsOpen(true)} />}
      {ctrl.state.gameOver && <VictoryModal ctrl={ctrl} />}
      {settingsOpen && <SettingsModal ctrl={ctrl} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
};
