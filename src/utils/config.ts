/**
 * Shared app config.
 *
 * Fetches /api/config once and memoizes the result for the session, so the
 * whole app makes a single request instead of each module fetching its own.
 * Returns null when no server is reachable (e.g. static Vercel deployment).
 */

export interface AppConfig {
  forceProxy?: boolean;
  historyEnabled?: boolean;
  libraryEnabled?: boolean;
  musicPathEnabled?: boolean;
  playlistsEnabled?: boolean;
  serverDownloadsEnabled?: boolean;
  /** Active server log level (error|warn|info|debug); mirrored by the client logger. */
  logLevel?: string;
  /** True when the server is running in debug mode. */
  debug?: boolean;
  [key: string]: unknown;
}

let configPromise: Promise<AppConfig | null> | null = null;

export function getConfig(): Promise<AppConfig | null> {
  if (!configPromise) {
    configPromise = fetch('/api/config')
      .then((r) => (r.ok ? (r.json() as Promise<AppConfig>) : null))
      .catch(() => null);
  }
  return configPromise;
}
