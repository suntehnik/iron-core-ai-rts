package com.ironcore.aicommander

import android.os.Build
import android.os.Bundle
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowManager
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle

/**
 * The game full screen in landscape: system bars hidden (a swipe from the edge shows them for a moment),
 * the screen kept on, the match kept alive through rotation and backgrounding.
 */
class MainActivity : ComponentActivity(), GameWebView.Listener {
    private lateinit var root: FrameLayout
    private lateinit var web: GameWebView

    /** The page has a modal or drawer open: Back closes it instead of leaving the game. */
    private var pageHasBackTarget = false

    private val back = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() = onBack()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // Draw under the camera cutout too; the padding below keeps the game itself clear of it
            window.attributes.layoutInDisplayCutoutMode =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        // A match runs for minutes without a touch (the agents play, or AI against AI): no screen timeout in the game
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG) // chrome://inspect

        root = FrameLayout(this).apply { setBackgroundColor(getColor(R.color.sand)) }
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            // Full height; on the sides the game keeps clear of the cutout on both edges, as the iOS app does
            // around the Dynamic Island, so it stays centred whichever way the phone is turned.
            val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            val side = maxOf(cutout.left, cutout.right)
            // Edge to edge the window no longer shrinks for the keyboard: the page does, so a focused field stays visible
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            view.setPadding(side, 0, side, keyboard)
            WindowInsetsCompat.CONSUMED
        }
        hideSystemBars()
        onBackPressedDispatcher.addCallback(this, back)
        createWebView()
    }

    private fun createWebView() {
        web = GameWebView(this, this)
        root.addView(web, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        web.start()
    }

    private fun hideSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // after the keyboard, a system dialog or the recent apps screen
        if (hasFocus) hideSystemBars()
    }

    // ───────────────────────────── Back ─────────────────────────────

    // The app takes every Back. Left to the system, Back sends the game to the background only when it was
    // started from the launcher (and on Android 12+); started any other way, or on older versions, the
    // activity is finished and the match with it.
    private fun onBack() {
        if (!pageHasBackTarget) {
            moveTaskToBack(true)
            return
        }
        web.pressBack { closed -> if (!closed) moveTaskToBack(true) }
    }

    override fun onBackTargetChanged(hasTarget: Boolean) {
        pageHasBackTarget = hasTarget
    }

    // ───────────────────────────── Lifecycle ─────────────────────────────

    // Rotation and other configuration changes do not recreate the activity (AndroidManifest.xml).
    // In the background the page stops: no frames, no timers, so the agents do not spend tokens unseen.
    override fun onStart() {
        super.onStart()
        web.onResume()
        web.resumeTimers()
    }

    override fun onStop() {
        web.onPause()
        web.pauseTimers()
        super.onStop()
    }

    override fun onRendererGone() {
        // a renderer that ends with the activity itself needs no new page
        if (isFinishing || isDestroyed) return
        // The page and its match are lost; start the game again instead of crashing the app
        root.removeView(web)
        web.destroy()
        onBackTargetChanged(false)
        createWebView()
        // killed in the background: the new page waits there too (the timers are paused for the whole process)
        if (!lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) web.onPause()
    }

    override fun onDestroy() {
        root.removeView(web)
        web.destroy()
        super.onDestroy()
    }
}
