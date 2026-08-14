/**
 * HTTP route handler for /api/import/* — YouTube → JioSaavn playlist import.
 *
 * Follows the library/history/playlists route pattern: returns true when a
 * request was handled, false otherwise. The feature is self-hosted-only and
 * gated by `youtubeImportEnabled` (see server/index.js); this handler returns
 * 403 when `enabled` is false.
 *
 * Endpoints:
 *   POST /api/import/youtube  → { url } → extract entries + match each to JioSaavn
 *                               → { entries: [{ youtube, candidates, suggestedIndex }], max, truncated }
 *   POST /api/import/commit   → { playlistName, quality, selections } → create the
 *                               playlist, add already-in-history tracks immediately,
 *                               and enqueue the rest as library downloads tagged with
 *                               the playlist id → { playlistId, addedNow, queued, failed }
 *
 * ── NETWORK / VPN ────────────────────────────────────────────────────────────
 * All external I/O here is server-side: yt-dlp extraction (VPN via the container
 * network namespace), JioSaavn search (match.js → fetchAllowed), and song-detail
 * fetch (fetchAllowed). Nothing here is (or should become) a browser/client fetch.
 */

import { fetchPlaylistEntries, isAllowedYoutubeUrl, IMPORT_MAX } from './ytdlp.js';
import { matchEntry, searchCandidates } from './match.js';
import { fetchAllowed } from '../downloads/fetcher.js';
import { createPlaylist, addTracksBySaavnId } from '../playlists/store.js';
import { getExistingTracks } from '../history/store.js';
import { downloadWorker } from '../downloads/queue.js';
import { createLogger } from '../log.js';

const log = createLogger('import/routes');

// Mirrors SONG_API in src/App.tsx. Host (*.workers.dev) is on the shared
// allowlist, so fetchAllowed reaches it over the VPN.
const SONG_API = 'https://sda.rhythmax.workers.dev';

const VALID_QUALITIES = new Set(['12', '48', '96', '160', '320']);
const MAX_BODY_BYTES = 1 * 1024 * 1024; // small JSON payloads only
const MATCH_CONCURRENCY = 4;

// ─── Body parsing ────────────────────────────────────────────────────────────

function parseJsonBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        reject(new Error('Request body too large'));
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const str = Buffer.concat(chunks).toString('utf-8');
        resolvePromise(str ? JSON.parse(str) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─── Song detail (VPN egress via fetchAllowed) ──────────────────────────────

/** Fetch full song detail (incl. encrypted_media_url) by its JioSaavn perma_url. */
async function fetchSongDetail(permaUrl, { signal } = {}) {
  const buf = await fetchAllowed(`${SONG_API}/song?url=${encodeURIComponent(permaUrl)}`, { signal });
  const song = JSON.parse(buf.toString('utf-8'));
  if (!song?.id || !song?.more_info?.encrypted_media_url) {
    throw new Error('Song detail missing encrypted_media_url');
  }
  return song;
}

// ─── Bounded concurrency ─────────────────────────────────────────────────────

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return out;
}

// Default (real) dependencies — overridable in tests via opts.deps.
const defaultDeps = {
  fetchPlaylistEntries,
  matchEntry,
  searchCandidates,
  createPlaylist,
  addTracksBySaavnId,
  getExistingTracks,
  fetchSongDetail,
  enqueueTrack: (args) => downloadWorker.enqueueTrack(args),
};

/**
 * Tag candidates with `downloaded` — true when the saavnId is already on disk
 * (staging library or NAS). Matches the commit step's "add immediately" rule,
 * so the review UI badge and the actual behaviour agree.
 */
function annotateDownloaded(candidates, getExisting) {
  const ids = candidates.map((c) => c.id).filter(Boolean);
  const existing = ids.length ? (getExisting(ids) || {}) : {};
  for (const c of candidates) c.downloaded = !!existing[c.id]?.exists;
  return candidates;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Handle /api/import/* requests.
 * @param {object} [opts]
 * @param {boolean} [opts.enabled]  feature gate (403 when false)
 * @param {object}  [opts.deps]     dependency overrides (testing)
 * @returns {Promise<boolean>} true if handled
 */
export async function handleImportRoute(req, res, url, jsonResponse, { enabled = true, deps } = {}) {
  const { pathname } = url;
  const IMPORT_PATHS = ['/api/import/youtube', '/api/import/search', '/api/import/commit'];
  if (!IMPORT_PATHS.includes(pathname)) return false;
  if (req.method !== 'POST') return false;

  if (!enabled) {
    jsonResponse(res, 403, { error: 'YouTube import is not enabled' });
    return true;
  }

  const d = { ...defaultDeps, ...(deps || {}) };

  // ── POST /api/import/youtube ──
  if (pathname === '/api/import/youtube') {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return jsonResponse(res, 400, { error: err.message });
    }
    const inputUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!inputUrl || !isAllowedYoutubeUrl(inputUrl)) {
      return jsonResponse(res, 400, { error: 'A valid YouTube URL is required' });
    }

    try {
      const ytEntries = await d.fetchPlaylistEntries(inputUrl, { limit: IMPORT_MAX });
      if (ytEntries.length === 0) {
        return jsonResponse(res, 200, { entries: [], max: IMPORT_MAX, truncated: false });
      }
      const entries = await mapWithConcurrency(ytEntries, MATCH_CONCURRENCY, async (yt) => {
        const { query, candidates, suggestedIndex } = await d.matchEntry(yt);
        annotateDownloaded(candidates, d.getExistingTracks);
        return { youtube: yt, query, candidates, suggestedIndex };
      });
      log.info('youtube import: %d entries from %s', entries.length, inputUrl);
      return jsonResponse(res, 200, {
        entries,
        max: IMPORT_MAX,
        truncated: ytEntries.length >= IMPORT_MAX,
      });
    } catch (err) {
      log.warn('youtube extract failed: %s', err.message);
      return jsonResponse(res, 502, { error: `Extraction failed: ${err.message}` });
    }
  }

  // ── POST /api/import/search — re-run a manual query for one track ──
  if (pathname === '/api/import/search') {
    let sbody;
    try {
      sbody = await parseJsonBody(req);
    } catch (err) {
      return jsonResponse(res, 400, { error: err.message });
    }
    const query = typeof sbody?.query === 'string' ? sbody.query.trim() : '';
    if (!query) return jsonResponse(res, 400, { error: 'query is required' });
    try {
      const { candidates, suggestedIndex } = await d.searchCandidates(query);
      annotateDownloaded(candidates, d.getExistingTracks);
      return jsonResponse(res, 200, { candidates, suggestedIndex });
    } catch (err) {
      log.warn('import search failed for "%s": %s', query, err.message);
      return jsonResponse(res, 502, { error: `Search failed: ${err.message}` });
    }
  }

  // ── POST /api/import/commit ──
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return jsonResponse(res, 400, { error: err.message });
  }

  const playlistName = typeof body?.playlistName === 'string' ? body.playlistName.trim() : '';
  const quality = String(body?.quality || '320');
  const selections = Array.isArray(body?.selections) ? body.selections : [];

  if (!playlistName) return jsonResponse(res, 400, { error: 'playlistName is required' });
  if (!VALID_QUALITIES.has(quality)) return jsonResponse(res, 400, { error: 'Invalid quality' });
  if (selections.length === 0) return jsonResponse(res, 400, { error: 'At least one selection is required' });

  // Create the playlist first (surfaces name collisions before any download work).
  let playlist;
  try {
    playlist = d.createPlaylist({ name: playlistName });
  } catch (err) {
    return jsonResponse(res, 409, { error: err.message });
  }

  const saavnIds = selections.map((s) => s?.saavnId).filter(Boolean);
  const existing = d.getExistingTracks(saavnIds) || {};

  let addedNow = 0;
  let queued = 0;
  const failed = [];

  for (const sel of selections) {
    const saavnId = sel?.saavnId;
    if (!saavnId) { failed.push({ saavnId: null, error: 'Missing saavnId' }); continue; }

    // Already downloaded → add to the playlist immediately (no re-download).
    if (existing[saavnId]?.exists) {
      try {
        d.addTracksBySaavnId(playlist.id, [saavnId]);
        addedNow++;
      } catch (err) {
        failed.push({ saavnId, error: err.message });
      }
      continue;
    }

    // Missing → fetch full detail server-side (VPN), then enqueue a library
    // download tagged with the playlist id (Task 4 adds it on completion).
    try {
      const song = await d.fetchSongDetail(sel.permaUrl);
      d.enqueueTrack({ song, quality, mode: 'library', playlistId: playlist.id });
      queued++;
    } catch (err) {
      failed.push({ saavnId, error: err.message });
    }
  }

  log.info('commit "%s": %d added now, %d queued, %d failed', playlistName, addedNow, queued, failed.length);
  return jsonResponse(res, 200, { playlistId: playlist.id, addedNow, queued, failed });
}
