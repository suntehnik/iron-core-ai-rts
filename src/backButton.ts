import { useEffect, useRef } from 'react';

/**
 * The Android Back button. A modal or drawer registers itself with useBackClose while it is open, and Back
 * closes the most recent one. The Android app (android/app/src/main/java/…/MainActivity.kt) hears through
 * `window.ironcoreAndroid` whether anything is open, calls `window.ironcoreBack()` on Back, and goes to the
 * background when nothing was. In a browser nothing calls it.
 */

type Close = () => void;

const stack: Close[] = [];

interface AndroidPort {
  postMessage(message: string): void;
}

let reported = false;

/** Tells the app whether Back has something to close (so the system's own Back works when it does not). */
function report() {
  const open = stack.length > 0;
  if (open === reported) return;
  reported = open;
  const port = (globalThis as { ironcoreAndroid?: AndroidPort }).ironcoreAndroid;
  try {
    port?.postMessage(JSON.stringify({ back: open }));
  } catch {
    /* the app went away */
  }
}

/** Registers what Back closes; the returned function takes it off again. */
export function pushBackClose(close: Close): () => void {
  stack.push(close);
  report();
  return () => {
    const i = stack.lastIndexOf(close);
    if (i >= 0) stack.splice(i, 1);
    report();
  };
}

/** Closes the most recently opened modal or drawer; false when nothing is open. */
export function handleBack(): boolean {
  const close = stack[stack.length - 1];
  if (!close) return false;
  close();
  return true;
}

/** While `open`, Back calls `close` (the latest one passed). */
export function useBackClose(open: boolean, close: Close): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => (open ? pushBackClose(() => latest.current()) : undefined), [open]);
}

if (typeof window !== 'undefined') (window as { ironcoreBack?: () => boolean }).ironcoreBack = handleBack;
