/**
 * Lightweight production server for saavn-dl.
 * Serves the Vite build output and provides an API for "Save to Library"
 * functionality when the SAAVN_LIBRARY_PATH env var is set.
 *
 * Endpoints:
 *   GET  /api/config         → { libraryEnabled: boolean }
 *   POST /api/library/save   → saves uploaded file to SAAVN_LIBRARY_PATH/<album>/<filename>
 *
 * All other requests fall through to static file serving (SPA with index.html fallback).
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, normalize } from 'node:path';
import { initDb } from './db/index.js';
import { handleLibraryRoute } from './library/routes.js';
import { handleHistoryRoute } from './history/routes.js';
import { getExistingTracks } from './history/store.js';
import { handlePlaylistRoute } from './playlists/routes.js';
import { handleProxyRoute } from './proxy.js';
import { initScheduler } from './library/sync-scheduler.js';
import { backfillFilePaths } from './playlists/store.js';
import { handleDownloadsRoute } from './downloads/routes.js';
import { createPlaylistFile } from './downloads/album.js';
import { writeToLibrary } from './downloads/engine.js';
import { probeFfmpeg } from './downloads/ffmpeg.js';
import { downloadWorker } from './downloads/queue.js';
import { sweepArtifacts, ARTIFACT_TTL_SECONDS } from './downloads/artifacts.js';
import { createLogger, getLogLevel, isDebugEnabled } from './log.js';

const log = createLogger('server');

const PORT = parseInt(process.env.PORT || '80', 10);
const STATIC_DIR = resolve(process.env.STATIC_DIR || './dist');
const LIBRARY_PATH = process.env.SAAVN_LIBRARY_PATH || '';
const MUSIC_PATH = process.env.SAAVN_MUSIC_PATH || '';
const DB_PATH = process.env.SAAVN_DB_PATH || './data/saavn-dl.db';
const FORCE_PROXY = process.env.SAAVN_FORCE_PROXY === 'true' || process.env.SAAVN_FORCE_PROXY === '1';

// Set once at startup after the ffmpeg probe (see startup()). Server-side downloads
// require both a library destination and a working ffmpeg binary.
let serverDownloadsEnabled = false;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setCorsHeaders(res) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
}

function jsonResponse(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function parseMultipartBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX_SIZE = 100 * 1024 * 1024; // 100 MB limit per file

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        reject(new Error('File too large (max 100 MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─── API Routes ───────────────────────────────────────────────────────────────

async function handleApiConfig(req, res) {
  jsonResponse(res, 200, {
    libraryEnabled: !!LIBRARY_PATH,
    musicPathEnabled: !!MUSIC_PATH,
    historyEnabled: true,
    playlistsEnabled: true,
    dbEnabled: true,
    dbPath: DB_PATH,
    forceProxy: FORCE_PROXY,
    serverDownloadsEnabled,
    // Surface the server's log level so the client logger can mirror debug mode.
    logLevel: getLogLevel(),
    debug: isDebugEnabled(),
  });
}

async function handleLibrarySave(req, res) {
  if (!LIBRARY_PATH) {
    return jsonResponse(res, 403, { error: 'Library saving is not configured' });
  }

  // Metadata travels in headers (URI-encoded for non-ASCII safety); the body is the raw file.
  // writeToLibrary applies the same sanitize + Artist/Album (Year)/Track layout + traversal guard.
  const artist = decodeURIComponent(req.headers['x-artist'] || '');
  const album = decodeURIComponent(req.headers['x-album'] || 'Unknown Album');
  const filename = decodeURIComponent(req.headers['x-filename'] || '');

  if (!filename) {
    return jsonResponse(res, 400, { error: 'Missing x-filename header' });
  }

  try {
    const body = await parseMultipartBody(req);
    log.debug('library/save: writing "%s" (artist=%s, album=%s, %d bytes)', filename, artist || '—', album, body.length);
    const relativePath = await writeToLibrary(body, artist, album, filename);
    log.info('library/save: saved %s', relativePath);
    jsonResponse(res, 200, { success: true, path: relativePath });
  } catch (err) {
    log.error('library/save failed:', err.message);
    jsonResponse(res, 500, { error: err.message });
  }
}

/**
 * POST /api/library/check-tracks
 * Body: { saavnIds: string[] }
 * Returns: { existing: { [saavnId]: { filePath: string, exists: boolean } } }
 *
 * Checks which tracks already exist in the library (by saavn_id in the DB + file on disk).
 */
async function handleLibraryCheckTracks(req, res) {
  if (!LIBRARY_PATH) {
    return jsonResponse(res, 403, { error: 'Library saving is not configured' });
  }

  try {
    const body = await parseJsonBody(req);
    const saavnIds = body?.saavnIds;
    if (!Array.isArray(saavnIds) || saavnIds.length === 0) {
      return jsonResponse(res, 400, { error: 'saavnIds array required' });
    }

    const existing = getExistingTracks(saavnIds);
    log.debug('library/check-tracks: %d requested, %d already in library', saavnIds.length, Object.keys(existing || {}).length);
    jsonResponse(res, 200, { existing });
  } catch (err) {
    log.error('library/check-tracks failed:', err.message);
    jsonResponse(res, 500, { error: err.message });
  }
}

/**
 * POST /api/library/playlist
 * Body: { name: string, tracks: { saavnId: string, title: string, artist: string, duration: number, filePath: string }[] }
 * Returns: { success: true, playlistId: string, path: string }
 *
 * Creates a playlist entry in the database and generates an m3u file.
 * The m3u uses SAAVN_MUSIC_PATH-prefixed absolute paths so it works after sync.
 * Also links tracks to the playlist in playlist_tracks table.
 */
async function handleLibraryPlaylist(req, res) {
  if (!LIBRARY_PATH) {
    return jsonResponse(res, 403, { error: 'Library saving is not configured' });
  }

  try {
    const body = await parseJsonBody(req);
    const { name, tracks } = body || {};

    if (!name || !Array.isArray(tracks) || tracks.length === 0) {
      return jsonResponse(res, 400, { error: 'name and tracks array required' });
    }

    const { playlistId, path } = await createPlaylistFile(name, tracks);
    log.info('library/playlist: created "%s" (%d tracks) → %s', name, tracks.length, path);
    jsonResponse(res, 200, { success: true, playlistId, path });
  } catch (err) {
    log.error('library/playlist failed:', err.message);
    jsonResponse(res, 500, { error: err.message });
  }
}

/**
 * Parse a JSON body from a request.
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const str = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(str));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─── Static File Serving ──────────────────────────────────────────────────────

async function serveStatic(req, res) {
  let urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname;

  // Default to index.html
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = join(STATIC_DIR, urlPath);

  // Prevent path traversal
  const resolved = resolve(filePath);
  if (!resolved.startsWith(resolve(STATIC_DIR))) {
    setCorsHeaders(res);
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) throw new Error('Not a file');

    const ext = extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await readFile(resolved);

    setCorsHeaders(res);

    // Cache immutable assets (hashed filenames from Vite); never cache the HTML shell
    if (urlPath.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    // SPA fallback: serve index.html for non-file routes
    try {
      const indexPath = join(STATIC_DIR, 'index.html');
      const html = await readFile(indexPath);
      setCorsHeaders(res);
      res.setHeader('Cache-Control', 'no-cache');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      setCorsHeaders(res);
      res.writeHead(404);
      res.end('Not Found');
    }
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  logRequest(req, res, url);

  try {
    // API routes
    if (url.pathname === '/api/config' && req.method === 'GET') {
      return await handleApiConfig(req, res);
    }
    if (url.pathname === '/api/proxy') {
      return handleProxyRoute(req, res, url, jsonResponse);
    }
    if (url.pathname === '/api/library/save' && req.method === 'POST') {
      return await handleLibrarySave(req, res);
    }
    if (url.pathname === '/api/library/check-tracks' && req.method === 'POST') {
      return await handleLibraryCheckTracks(req, res);
    }
    if (url.pathname === '/api/library/playlist' && req.method === 'POST') {
      return await handleLibraryPlaylist(req, res);
    }
    // Library sync routes (/api/library/* except /save and new endpoints)
    if (url.pathname.startsWith('/api/library/') && url.pathname !== '/api/library/save' && url.pathname !== '/api/library/check-tracks' && url.pathname !== '/api/library/playlist') {
      const handled = await handleLibraryRoute(req, res, url, jsonResponse);
      if (handled !== false) return;
    }
    // Download history routes (/api/history*)
    if (url.pathname === '/api/history' || url.pathname.startsWith('/api/history/')) {
      const handled = await handleHistoryRoute(req, res, url, jsonResponse);
      if (handled !== false) return;
    }
    // Playlist routes (/api/playlists*)
    if (url.pathname === '/api/playlists' || url.pathname.startsWith('/api/playlists/')) {
      const handled = await handlePlaylistRoute(req, res, url, jsonResponse);
      if (handled !== false) return;
    }
    // Server-side download queue routes (/api/downloads*)
    if (url.pathname === '/api/downloads' || url.pathname.startsWith('/api/downloads/')) {
      if (!serverDownloadsEnabled) {
        return jsonResponse(res, 404, { error: 'Server-side downloads are not enabled' });
      }
      const handled = await handleDownloadsRoute(req, res, url, jsonResponse);
      if (handled !== false) return;
    }

    // Static files
    await serveStatic(req, res);
  } catch (err) {
    log.error('unhandled error on %s %s:', req.method, url.pathname, err);
    setCorsHeaders(res);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

/**
 * Per-request access log. API calls log at info (the "what calls are being
 * made" view); the high-volume proxy + static routes log at debug so they only
 * appear in debug mode. Logs once on response completion with status + duration.
 */
function logRequest(req, res, url) {
  const start = Date.now();
  const { pathname } = url;
  const isApi = pathname.startsWith('/api/');
  // Proxy carries every image/audio fetch — noisy, so keep it at debug.
  const level = isApi && pathname !== '/api/proxy' ? 'info' : 'debug';
  res.on('finish', () => {
    log[level]('%s %s → %d (%dms)', req.method, pathname, res.statusCode, Date.now() - start);
  });
}

// ─── Startup ──────────────────────────────────────────────────────────────────

async function startup() {
  // Initialize database before accepting requests
  try {
    initDb();
  } catch (err) {
    log.error('FATAL: database initialization failed:', err.message);
    process.exit(1);
  }

  // Probe ffmpeg to decide whether server-side downloads can run (Req 1.5, 8.3).
  let ffmpegAvailable = false;
  try {
    ffmpegAvailable = await probeFfmpeg();
  } catch (err) {
    log.warn('ffmpeg probe threw:', err.message);
  }
  serverDownloadsEnabled = !!LIBRARY_PATH && ffmpegAvailable;

  server.listen(PORT, () => {
    log.info('server running on port %d', PORT);
    log.info('log level: %s (set SAAVN_DEBUG=1 or SAAVN_LOG_LEVEL=debug for verbose logs)', getLogLevel());
    log.info('static dir: %s', STATIC_DIR);
    log.info('database: %s', DB_PATH);

    if (LIBRARY_PATH) {
      log.info('library path: %s (Save to Library enabled)', LIBRARY_PATH);
    } else {
      log.info('SAAVN_LIBRARY_PATH not set — Save to Library disabled');
    }

    // Server-side download queue
    if (serverDownloadsEnabled) {
      log.info('server-side downloads enabled (ffmpeg available)');
      downloadWorker.start();

      // Periodic sweep of stale browser-delivery artifacts (Req 7.4).
      const sweep = () => {
        sweepArtifacts()
          .then((n) => { if (n > 0) log.info('swept %d stale download artifact(s)', n); })
          .catch(() => { /* ignore */ });
      };
      sweep();
      const sweepTimer = setInterval(sweep, 60 * 60 * 1000); // hourly
      if (sweepTimer.unref) sweepTimer.unref();
      log.debug('artifact TTL: %ds', ARTIFACT_TTL_SECONDS);
    } else if (!LIBRARY_PATH) {
      log.info('server-side downloads disabled — SAAVN_LIBRARY_PATH not set');
    } else {
      log.info(
        'server-side downloads disabled — ffmpeg not available ' +
        '(install ffmpeg-static or set SAAVN_FFMPEG_PATH). Client will use the in-browser pipeline.',
      );
    }

    if (MUSIC_PATH) {
      log.info('music path: %s (Sync to NAS enabled)', MUSIC_PATH);
      initScheduler();
      // Run file path backfill in background (populates file_path for existing tracks)
      backfillFilePaths(MUSIC_PATH).then(result => {
        if (result.matched > 0) {
          log.info('file path backfill: %d matched, %d unmatched of %d tracks', result.matched, result.unmatched, result.total);
        }
      }).catch(err => {
        log.warn('file path backfill failed:', err.message);
      });
    } else {
      log.info('SAAVN_MUSIC_PATH not set — Sync to NAS disabled');
    }
  });
}

startup();
