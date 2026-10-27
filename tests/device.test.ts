import { afterEach, describe, expect, it, vi } from 'vitest';
import { inNativeApp, suggestHomeScreen } from '../src/components/device';

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36',
  wrapperMark: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 IronCoreApp/1.0',
  iPhoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  desktopChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

function browser(userAgent: string, extra: Record<string, unknown> = {}) {
  vi.stubGlobal('navigator', { userAgent, maxTouchPoints: 5, ...extra });
}

describe('phone browser vs native wrapper', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a browser tab is not an app: the fullscreen button and the rotate prompt stay', () => {
    for (const ua of [UA.androidChrome, UA.iPhoneSafari, UA.desktopChrome]) {
      browser(ua);
      expect(inNativeApp(), ua).toBe(false);
    }
  });

  it('the Android system WebView, a wrapper that marks its user agent, and the iOS bridge are apps', () => {
    browser(UA.androidWebView);
    expect(inNativeApp()).toBe(true);
    browser(UA.wrapperMark);
    expect(inNativeApp()).toBe(true);
    browser(UA.iPhoneSafari);
    vi.stubGlobal('webkit', { messageHandlers: { ironcoreLLM: { postMessage: async () => null } } });
    expect(inNativeApp()).toBe(true);
  });

  it('suggests «Add to Home Screen» only in iPhone Safari outside the home-screen app', () => {
    browser(UA.iPhoneSafari);
    expect(suggestHomeScreen()).toBe(true);
    browser(UA.iPhoneSafari, { standalone: true });
    expect(suggestHomeScreen()).toBe(false);
    browser(UA.androidChrome);
    expect(suggestHomeScreen()).toBe(false);
    browser(UA.androidWebView);
    expect(suggestHomeScreen()).toBe(false);
  });
});
