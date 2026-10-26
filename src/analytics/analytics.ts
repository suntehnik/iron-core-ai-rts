import { AnalyticsValue, EventName, EventParams, UserPropertyName, UserPropertyValue, validateEvent, validateUserProperty } from './events';

/** The player's choice in the settings switch; 'unset' — never touched (the policy decides). */
export type Consent = 'granted' | 'denied' | 'unset';
/**
 * How statistics start before the player has touched the settings switch. 'opt-out': on from the start, with the
 * _ga cookie and the Firebase installation id. 'opt-in': off, and those identifiers appear only after the player
 * turns statistics on. There is no cookieless variant: GA4 ignores `client_storage: 'none'`, and Firebase keeps
 * its installation id in IndexedDB anyway.
 */
export type ConsentPolicy = 'opt-in' | 'opt-out';
/** Why collection is impossible here: vitest, the dev server, the iOS app, localhost without the debug flag, a browser the SDK does not support. */
export type OffReason = 'test' | 'dev' | 'ios' | 'local' | 'preview' | 'unsupported';

export interface AnalyticsEnv {
  off: OffReason | null;
  /** `?analytics_debug=1`: collection on localhost, the dev server and preview channels, events marked for GA DebugView and logged to the console */
  debug: boolean;
  /** Do Not Track or Global Privacy Control: off until the player turns statistics on in the settings */
  privacySignal: boolean;
}

/** What the SDK does for us; the Firebase implementation lives in ./firebase and is loaded lazily. */
export interface AnalyticsBackend {
  logEvent(name: string, params: Record<string, AnalyticsValue>): void;
  setUserProperties(props: Record<string, AnalyticsValue>): void;
  /** Consent update: on — analytics storage granted and collection on; off — both denied */
  setCollection(enabled: boolean): void;
}

export type BackendLoader = (debug: boolean) => Promise<AnalyticsBackend | null>;

export interface ConsentStore {
  get(): string | null;
  set(value: Consent): void;
}

export interface AnalyticsDeps {
  env: AnalyticsEnv;
  policy: ConsentPolicy;
  store: ConsentStore;
  /** null — the build has no SDK at all (the iOS app) */
  loader: BackendLoader | null;
  /** Removes the identifiers the SDK left (the _ga cookies, the Firebase installation id) when the player opts out */
  clearIdentifiers?: () => void;
}

type Pending = { kind: 'event' | 'user'; name: string; params: Record<string, AnalyticsValue> };

/** Events that wait for the SDK to load; more are dropped (a blocked script must not grow memory). */
const QUEUE_MAX = 50;

/**
 * Anonymous product analytics. Nothing is loaded or sent while statistics are off (the settings switch, the policy,
 * Do Not Track); each event is checked against the schema in ./events, and one that breaks it is dropped whole.
 */
export class Analytics {
  private env: AnalyticsEnv;
  private consentValue: Consent;
  private backend: AnalyticsBackend | null = null;
  private loading: Promise<void> | null = null;
  private queue: Pending[] = [];
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(private deps: AnalyticsDeps) {
    this.env = deps.env;
    const saved = deps.store.get();
    this.consentValue = saved === 'granted' || saved === 'denied' ? saved : 'unset';
    if (this.active) void this.load();
  }

  /** Collection is possible in this build and on this host. */
  get available(): boolean {
    return !this.env.off && !!this.deps.loader;
  }

  get consent(): Consent {
    return this.consentValue;
  }

  /** The player's effective choice: an explicit answer, else the policy's default (off under a privacy signal). */
  get enabled(): boolean {
    if (this.consentValue !== 'unset') return this.consentValue === 'granted';
    return this.deps.policy === 'opt-out' && !this.env.privacySignal;
  }

  get active(): boolean {
    return this.available && this.enabled;
  }

  get debug(): boolean {
    return this.env.debug;
  }

  setConsent(granted: boolean) {
    const next: Consent = granted ? 'granted' : 'denied';
    this.deps.store.set(next);
    if (next === this.consentValue) return;
    const was = this.enabled;
    this.consentValue = next;
    if (granted === was) {
      this.emit();
      return;
    }
    if (granted) {
      this.backend?.setCollection(true);
      if (this.active) void this.load();
    } else {
      this.queue = [];
      this.backend?.setCollection(false);
      this.deps.clearIdentifiers?.();
    }
    this.emit();
  }

  /** Sends an event if the player agreed. Returns false when the event breaks the schema (it is dropped). */
  track<E extends EventName>(name: E, params: EventParams<E>): boolean {
    const v = validateEvent(name, params as Record<string, unknown>);
    if (!v.ok) {
      this.warn(v.error);
      return false;
    }
    if (this.active) this.send({ kind: 'event', name, params: v.params });
    return true;
  }

  setUserProperty<P extends UserPropertyName>(name: P, value: UserPropertyValue<P>): boolean {
    const v = validateUserProperty(name, value);
    if (!v.ok) {
      this.warn(v.error);
      return false;
    }
    if (this.active) this.send({ kind: 'user', name, params: v.params });
    return true;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;

  /** Resolves when the SDK has loaded (or failed to); for tests. */
  ready(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  private send(p: Pending) {
    if (this.env.debug) console.info(`[analytics] ${p.name}`, p.params);
    if (!this.backend) {
      if (this.queue.length < QUEUE_MAX) this.queue.push(p);
      return;
    }
    this.deliver(this.backend, p);
  }

  private deliver(backend: AnalyticsBackend, p: Pending) {
    try {
      if (p.kind === 'event') backend.logEvent(p.name, p.params);
      else backend.setUserProperties(p.params);
    } catch (e) {
      this.warn(`delivery failed: ${e instanceof Error ? e.name : 'error'}`);
    }
  }

  private load(): Promise<void> {
    const loader = this.deps.loader;
    if (this.loading || !loader) return this.loading ?? Promise.resolve();
    this.loading = loader(this.env.debug)
      .catch(() => null) // blocked script or no network: no analytics this session
      .then(backend => {
        if (!backend) {
          this.env = { ...this.env, off: 'unsupported' };
          this.queue = [];
          this.emit();
          return;
        }
        this.backend = backend;
        // the player may have opted out while the SDK was loading
        if (!this.active) {
          backend.setCollection(false);
          this.queue = [];
          return;
        }
        const queued = this.queue;
        this.queue = [];
        for (const p of queued) this.deliver(backend, p);
      });
    return this.loading;
  }

  private warn(message: string) {
    if (this.env.debug || this.env.off === 'dev') console.warn(`[analytics] ${message}`);
  }

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
