import { initializeApp } from 'firebase/app';
import { initializeAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled, setConsent, setUserProperties } from 'firebase/analytics';
import type { AnalyticsBackend } from './analytics';

/**
 * Web config of the Firebase project `iron-ai-rts`. The apiKey is a public identifier of the web app,
 * not a secret like the LLM keys: restrict it by HTTP referrer in the Google Cloud console.
 * This module is imported dynamically and becomes its own chunk, loaded only after the player agreed.
 */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC2vUfLHNxbvEwr0M2t5w39aFMtNWlNMtU',
  authDomain: 'iron-ai-rts.firebaseapp.com',
  projectId: 'iron-ai-rts',
  storageBucket: 'iron-ai-rts.firebasestorage.app',
  messagingSenderId: '331660587486',
  appId: '1:331660587486:web:19bb65510408dcf682ad4f',
  measurementId: 'G-ECMXYM3VDM',
};

/** Advertising storage and signals stay denied whatever the player chose for statistics. */
const NO_ADS = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', personalization_storage: 'denied' } as const;

export async function loadFirebase(debug: boolean): Promise<AnalyticsBackend | null> {
  if (!(await isSupported())) return null;
  // The SDK is loaded only after the player agreed, so analytics storage (the _ga cookie) starts granted
  setConsent({ ...NO_ADS, analytics_storage: 'granted' });
  const app = initializeApp(FIREBASE_CONFIG);
  const analytics = initializeAnalytics(app, {
    config: {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      ...(debug ? { debug_mode: true } : {}),
    },
  });
  return {
    logEvent: (name, params) => logEvent(analytics, name, debug ? { ...params, debug_mode: true } : params),
    setUserProperties: props => setUserProperties(analytics, props),
    setCollection: enabled => {
      setConsent({ ...NO_ADS, analytics_storage: enabled ? 'granted' : 'denied' });
      setAnalyticsCollectionEnabled(analytics, enabled);
    },
  };
}
