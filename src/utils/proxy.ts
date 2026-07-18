/**
 * Proxied fetch utility.
 * When the app is running behind a server (self-hosted/Docker),
 * all external requests are routed through /api/proxy so they
 * go through the VPN (gluetun). Falls back to direct fetch
 * if the proxy is unavailable (e.g. Vercel static deployment).
 */

let proxyAvailable: boolean | null = null;

/**
 * Check once whether the proxy endpoint exists.
 * Caches the result for the session.
 */
async function isProxyAvailable(): Promise<boolean> {
  if (proxyAvailable !== null) return proxyAvailable;

  try {
    const resp = await fetch('/api/config');
    if (resp.ok) {
      proxyAvailable = true;
    } else {
      proxyAvailable = false;
    }
  } catch {
    proxyAvailable = false;
  }

  return proxyAvailable;
}

/**
 * Fetch a remote URL through the server-side proxy.
 * If the proxy is not available, falls back to a direct fetch.
 * Retries up to 2 times on network errors (e.g. truncated body, connection reset).
 */
export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const useProxy = await isProxyAvailable();
  const maxRetries = 2;

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

      return resp;
    } catch (err) {
      // Network-level errors (TypeError from fetch: connection reset, body mismatch)
      lastError = err instanceof Error ? err : new Error(String(err));
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
