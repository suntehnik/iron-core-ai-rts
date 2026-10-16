import Foundation
import FoundationModels
import Translation
import WebKit

/// `window.webkit.messageHandlers.ironcoreLLM` for the web game (src/ai/llm/nativeBridge.ts):
///   {op: "status"}                                          → {available, reason?, translation, contextSize?}
///   {op: "generate", system, user, maxTokens, temperature, timeoutMs} → {text, tokensIn, tokensOut, estimated}
///   {op: "translate", texts, from, to}                     → {texts}
/// A thrown error rejects the JavaScript promise with its message.
@MainActor
final class OnDeviceBridge: NSObject, WKScriptMessageHandlerWithReply {
    let generator = OnDeviceGenerator()
    let translator = OnDeviceTranslator()

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            return (nil, "bad message")
        }
        do {
            switch op {
            case "status":
                return (await status(), nil)
            case "generate":
                let reply = try await generator.generate(
                    system: body["system"] as? String ?? "",
                    user: body["user"] as? String ?? "",
                    maxTokens: (body["maxTokens"] as? NSNumber)?.intValue ?? 300,
                    temperature: (body["temperature"] as? NSNumber)?.doubleValue ?? 0.4,
                    timeout: .milliseconds((body["timeoutMs"] as? NSNumber)?.intValue ?? 25000)
                )
                return (reply, nil)
            case "translate":
                let texts = try await translator.translate(
                    body["texts"] as? [String] ?? [],
                    from: body["from"] as? String ?? "ru",
                    to: body["to"] as? String ?? "en"
                )
                return (["texts": texts], nil)
            default:
                return (nil, "unknown op \(op)")
            }
        } catch {
            #if DEBUG
            print("[native] \(op) failed:", String(reflecting: error))
            #endif
            return (nil, Self.describe(error))
        }
    }

    private func status() async -> [String: Any] {
        let model = SystemLanguageModel.default
        var out: [String: Any] = ["translation": await translator.status()]
        switch model.availability {
        case .available:
            out["available"] = true
        case .unavailable(let reason):
            out["available"] = false
            out["reason"] = switch reason {
            case .deviceNotEligible: "deviceNotEligible"
            case .appleIntelligenceNotEnabled: "appleIntelligenceNotEnabled"
            case .modelNotReady: "modelNotReady"
            @unknown default: "unknown"
            }
        }
        if #available(iOS 26.4, *) { out["contextSize"] = model.contextSize }
        return out
    }

    /// Short Russian text for the game UI (shown as «модель на устройстве: …»).
    private static func describe(_ error: any Error) -> String {
        if let e = error as? LanguageModelSession.GenerationError {
            return switch e {
            case .exceededContextWindowSize: "сводка не поместилась в окно модели"
            case .guardrailViolation: "ответ заблокирован фильтром безопасности Apple"
            case .refusal: "модель отказалась отвечать"
            case .unsupportedLanguageOrLocale: "язык запроса не поддерживается"
            case .assetsUnavailable: "модель Apple сейчас недоступна"
            case .rateLimited, .concurrentRequests: "модель занята, попробуйте позже"
            default: "\(e) — \(e.localizedDescription)"
            }
        }
        if error is TimeoutError { return "не ответила вовремя" }
        let ns = error as NSError
        if ns.domain.hasPrefix("FoundationModels") {
            // e.g. -1 in the Simulator when the Mac itself has Apple Intelligence off: the model assets do not load
            return "модель Apple не смогла ответить (код \(ns.code)); в симуляторе нужна Apple Intelligence на Mac"
        }
        if let e = error as? TranslationError { return "перевод недоступен (\(e))" }
        return error.localizedDescription
    }
}

struct TimeoutError: Error {}

/// Apple's on-device model (Foundation Models). Requests run one at a time: the Neural Engine
/// serves one generation anyway, and parallel sessions only slow each other down.
actor OnDeviceGenerator {
    private var tail: Task<Void, Never>?

    func generate(system: String, user: String, maxTokens: Int, temperature: Double, timeout: Duration) async throws -> [String: Any] {
        let previous = tail
        let job = Task { () async throws -> [String: Any] in
            _ = await previous?.result
            return try await Self.run(system: system, user: user, maxTokens: maxTokens, temperature: temperature, timeout: timeout)
        }
        tail = Task { _ = try? await job.value }
        return try await job.value
    }

    private static func run(system: String, user: String, maxTokens: Int, temperature: Double, timeout: Duration) async throws -> [String: Any] {
        let model = SystemLanguageModel.default
        let options = GenerationOptions(temperature: temperature, maximumResponseTokens: maxTokens)
        let text = try await withThrowingTaskGroup(of: String.self) { group in
            group.addTask {
                // A fresh session per call: every agent request carries its whole context
                let session = LanguageModelSession(model: model, instructions: system)
                return try await session.respond(to: user, options: options).content
            }
            group.addTask {
                try await Task.sleep(for: timeout)
                throw TimeoutError()
            }
            defer { group.cancelAll() }
            return try await group.next()!
        }
        var tokensIn = (system.count + user.count) / 4
        var tokensOut = text.count / 4
        var estimated = true
        if #available(iOS 26.4, *) {
            if let i = try? await model.tokenCount(for: Instructions(system)), let u = try? await model.tokenCount(for: user),
               let o = try? await model.tokenCount(for: text) {
                (tokensIn, tokensOut, estimated) = (i + u, o, false)
            }
        }
        return ["text": text, "tokensIn": tokensIn, "tokensOut": tokensOut, "estimated": estimated]
    }
}

/// Apple Translation between Russian (the game) and English (the model). Repeated strings —
/// event texts, model names — come from a cache.
actor OnDeviceTranslator {
    static let russian = Locale.Language(identifier: "ru")
    static let english = Locale.Language(identifier: "en")

    private var sessions: [String: TranslationSession] = [:]
    private var cache: [String: String] = [:]

    /// "installed" | "supported" (languages can be downloaded) | "unsupported"
    func status() async -> String {
        switch await LanguageAvailability().status(from: Self.russian, to: Self.english) {
        case .installed: "installed"
        case .supported: "supported"
        case .unsupported: "unsupported"
        @unknown default: "unknown"
        }
    }

    func needsDownload() async -> Bool {
        await status() == "supported"
    }

    func translate(_ texts: [String], from: String, to: String) async throws -> [String] {
        let pair = "\(from)>\(to)"
        let missing = Array(Set(texts.filter { cache["\(pair)|\($0)"] == nil }))
        if !missing.isEmpty {
            let session = sessions[pair] ?? TranslationSession(installedSource: Locale.Language(identifier: from), target: Locale.Language(identifier: to))
            sessions[pair] = session
            let requests = missing.enumerated().map { TranslationSession.Request(sourceText: $1, clientIdentifier: String($0)) }
            for response in try await session.translations(from: requests) {
                guard let id = response.clientIdentifier, let index = Int(id), missing.indices.contains(index) else { continue }
                cache["\(pair)|\(missing[index])"] = response.targetText
            }
            if cache.count > 2000 { cache.removeAll() }
        }
        return texts.map { cache["\(pair)|\($0)"] ?? $0 }
    }
}
