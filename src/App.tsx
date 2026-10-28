import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Compass, Factory } from 'lucide-react';
import { GameController } from './game/GameController';
import { AgentConsole } from './components/AgentConsole';
import { BriefingOverlay } from './components/BriefingOverlay';
import { IOS_BUILD, blockPagePinchZoom, usePhoneLayout } from './components/device';
import { EventFeed } from './components/EventFeed';
import { InterceptPanel, Notices } from './components/InterceptPanel';
import { Minimap } from './components/Minimap';
import { ProductionPanel, productionSummary } from './components/ProductionPanel';
import { RotateOverlay } from './components/RotateOverlay';
import { SettingsModal } from './components/SettingsModal';
import { SpectatorPanel } from './components/SpectatorPanel';
import { TacticalPanel } from './components/TacticalPanel';
import { TopBar } from './components/TopBar';
import { VictoryModal } from './components/VictoryModal';
import { cx } from './components/ui';
import { t } from './i18n';

const controller = new GameController();
// Dev tools and the iOS app's debug harness (ios/IronCore, -autotest) drive the game through this handle
if (import.meta.env.DEV || import.meta.env.MODE === 'ios') (window as unknown as { __game: GameController }).__game = controller;
blockPagePinchZoom();

type HudProps = { ctrl: GameController; version: number; onOpenSettings: () => void };

export const App: React.FC = () => {
  const ctrl = controller;
  const version = useSyncExternalStore(ctrl.subscribe, ctrl.getVersion);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const phone = usePhoneLayout();

  useEffect(() => {
    if (!canvasRef.current) return;
    ctrl.attachScene(canvasRef.current);
    return () => ctrl.detachScene();
  }, [ctrl]);

  const hud: HudProps = { ctrl, version, onOpenSettings: () => setSettingsOpen(true) };

  return (
    <div className={cx('game-root relative w-screen overflow-hidden select-none font-sans', phone && 'phone')}>
      <div ref={canvasRef} className="absolute inset-0 z-0 touch-none" />

      {/* The iOS app keeps the HUD clear of the Dynamic Island itself (ios/IronCore/IronCoreApp.swift) */}
      <div className={IOS_BUILD ? 'absolute inset-0 pointer-events-none' : 'hud-frame'}>
        {phone ? <PhoneHud {...hud} /> : <DesktopHud {...hud} />}

        {ctrl.state.isPaused && ctrl.started && !ctrl.state.gameOver && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="hud-panel px-6 py-3 font-heading text-xl font-bold tracking-widest text-slate-100">{t('app.paused')}</div>
          </div>
        )}
      </div>

      {!ctrl.started && <BriefingOverlay ctrl={ctrl} onOpenSettings={() => setSettingsOpen(true)} />}
      {ctrl.state.gameOver && <VictoryModal ctrl={ctrl} />}
      {settingsOpen && <SettingsModal ctrl={ctrl} onClose={() => setSettingsOpen(false)} />}
      <RotateOverlay />
    </div>
  );
};

const DesktopHud: React.FC<HudProps> = ({ ctrl, version, onOpenSettings }) => {
  const spectator = ctrl.mode === 'spectator';
  return (
    <>
      <TopBar ctrl={ctrl} onOpenSettings={onOpenSettings} />
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
    </>
  );
};

type Drawer = 'production' | 'tactics' | 'console';

/**
 * Phone in landscape: a slim top bar, the minimap and the agent console in the bottom corners, and the
 * production and army-plan panels behind two buttons on the left. One panel opens at a time, as a wide
 * sheet over the rest: production, the army plan or the expanded console.
 */
const PhoneHud: React.FC<HudProps> = ({ ctrl, version, onOpenSettings }) => {
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const spectator = ctrl.mode === 'spectator';
  // a spectator has no panels to open
  const open = spectator ? null : drawer;
  const close = () => setDrawer(null);
  return (
    <>
      <TopBar ctrl={ctrl} onOpenSettings={onOpenSettings} />
      <Notices ctrl={ctrl} />

      {(open === 'production' || open === 'tactics') && (
        // a wide two-column sheet: a phone in landscape has width to spare, not height
        <div className="absolute left-2 right-2 top-[66px] bottom-2 z-20 flex flex-col items-start pointer-events-none">
          {open === 'production' ? <ProductionPanel ctrl={ctrl} onClose={close} /> : <TacticalPanel ctrl={ctrl} onClose={close} />}
        </div>
      )}

      {!open && (
        <div className="absolute left-2 top-[66px] z-10 flex flex-col gap-1.5 pointer-events-none">
          {!spectator && (
            <>
              <DockButton
                icon={<Factory className="w-4 h-4 text-teal-300" />}
                title={t('prod.title')}
                summary={productionSummary(ctrl)}
                onClick={() => setDrawer('production')}
              />
              <DockButton
                icon={<Compass className="w-4 h-4 text-teal-300" />}
                title={t('tac.title')}
                summary={ctrl.state.teams.player.plan.summaryRu}
                onClick={() => setDrawer('tactics')}
              />
            </>
          )}
          <EventFeed ctrl={ctrl} />
        </div>
      )}

      {!spectator && (
        <div className={cx('absolute right-2 top-[66px] z-10 pointer-events-none', open && 'invisible')}>
          <InterceptPanel ctrl={ctrl} />
        </div>
      )}

      <div className={cx('absolute left-2 bottom-2 z-10 pointer-events-none', open && 'invisible')}>
        <Minimap ctrl={ctrl} version={version} />
      </div>

      {/* The command bar sits in the corner and spreads across the screen when expanded. Under another
          open panel it is hidden, not unmounted: the console keeps its typed order */}
      <div
        className={cx(
          'absolute right-2 top-[66px] bottom-2 z-10 flex flex-col justify-end items-end pointer-events-none',
          open === 'console' ? 'left-2' : open && 'invisible',
        )}
      >
        {spectator ? (
          <SpectatorPanel ctrl={ctrl} />
        ) : (
          <AgentConsole ctrl={ctrl} sheet={{ open: open === 'console', onToggle: () => setDrawer(open === 'console' ? null : 'console') }} />
        )}
      </div>
    </>
  );
};

/** A collapsed panel on the phone: its title and one status line; a tap opens it as a drawer. */
const DockButton: React.FC<{ icon: React.ReactNode; title: string; summary: string; onClick: () => void }> = ({ icon, title, summary, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-expanded={false}
    className="hud-panel pointer-events-auto w-[220px] min-h-[48px] px-3 py-1.5 flex items-center gap-2 text-left hover:brightness-125 transition"
  >
    {icon}
    <span className="flex-1 min-w-0">
      <span className="block font-heading text-[11px] font-bold uppercase tracking-[0.12em] text-slate-200">{title}</span>
      <span className="block text-[11px] text-slate-300 leading-snug truncate">{summary}</span>
    </span>
    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
  </button>
);
