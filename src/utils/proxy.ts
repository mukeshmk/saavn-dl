/**
 * Proxied fetch utility.
 * When the app is running behind a server (self-hosted/Docker),
 * all external requests are routed through /api/proxy so they
 * go through the VPN (gluetun). Falls back to direct fetch
 * if the proxy is unavailable (e.g. Vercel static deployment),
 * unless SAAVN_FORCE_PROXY is enabled — in which case requests
 * fail hard instead of falling back.
 */

import { getConfig } from './config';

let forceProxy: boolean = false;

/**
 * Whether the proxy endpoint exists (i.e. a server is present) and whether
 * force-proxy mode is enabled. Backed by the shared, memoized app config.
 */
async function isProxyAvailable(): Promise<boolean> {
  const cfg = await getConfig();
  forceProxy = !!cfg?.forceProxy;
  return cfg !== null;
}

/**
 * Fetch a remote URL through the server-side proxy.
 * If the proxy is not available, falls back to a direct fetch —
 * unless forceProxy is enabled, in which case it throws.
 * Retries up to 2 times on network errors (e.g. truncated body, connection reset).
 */
export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const useProxy = await isProxyAvailable();
  const maxRetries = 2;

  // If proxy is unavailable but force mode is on, fail immediately
  if (!useProxy && forceProxy) {
    throw new Error(
      'Proxy is unavailable and SAAVN_FORCE_PROXY is enabled — refusing to fetch directly. ' +
      'Check that the server is running and /api/proxy is reachable.'
    );
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const fetchUrl = useProxy
        ? `/api/proxy?url=${encodeURIComponent(url)}`
        : url;

      const resp = await fetch(fetchUrl, init);

      // If the server returned 502/504, treat as retryable
      if (useProxy && (resp.status === 502 || resp.status === 504) && attempt < maxRetries) {
        lastError = new Error(`Proxy returned ${resp.status}`);
        await delay(500 * (attempt + 1));
        continue;
      }

      // If proxy returned an error and force mode is on, don't let it silently succeed
      // with a non-OK response that the caller might misinterpret
      if (useProxy && forceProxy && resp.status === 403) {
        throw new Error(
          `Proxy refused the request (403) — the target host may not be in the allowlist. URL: ${url}`
        );
      }

      return resp;
    } catch (err) {
      // Network-level errors (TypeError from fetch: connection reset, body mismatch)
      lastError = err instanceof Error ? err : new Error(String(err));

      // In force mode, don't retry on proxy connection failures — fail fast
      if (forceProxy && useProxy && attempt >= maxRetries) {
        throw new Error(
          `Proxy request failed after ${maxRetries + 1} attempts (SAAVN_FORCE_PROXY enabled): ${lastError.message}`
        );
      }

      if (attempt < maxRetries) {
        await delay(500 * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError ?? new Error('proxyFetch failed');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
