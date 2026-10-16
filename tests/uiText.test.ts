import { afterEach, describe, expect, it } from 'vitest';
import { FC, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentConsole } from '../src/components/AgentConsole';
import { BriefingOverlay } from '../src/components/BriefingOverlay';
import { CoinPanel } from '../src/components/CoinPanel';
import { EventFeed } from '../src/components/EventFeed';
import { InterceptPanel, Notices } from '../src/components/InterceptPanel';
import { Minimap } from '../src/components/Minimap';
import { ProductionPanel } from '../src/components/ProductionPanel';
import { SettingsModal } from '../src/components/SettingsModal';
import { SpectatorPanel } from '../src/components/SpectatorPanel';
import { TacticalPanel } from '../src/components/TacticalPanel';
import { TopBar } from '../src/components/TopBar';
import { TrialPanel } from '../src/components/TrialPanel';
import { VictoryModal } from '../src/components/VictoryModal';
import { GameController } from '../src/game/GameController';
import { LANG_LABEL, setLanguage } from '../src/i18n';

const noop = () => {};

/** Every HUD panel of a match that has been running for a while, as static HTML. */
function renderHud(ctrl: GameController): Record<string, string> {
  const panels: Record<string, [FC<never>, object]> = {
    TopBar: [TopBar, { ctrl, onOpenSettings: noop }],
    BriefingOverlay: [BriefingOverlay, { ctrl, onOpenSettings: noop }],
    SettingsModal: [SettingsModal, { ctrl, onClose: noop }],
    CoinPanel: [CoinPanel, { ctrl, onClose: noop }],
    ProductionPanel: [ProductionPanel, { ctrl }],
    TacticalPanel: [TacticalPanel, { ctrl }],
    AgentConsole: [AgentConsole, { ctrl }],
    TrialPanel: [TrialPanel, { ctrl }],
    SpectatorPanel: [SpectatorPanel, { ctrl }],
    InterceptPanel: [InterceptPanel, { ctrl }],
    Notices: [Notices, { ctrl }],
    EventFeed: [EventFeed, { ctrl }],
    Minimap: [Minimap, { ctrl, version: 0 }],
    VictoryModal: [VictoryModal, { ctrl }],
  };
  return Object.fromEntries(Object.entries(panels).map(([name, [C, props]]) => [name, renderToStaticMarkup(createElement(C, props as never))]));
}

afterEach(() => setLanguage('ru'));

describe('HUD text in the English and Italian game', () => {
  for (const lang of ['en', 'it'] as const) {
    for (const mode of ['human', 'spectator'] as const) {
      it(`${lang}, ${mode}: no Russian left on screen`, () => {
        setLanguage(lang);
        const ctrl = new GameController();
        ctrl.start(mode);
        ctrl.fastForward(90);
        ctrl.state.gameOver = 'player_won';
        const leftovers = Object.entries(renderHud(ctrl))
          .map(([name, html]) => [name, html.replaceAll(LANG_LABEL.ru, '').match(/[а-яё][^<]*/gi)] as const)
          .filter(([, found]) => found)
          .map(([name, found]) => `${name}: ${found!.slice(0, 3).join(' | ')}`);
        expect(leftovers).toEqual([]);
      });
    }
  }
});
