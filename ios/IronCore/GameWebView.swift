import SwiftUI
import WebKit

/// Hosts the web build of the game (the `Web` folder of the bundle) and exposes the on-device
/// model to it as `window.webkit.messageHandlers.ironcoreLLM`.
struct GameWebView: UIViewRepresentable {
    let bridge: OnDeviceBridge

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(WebAssetSchemeHandler(), forURLScheme: WebAssetSchemeHandler.scheme)
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "ironcoreLLM")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        web.isInspectable = true // Safari → Develop → Simulator / iPhone
        DebugHarness.install(in: config.userContentController)
        #endif
        web.load(URLRequest(url: WebAssetSchemeHandler.startURL))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Serves the bundled web build under `ironcore://app/…`. A custom scheme (instead of file://) gives
/// the page a proper origin, so ES modules, fetch and localStorage behave as on a web server.
final class WebAssetSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "ironcore"
    static let startURL = URL(string: "\(scheme)://app/index.html")!

    private let root = Bundle.main.url(forResource: "Web", withExtension: nil)

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        // Only files inside Web/: "../" in a request must not reach the rest of the bundle
        let file = root?.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard let root, let file, file.path.hasPrefix(root.standardizedFileURL.path + "/"), let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!)
            task.didReceive(Data("not found".utf8))
            task.didFinish()
            return
        }
        let headers = ["Content-Type": Self.mimeType(for: file.pathExtension), "Content-Length": String(data.count), "Cache-Control": "no-cache"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": "text/html; charset=utf-8"
        case "js", "mjs": "text/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "json", "map": "application/json"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "woff2": "font/woff2"
        case "wasm": "application/wasm"
        default: "application/octet-stream"
        }
    }
}
