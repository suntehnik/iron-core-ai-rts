import { useSyncExternalStore } from 'react';
import { hasNativeBridge } from '../ai/llm/nativeBridge';

/**
 * Phones in the browser: the landscape layout, the rotate prompt, fullscreen and the orientation lock.
 * The iOS app (`npm run build:ios`) keeps its own layout: a fixed 1024-px page WebKit scales down to
 * the phone, locked to landscape by the app.
 */
export const IOS_BUILD = import.meta.env.MODE === 'ios';
/** The Android app's build (`vite build --mode android`): the phone layout of the browser, inside a WebView. */
const ANDROID_BUILD = import.meta.env.MODE === 'android';

/**
 * Inside a native wrapper the app owns the screen: no fullscreen button and no rotate prompt.
 * iOS: the build mode, the `ironcore:` scheme or the on-device model bridge. Android: the build mode,
 * or the user agent — the system WebView puts "; wv)" in it, the Iron Core app adds "IronCoreApp/<version>".
 */
export function inNativeApp(): boolean {
  if (IOS_BUILD || ANDROID_BUILD || hasNativeBridge()) return true;
  if (typeof location !== 'undefined' && location.protocol === 'ironcore:') return true;
  return typeof navigator !== 'undefined' && /; wv\)|IronCoreApp/.test(navigator.userAgent);
}

/** A phone in landscape (or a very short window): the compact HUD with drawers and big touch targets. */
const PHONE_QUERY = '(max-height: 500px)';
/** A phone held upright: the game asks to turn it. Tablets in portrait are wide enough to play. */
const PORTRAIT_QUERY = '(orientation: portrait) and (max-width: 540px)';

function mediaStore(query: string, enabled: boolean) {
  const list = enabled && typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined;
  return {
    subscribe: (fn: () => void) => {
      list?.addEventListener('change', fn);
      return () => list?.removeEventListener('change', fn);
    },
    get: () => !!list?.matches,
  };
}

const phone = mediaStore(PHONE_QUERY, !IOS_BUILD);
const portrait = mediaStore(PORTRAIT_QUERY, !inNativeApp());

/** Rendering without a screen (tests render the HUD to a string): the desktop layout. */
const noScreen = () => false;

export function usePhoneLayout(): boolean {
  return useSyncExternalStore(phone.subscribe, phone.get, noScreen);
}

export function usePortraitPhone(): boolean {
  return useSyncExternalStore(portrait.subscribe, portrait.get, noScreen);
}

// ───────────────────────────── Fullscreen ─────────────────────────────

type FsDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = () => document as FsDocument;

/** Opened from the home screen in fullscreen display mode: there is nothing to enter. Read once, before any element fullscreen. */
const LAUNCHED_FULLSCREEN = typeof window !== 'undefined' && !!window.matchMedia?.('(display-mode: fullscreen)').matches;

/** The Fullscreen API works here: desktop browsers, Android Chrome, iPad Safari — not iPhone Safari, not a native wrapper. */
export function fullscreenSupported(): boolean {
  if (typeof document === 'undefined' || LAUNCHED_FULLSCREEN || inNativeApp()) return false;
  return !!(doc().fullscreenEnabled || doc().webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  return typeof document !== 'undefined' && !!(doc().fullscreenElement || doc().webkitFullscreenElement);
}

/** Must run inside a tap or click. Failures (denied, unsupported) are ignored: the game just stays in the page. */
export async function enterFullscreen(): Promise<void> {
  const el = document.documentElement as FsElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else await el.webkitRequestFullscreen?.();
  } catch {
    return;
  }
  await lockLandscape();
}

export async function exitFullscreen(): Promise<void> {
  try {
    if (doc().exitFullscreen) await doc().exitFullscreen();
    else await doc().webkitExitFullscreen?.();
  } catch {
    /* already out */
  }
}

export function toggleFullscreen(): Promise<void> {
  return isFullscreen() ? exitFullscreen() : enterFullscreen();
}

/** Android Chrome turns to landscape in fullscreen; elsewhere lock() is missing or rejects, which is fine. */
export async function lockLandscape(): Promise<void> {
  const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as
    | (ScreenOrientation & { lock?: (o: string) => Promise<void> })
    | undefined;
  try {
    await orientation?.lock?.('landscape');
  } catch {
    /* not supported, or not in fullscreen */
  }
}

let autoFullscreenTried = false;

/** The first «play» tap on a touch screen also takes the game full screen; once, so leaving it sticks. */
export function fullscreenOnFirstPlay(): void {
  if (autoFullscreenTried) return;
  autoFullscreenTried = true;
  if (!fullscreenSupported() || isFullscreen() || !window.matchMedia?.('(pointer: coarse)').matches) return;
  void enterFullscreen();
}

const fullscreenStore = {
  subscribe(fn: () => void) {
    document.addEventListener('fullscreenchange', fn);
    document.addEventListener('webkitfullscreenchange', fn);
    return () => {
      document.removeEventListener('fullscreenchange', fn);
      document.removeEventListener('webkitfullscreenchange', fn);
    };
  },
};

/** Whether the fullscreen button makes sense here, and whether the game is full screen now. */
export function useFullscreen(): { supported: boolean; active: boolean } {
  const active = useSyncExternalStore(fullscreenStore.subscribe, isFullscreen, noScreen);
  return { supported: fullscreenSupported(), active };
}

/**
 * iPhone (and iPad) Safari in a tab: no fullscreen for pages, but «Add to Home Screen» opens the game
 * full screen (the web app manifest, index.html). False once opened from the home screen.
 */
export function suggestHomeScreen(): boolean {
  if (typeof navigator === 'undefined' || inNativeApp() || fullscreenSupported()) return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof window !== 'undefined' && !!window.matchMedia?.('(display-mode: standalone)').matches);
  return ios && !standalone;
}

/** Safari ignores user-scalable=no; its pinch gesture events can still be cancelled over the game. */
export function blockPagePinchZoom(): void {
  if (IOS_BUILD || typeof document === 'undefined') return;
  for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, e => e.preventDefault(), { passive: false });
}
