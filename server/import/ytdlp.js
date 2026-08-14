/**
 * yt-dlp wrapper — locates the yt-dlp binary and runs it via child_process.
 *
 * Mirrors server/downloads/ffmpeg.js: an env override resolves the binary
 * (falling back to whatever `yt-dlp` is on PATH), a cached `--version` probe
 * decides availability, and extraction runs through execFile with an array
 * argument list (never a shell string) plus a hard timeout / abort.
 *
 * ── NETWORK / VPN ────────────────────────────────────────────────────────────
 * yt-dlp reaches YouTube DIRECTLY, not through /api/proxy or fetchAllowed. When
 * this server runs behind gluetun (docker-compose `network_mode: service:gluetun`)
 * the whole container — and every child process it spawns, including yt-dlp —
 * shares gluetun's network namespace, so that traffic is VPN-tunneled with a
 * killswitch. For deployments that instead front an explicit HTTP/SOCKS proxy,
 * set SAAVN_YTDLP_PROXY and it is passed to yt-dlp as `--proxy <value>`.
 */

import { execFile } from 'node:child_process';
import { createLogger } from '../log.js';

const log = createLogger('import/ytdlp');

/** YouTube hosts we allow before ever invoking yt-dlp. */
const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

/** Cap on extracted entries (bounds infinite radio mixes). */
export const IMPORT_MAX = Math.min(
  Math.max(parseInt(process.env.SAAVN_IMPORT_MAX || '100', 10) || 100, 1),
  500,
);

// ─── Binary resolution ──────────────────────────────────────────────────────

let cachedBinaryPath = null;

/**
 * Resolve the yt-dlp binary path.
 *   1. SAAVN_YTDLP_PATH env override (e.g. the binary the Docker build fetches)
 *   2. `yt-dlp` on PATH
 */
export function resolveYtdlpPath() {
  if (cachedBinaryPath) return cachedBinaryPath;
  const override = process.env.SAAVN_YTDLP_PATH;
  cachedBinaryPath = override && override.trim() ? override.trim() : 'yt-dlp';
  return cachedBinaryPath;
}

// ─── Availability probe ─────────────────────────────────────────────────────

let probeResult = null;

/**
 * Probe whether the yt-dlp binary is present and executable.
 * Runs `yt-dlp --version` once and caches the boolean result.
 */
export function probeYtdlp() {
  if (probeResult !== null) return Promise.resolve(probeResult);

  const bin = resolveYtdlpPath();
  return new Promise((resolvePromise) => {
    execFile(bin, ['--version'], { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        log.warn('probe failed for "%s": %s', bin, err.message);
        probeResult = false;
      } else {
        log.info('using binary: %s (%s)', bin, String(stdout).trim() || 'unknown');
        probeResult = true;
      }
      resolvePromise(probeResult);
    });
  });
}

// ─── URL allowlist ──────────────────────────────────────────────────────────

/** True when `url` is a well-formed http(s) URL on an allowlisted YouTube host. */
export function isAllowedYoutubeUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return ALLOWED_YOUTUBE_HOSTS.has(parsed.hostname);
}

// ─── Extraction ─────────────────────────────────────────────────────────────

/**
 * Build the yt-dlp argument list for a flat playlist/mix dump.
 * Pure + env-injectable so the `--proxy` behaviour is unit-testable.
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {Record<string,string|undefined>} [opts.env]
 */
export function buildExtractArgs(url, { limit = IMPORT_MAX, env = process.env } = {}) {
  const args = [];
  const proxy = env.SAAVN_YTDLP_PROXY;
  if (proxy && String(proxy).trim()) {
    args.push('--proxy', String(proxy).trim());
  }
  args.push(
    '--flat-playlist',
    '--dump-single-json',
    '--no-warnings',
    // Bound the extraction server-side so an endless radio mix can't run away.
    '--playlist-end', String(limit),
    url,
  );
  return args;
}

/**
 * Parse a `--dump-single-json` payload into our entry shape.
 * Pure — no I/O — so it can be tested against a checked-in fixture.
 * @returns {{ videoId: string, title: string, uploader: string, duration: number }[]}
 */
export function parseEntries(json, limit = IMPORT_MAX) {
  const entries = Array.isArray(json?.entries)
    ? json.entries
    : json?.id
      ? [json] // a single video (no playlist) dumps as one object
      : [];

  const out = [];
  for (const e of entries) {
    if (!e || !e.id) continue;
    out.push({
      videoId: String(e.id),
      title: String(e.title || '').trim(),
      uploader: String(e.uploader || e.channel || e.uploader_id || '').trim(),
      duration: Number(e.duration) || 0,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export class YtdlpError extends Error {
  constructor(message, { code, stderr } = {}) {
    super(message);
    this.name = 'YtdlpError';
    this.code = code;
    this.stderr = stderr;
  }
}

/**
 * Extract a YouTube playlist/mix's entries via yt-dlp.
 * Rejects non-allowlisted URLs before spawning anything.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.limit]        max entries (default IMPORT_MAX)
 * @param {AbortSignal} [opts.signal]  abort the running extraction
 * @param {number} [opts.timeoutMs]    hard timeout (default 120s)
 * @returns {Promise<{ videoId, title, uploader, duration }[]>}
 */
export function fetchPlaylistEntries(url, { limit = IMPORT_MAX, signal, timeoutMs = 120_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (!isAllowedYoutubeUrl(url)) {
      reject(new YtdlpError('URL is not an allowed YouTube URL', { code: 'FORBIDDEN' }));
      return;
    }
    if (signal?.aborted) {
      reject(new YtdlpError('Aborted before yt-dlp started', { code: 'ABORT' }));
      return;
    }

    const bin = resolveYtdlpPath();
    const args = buildExtractArgs(url, { limit });
    log.debug('extract → %s (limit %d)', url, limit);

    const child = execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        cleanup();
        if (err) {
          if (err.killed && signal?.aborted) {
            reject(new YtdlpError('yt-dlp aborted', { code: 'ABORT', stderr }));
          } else if (err.killed) {
            reject(new YtdlpError(`yt-dlp timed out after ${timeoutMs / 1000}s`, { code: 'TIMEOUT', stderr }));
          } else {
            reject(new YtdlpError(`yt-dlp failed: ${err.message}`, { code: err.code, stderr }));
          }
          return;
        }
        let json;
        try {
          json = JSON.parse(stdout);
        } catch {
          reject(new YtdlpError('yt-dlp returned invalid JSON', { code: 'PARSE' }));
          return;
        }
        const entries = parseEntries(json, limit);
        log.info('extracted %d entr%s from %s', entries.length, entries.length === 1 ? 'y' : 'ies', url);
        resolvePromise(entries);
      },
    );

    const onAbort = () => child.kill('SIGKILL');
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    function cleanup() {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  });
}
