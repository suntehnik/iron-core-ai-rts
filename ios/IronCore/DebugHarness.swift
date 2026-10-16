#if DEBUG
import WebKit

/// Debug builds only. Forwards the page's console to stdout (`xcrun simctl launch --console-pty …`).
/// Launch arguments: `-autotest` plays a short AI-vs-AI match on the on-device model and prints what
/// the agents did (a smoke test without touching the screen); `-autoplay` skips the start screen,
/// `-autoplay -autoorder` also gives the engineer an order (to see a pending proposal).
enum DebugHarness {
    static func install(in controller: WKUserContentController) {
        controller.add(ConsoleSink(), name: "ironcoreLog")
        controller.addUserScript(WKUserScript(source: consoleForwarder, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-autotest") {
            controller.addUserScript(WKUserScript(source: autotest, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        } else if args.contains("-autoplay") {
            let order = args.contains("-autoorder")
                ? "await window.__game?.sendOrder('Больше брони, меньше скорости', 'engineer'); console.log('[autoplay] chat:', JSON.stringify(window.__game.chat.map(m => m.role + ': ' + m.text)), 'proposal:', JSON.stringify(window.__game.proposal && window.__game.proposal.design && window.__game.proposal.design.name));"
                : ""
            controller.addUserScript(WKUserScript(source: autoplay.replacingOccurrences(of: "/*ORDER*/", with: order), injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
    }

    private final class ConsoleSink: NSObject, WKScriptMessageHandler {
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            print("[web] \(message.body)")
        }
    }

    private static let consoleForwarder = """
    (() => {
      const send = (level, args) => {
        try { window.webkit.messageHandlers.ironcoreLog.postMessage(level + ': ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); } catch {}
      };
      for (const level of ['log', 'warn', 'error']) {
        const orig = console[level].bind(console);
        console[level] = (...args) => { send(level, args); orig(...args); };
      }
      window.addEventListener('error', e => send('error', [e.message + ' @ ' + e.filename + ':' + e.lineno]));
    })();
    """

    private static let autoplay = """
    (async () => {
      for (let i = 0; i < 100 && !window.__game; i++) await new Promise(r => setTimeout(r, 100));
      window.__game?.start('human');
      window.__game?.fastForward(40);
      /*ORDER*/
    })();
    """

    private static let autotest = """
    (async () => {
      const log = (...a) => console.log('[autotest]', ...a);
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 100 && !window.__game; i++) await wait(100);
      const g = window.__game;
      if (!g) return log('no game handle');
      await wait(1500); // native status refresh
      log('provider:', g.settings.provider, '|', g.director.providerLabel());
      const bridge = window.webkit.messageHandlers.ironcoreLLM;
      log('native status:', JSON.stringify(await bridge.postMessage({ op: 'status' })));
      try {
        log('translate ru→en:', JSON.stringify(await bridge.postMessage({ op: 'translate', texts: ['Противник атакует завод!'], from: 'ru', to: 'en' })));
      } catch (e) { log('translate failed:', String(e)); }
      log('connection test:', JSON.stringify(await g.director.testConnection(g.director.connection)));
      g.start('spectator');
      g.fastForward(26); // past both commanders' first reports
      const t0 = Date.now();
      while (Date.now() - t0 < 90000 && !(g.director.lastCall.ally && g.director.lastCall.enemy)) await wait(500);
      for (const key of ['ally', 'enemy']) log(key, JSON.stringify(g.director.lastCall[key]));
      for (const team of ['player', 'enemy']) {
        const t = g.state.teams[team];
        log(team, 'plan:', t.plan.stance + '/' + t.plan.engagementRange, '|', t.plan.summaryRu, '| design:', t.design.name, t.design.chassisId, t.design.modules.join(','));
      }
      log('intercepts:', JSON.stringify(g.intercepts.map(i => i.text)));
      log('done');
    })();
    """
}
#endif
