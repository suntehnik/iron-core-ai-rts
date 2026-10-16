import SwiftUI
import Translation

@main
struct IronCoreApp: App {
    var body: some Scene {
        WindowGroup {
            GameScreen()
        }
    }
}

/// The web game full screen, plus the one-time download of the ru⇄en translation languages
/// the on-device agents need in the Russian game (Apple's model has no Russian). The game asks
/// for it through the bridge, so English and Italian players never see the sheet.
struct GameScreen: View {
    @State private var bridge = OnDeviceBridge()
    @State private var translationSetup: TranslationSession.Configuration?

    var body: some View {
        GameWebView(bridge: bridge)
            // Full height, but the HUD stays clear of the Dynamic Island on the sides in landscape
            .ignoresSafeArea(edges: .vertical)
            .background(Color(red: 0.91, green: 0.84, blue: 0.67))
            .statusBarHidden()
            .persistentSystemOverlays(.hidden)
            .onAppear {
                bridge.onPrepareTranslation = {
                    if translationSetup == nil {
                        translationSetup = .init(source: OnDeviceTranslator.russian, target: OnDeviceTranslator.english)
                    } else {
                        translationSetup?.invalidate()
                    }
                }
            }
            .translationTask(translationSetup) { session in
                // Shows the system sheet that downloads the languages; afterwards translation works offline
                try? await session.prepareTranslation()
            }
    }
}
