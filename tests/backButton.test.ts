import { afterEach, describe, expect, it } from 'vitest';
import { handleBack, pushBackClose } from '../src/backButton';

type Port = { postMessage(message: string): void };
const g = globalThis as { ironcoreAndroid?: Port };

afterEach(() => {
  delete g.ironcoreAndroid;
});

describe('Android Back', () => {
  it('closes the most recently opened first, then reports nothing to close', () => {
    const closed: string[] = [];
    const offSettings = pushBackClose(() => closed.push('settings'));
    const offDrawer = pushBackClose(() => closed.push('drawer'));
    expect(handleBack()).toBe(true);
    expect(closed).toEqual(['drawer']);
    offDrawer();
    expect(handleBack()).toBe(true);
    expect(closed).toEqual(['drawer', 'settings']);
    offSettings();
    expect(handleBack()).toBe(false);
  });

  it('tells the app only when the answer to «anything open?» changes', () => {
    const sent: unknown[] = [];
    g.ironcoreAndroid = { postMessage: m => sent.push(JSON.parse(m)) };
    const offA = pushBackClose(() => {});
    const offB = pushBackClose(() => {});
    offB();
    offA();
    expect(sent).toEqual([{ back: true }, { back: false }]);
  });

  it('works without the app', () => {
    const off = pushBackClose(() => {});
    off();
    expect(handleBack()).toBe(false);
  });
});
