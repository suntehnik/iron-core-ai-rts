import { hasNativeBridge } from '../ai/llm/nativeBridge';
import { Analytics, AnalyticsEnv, BackendLoader, Consent, ConsentPolicy, ConsentStore } from './analytics';
import { isLocalHost, isPreviewChannelHost } from './matchStats';

export * from './analytics';
export * from './events';
export { LLMMatchStats, classifyLLMError, durationBucket, latencyBucket, providerKind } from './matchStats';

/**
 * The one switch between the two consent models (see ConsentPolicy): 'opt-in' — off until the player says yes;
 * 'opt-out' — on from the start (the _ga cookie included) until the player turns it off in the settings.
 */
export const CONSENT_POLICY: ConsentPolicy = 'opt-in';

const CONSENT_KEY = 'ironcore_analytics_v1';
const DEBUG_PARAM = 'analytics_debug';

/**
 * Where collection is possible. Off in vitest, on the dev server, in the iOS app (it serves the game
 * from the bundle, ios/IronCore/GameWebView.swift), on localhost and on Firebase Hosting preview channels;
 * `?analytics_debug=1` turns it on for a check there (dev server, `vite preview`, a preview channel) and
 * marks the events for GA DebugView.
 */
export function detectEnv(): AnalyticsEnv {
  const off = (reason: AnalyticsEnv['off']): AnalyticsEnv => ({ off: reason, debug: false, privacySignal: false });
  if (import.meta.env.MODE === 'test' || typeof window === 'undefined') return off('test');
  if (import.meta.env.MODE === 'ios' || location.protocol === 'ironcore:' || hasNativeBridge()) return off('ios');
  let debug = false;
  try {
    debug = new URLSearchParams(location.search).get(DEBUG_PARAM) === '1';
  } catch {
    /* no URL */
  }
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  const privacySignal = nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
  if (!debug && import.meta.env.DEV) return off('dev');
  if (!debug && isLocalHost(location.hostname)) return off('local');
  // Preview channels are test builds: their players would mix into the live site's statistics
  if (!debug && isPreviewChannelHost(location.hostname)) return off('preview');
  return { off: null, debug, privacySignal };
}

const consentStore: ConsentStore = {
  get() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch {
      return null;
    }
  },
  set(value: Consent) {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch {
      /* private mode: the choice lasts this session */
    }
  },
};

/** The _ga cookies on this host and its parent domains, and the Firebase installation id in IndexedDB. */
function clearIdentifiers() {
  try {
    const host = location.hostname.split('.');
    const domains = [''];
    for (let i = 0; i < host.length - 1; i++) domains.push(`; domain=.${host.slice(i).join('.')}`);
    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0].trim();
      if (!/^_ga(_|$)/.test(name)) continue;
      for (const d of domains) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
    }
    for (const db of ['firebase-installations-database', 'firebase-heartbeat-database']) indexedDB?.deleteDatabase(db);
  } catch {
    /* best effort */
  }
}

// The iOS build has no SDK at all: the dynamic import is cut out at build time
const loader: BackendLoader | null = import.meta.env.MODE === 'ios' ? null : debug => import('./firebase').then(m => m.loadFirebase(debug));

export const analytics = new Analytics({ env: detectEnv(), policy: CONSENT_POLICY, store: consentStore, loader, clearIdentifiers });
