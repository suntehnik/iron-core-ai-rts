package com.ironcore.aicommander

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException

/**
 * Hosts the web build of the game (assets/web, `npm run build:android`) and serves it from
 * https://appassets.androidplatform.net/ through WebViewAssetLoader. A real https origin instead of file://
 * keeps ES modules, fetch, CORS and localStorage as on a web server; the Android twin of
 * ios/IronCore/GameWebView.swift.
 */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class GameWebView(context: Context, private val listener: Listener) : WebView(context) {

    interface Listener {
        /** The page opened or closed a modal or drawer that Back should close first (src/backButton.ts). */
        fun onBackTargetChanged(hasTarget: Boolean)

        /** The renderer crashed or was killed for memory: this view is dead and has to be replaced. */
        fun onRendererGone()
    }

    private val assets = WebViewAssetLoader.Builder()
        .setDomain(HOST)
        .addPathHandler("/", WebRoot(context))
        .build()

    init {
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // localStorage: settings, API keys, campaign progress
            mediaPlaybackRequiresUserGesture = false
            textZoom = 100 // the HUD is laid out in CSS px; the system font size must not break it
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            allowFileAccess = false
            allowContentAccess = false
            // The page is https; a model server at http://<LAN address> is mixed content (network_security_config.xml)
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            // The page hides its browser-only controls (fullscreen button, rotate prompt) in the app
            userAgentString = "$userAgentString IronCoreApp/${BuildConfig.VERSION_NAME}"
        }
        setBackgroundColor(context.getColor(R.color.sand))
        overScrollMode = OVER_SCROLL_NEVER
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        webViewClient = Client()
        webChromeClient = WebChromeClient() // JS dialogs; console messages go to logcat
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            // window.ironcoreAndroid.postMessage(…) exists only on the game's own origin
            WebViewCompat.addWebMessageListener(this, PORT_NAME, setOf(ORIGIN)) { _, message, _, isMainFrame, _ ->
                if (isMainFrame) onPageMessage(message.data)
            }
        }
    }

    fun start() = loadUrl(START_URL)

    /** Lets the page close its topmost modal or drawer; `done(false)` when nothing was open. */
    fun pressBack(done: (Boolean) -> Unit) {
        evaluateJavascript("typeof window.ironcoreBack === 'function' && window.ironcoreBack() === true") { done(it == "true") }
    }

    private fun onPageMessage(data: String?) {
        val json = try {
            JSONObject(data ?: return)
        } catch (_: JSONException) {
            return
        }
        if (json.has("back")) {
            val hasTarget = json.optBoolean("back")
            post { listener.onBackTargetChanged(hasTarget) }
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            // Cloud and LAN model servers go to the network as usual
            if (request.url.host != HOST) return null
            return assets.shouldInterceptRequest(request.url) ?: notFound()
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.host == HOST) return false
            // «Get a key» and other links open in the browser; the game stays
            if (url.scheme == "https" || url.scheme == "http") {
                try {
                    context.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (_: ActivityNotFoundException) {
                    /* no browser */
                }
            }
            return true
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            listener.onRendererGone()
            return true
        }
    }

    /** Files of assets/web at the root of the origin; nothing else from the APK, and a 404 for what is missing. */
    private class WebRoot(private val context: Context) : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse {
            val file = path.ifEmpty { "index.html" }
            if (file.split('/').any { it == ".." || it == "." }) return notFound()
            val stream = try {
                context.assets.open("web/$file")
            } catch (_: IOException) {
                return notFound()
            }
            val type = mimeType(file.substringAfterLast('.', ""))
            val charset = if (type.startsWith("text/") || type == "application/json" || type == "image/svg+xml") "utf-8" else null
            return WebResourceResponse(type, charset, 200, "OK", mapOf("Cache-Control" to "no-cache"), stream)
        }
    }

    companion object {
        const val HOST = WebViewAssetLoader.DEFAULT_DOMAIN // appassets.androidplatform.net
        const val ORIGIN = "https://$HOST"
        const val START_URL = "$ORIGIN/index.html"
        private const val PORT_NAME = "ironcoreAndroid"

        private fun notFound() =
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), "not found".byteInputStream())

        private fun mimeType(ext: String) = when (ext.lowercase()) {
            "html" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json", "map" -> "application/json"
            "webmanifest" -> "application/manifest+json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "ico" -> "image/x-icon"
            "woff2" -> "font/woff2"
            "mp3" -> "audio/mpeg"
            "ogg" -> "audio/ogg"
            "wav" -> "audio/wav"
            "wasm" -> "application/wasm"
            else -> "application/octet-stream"
        }
    }
}
