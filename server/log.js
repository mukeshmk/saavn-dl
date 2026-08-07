/**
 * Tiny leveled logger shared by every server module.
 *
 * The active level is resolved once at import from the environment:
 *   SAAVN_LOG_LEVEL = error | warn | info | debug   (explicit, wins if valid)
 *   SAAVN_DEBUG     = true | 1                        (shortcut for "debug")
 * Default when neither is set: "info".
 *
 * Messages below the active level are dropped cheaply (a single integer compare).
 * `debug` is where the verbose, per-request / per-track detail lives — enable it
 * with `SAAVN_DEBUG=1` to trace downloads, VPN/proxy routing, syncs and library
 * writes.
 *
 * Usage:
 *   import { createLogger } from '../log.js';
 *   const log = createLogger('downloads/queue');
 *   log.info('job %s started', id);
 *   log.debug('fetched %d bytes from %s', bytes, host);   // only when debug on
 *
 * Line format (pipe-delimited columns, easy to grep / cut / awk):
 *   2026-08-07 19:19:28 | INFO  | downloads/queue    | job track-5 started
 * The timestamp is local time and honors the TZ env var (so it's UTC in a
 * default Docker container, or your wall clock when TZ is set / running locally).
 *
 * Args are forwarded straight to console.*, so util.format specifiers
 * (%s, %d, %o) and lazy object inspection work exactly as usual.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

// stdout for info/debug, stderr for warn/error — matches how the rest of the
// tooling (Docker logs, journald) separates the two streams.
const CONSOLE_METHOD = { error: 'error', warn: 'warn', info: 'log', debug: 'log' };

// Pad the scope column to the widest scope name in use ('downloads/recorder')
// so the message column lines up. Longer scopes overflow gracefully.
const SCOPE_WIDTH = 18;

const pad2 = (n) => String(n).padStart(2, '0');

/** Local-time timestamp as `YYYY-MM-DD HH:mm:ss` (honors the TZ env var). */
function formatTimestamp(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/**
 * Resolve the active level name from an env-like object. Pure + injectable so
 * it can be unit-tested without mutating process.env.
 * @param {Record<string, string|undefined>} [env]
 * @returns {'error'|'warn'|'info'|'debug'}
 */
export function resolveLevel(env = process.env) {
  const explicit = String(env.SAAVN_LOG_LEVEL || '').toLowerCase().trim();
  if (explicit && Object.prototype.hasOwnProperty.call(LEVELS, explicit)) return explicit;
  if (env.SAAVN_DEBUG === 'true' || env.SAAVN_DEBUG === '1') return 'debug';
  return 'info';
}

const activeLevel = resolveLevel();
const threshold = LEVELS[activeLevel];

/** The active level name, e.g. for exposing via /api/config. */
export function getLogLevel() {
  return activeLevel;
}

/** True when debug-level logging is active. */
export function isDebugEnabled() {
  return threshold >= LEVELS.debug;
}

function emit(level, scope, args) {
  if (LEVELS[level] > threshold) return;
  const prefix = `${formatTimestamp()} | ${level.toUpperCase().padEnd(5)} | ${scope.padEnd(SCOPE_WIDTH)} |`;
  // Merge the prefix into the format string when the first arg is a string, so
  // console's util.format specifiers (%s, %d, %o) still interpolate against the
  // remaining args. (util.format only treats arg 0 as the format string.)
  if (typeof args[0] === 'string') {
    console[CONSOLE_METHOD[level]](`${prefix} ${args[0]}`, ...args.slice(1));
  } else {
    console[CONSOLE_METHOD[level]](prefix, ...args);
  }
}

/**
 * Create a scoped logger. `scope` becomes the third pipe-delimited column so
 * log lines stay greppable, e.g. `... | INFO  | downloads/queue    | ...`.
 * @param {string} scope
 */
export function createLogger(scope) {
  return {
    error: (...args) => emit('error', scope, args),
    warn: (...args) => emit('warn', scope, args),
    info: (...args) => emit('info', scope, args),
    debug: (...args) => emit('debug', scope, args),
  };
}
