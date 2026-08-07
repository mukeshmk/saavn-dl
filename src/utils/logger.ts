/**
 * Tiny client-side logger, gated on "debug mode".
 *
 * error/warn always print. info/debug print only when debug mode is on, which
 * is true when EITHER:
 *   - the server reports it via /api/config (logLevel === 'debug' or debug === true), OR
 *   - the user flips it on in the browser (localStorage 'saavn:debug' = '1').
 *
 * The browser toggle is handy on static deployments (no server) and lets you turn
 * on verbose logs without a rebuild. From the devtools console:
 *   saavnDebug(true)   // enable, persists across reloads
 *   saavnDebug(false)  // disable
 *
 * Args are forwarded straight to console.*, so object inspection / format
 * specifiers behave as usual and messages stay greppable via the [scope] prefix.
 */

import { getConfig } from './config';

const LS_KEY = 'saavn:debug';

// Server-reported debug flag. Resolved once, asynchronously; until it lands only
// the localStorage toggle governs. Updating a module-level flag (vs awaiting in
// every log call) keeps logging synchronous at the call site.
let serverDebug = false;
void getConfig().then((cfg) => {
  serverDebug = cfg?.logLevel === 'debug' || cfg?.debug === true;
});

function localDebug(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false; // localStorage can throw in private mode / sandboxed iframes
  }
}

/** Whether verbose (info/debug) client logs should print. */
export function isDebug(): boolean {
  return serverDebug || localDebug();
}

/** Persist the browser-side debug toggle. */
export function setDebug(on: boolean): void {
  try {
    localStorage.setItem(LS_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

// Merge the tag into the format string when the first arg is a string, so
// console's format specifiers (%s, %d, %o) still interpolate against the rest.
function emit(method: 'error' | 'warn' | 'info' | 'debug', tag: string, args: unknown[]): void {
  if (typeof args[0] === 'string') {
    console[method](`${tag} ${args[0]}`, ...args.slice(1));
  } else {
    console[method](tag, ...args);
  }
}

/** Create a scoped logger; `scope` is printed as a `[scope]` prefix. */
export function createLogger(scope: string): Logger {
  const tag = `[${scope}]`;
  return {
    error: (...args) => emit('error', tag, args),
    warn: (...args) => emit('warn', tag, args),
    info: (...args) => { if (isDebug()) emit('info', tag, args); },
    debug: (...args) => { if (isDebug()) emit('debug', tag, args); },
  };
}

// Expose the toggle globally so it can be flipped from the devtools console.
if (typeof window !== 'undefined') {
  (window as unknown as { saavnDebug?: (on?: boolean) => boolean }).saavnDebug = (on = true) => {
    setDebug(on);
    console.info(`[logger] client debug logging ${on ? 'enabled' : 'disabled'}`);
    return on;
  };
}
