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
 */
export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const useProxy = await isProxyAvailable();

  if (useProxy) {
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
    return fetch(proxyUrl, init);
  }

  // Fallback: direct fetch (Vercel/static deployments)
  return fetch(url, init);
}
