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
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, resolve, normalize } from 'node:path';
import { existsSync } from 'node:fs';
import { handleLibraryRoute } from './library/routes.js';
import { handleHistoryRoute } from './history/routes.js';
import { handleProxyRoute } from './proxy.js';
import { initScheduler } from './library/sync-scheduler.js';

const PORT = parseInt(process.env.PORT || '80', 10);
const STATIC_DIR = resolve(process.env.STATIC_DIR || './dist');
const LIBRARY_PATH = process.env.SAAVN_LIBRARY_PATH || '';
const MUSIC_PATH = process.env.SAAVN_MUSIC_PATH || '';

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

function sanitizePathSegment(segment) {
  // Remove path traversal attempts and invalid filesystem chars
  return segment
    .replace(/\.\./g, '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .trim()
    .slice(0, 255);
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
  });
}

async function handleLibrarySave(req, res) {
  if (!LIBRARY_PATH) {
    return jsonResponse(res, 403, { error: 'Library saving is not configured' });
  }

  // Expect raw binary body with metadata in headers
  const album = req.headers['x-album'] || 'Unknown Album';
  const filename = req.headers['x-filename'];

  if (!filename) {
    return jsonResponse(res, 400, { error: 'Missing x-filename header' });
  }

  const safeAlbum = sanitizePathSegment(album);
  const safeFilename = sanitizePathSegment(filename);

  if (!safeFilename) {
    return jsonResponse(res, 400, { error: 'Invalid filename' });
  }

  try {
    const body = await parseMultipartBody(req);

    // Ensure target directory exists
    const targetDir = join(LIBRARY_PATH, safeAlbum);
    await mkdir(targetDir, { recursive: true });

    const targetPath = join(targetDir, safeFilename);

    // Prevent path traversal (resolved path must be inside LIBRARY_PATH)
    const resolvedTarget = resolve(targetPath);
    const resolvedBase = resolve(LIBRARY_PATH);
    if (!resolvedTarget.startsWith(resolvedBase)) {
      return jsonResponse(res, 400, { error: 'Invalid path' });
    }

    await writeFile(targetPath, body);

    jsonResponse(res, 200, {
      success: true,
      path: `${safeAlbum}/${safeFilename}`,
    });
  } catch (err) {
    console.error('[library/save] Error:', err.message);
    jsonResponse(res, 500, { error: err.message });
  }
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

    // Cache immutable assets (hashed filenames from Vite)
    if (urlPath.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    // SPA fallback: serve index.html for non-file routes
    try {
      const indexPath = join(STATIC_DIR, 'index.html');
      const html = await readFile(indexPath);
      setCorsHeaders(res);
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
    // Library sync routes (/api/library/* except /save)
    if (url.pathname.startsWith('/api/library/') && url.pathname !== '/api/library/save') {
      const handled = await handleLibraryRoute(req, res, url, jsonResponse);
      if (handled !== false) return;
    }
    // Download history routes (/api/history*)
    if (url.pathname === '/api/history' || url.pathname.startsWith('/api/history/')) {
      const handled = await handleHistoryRoute(req, res, url, jsonResponse);
      if (handled !== false) return;
    }

    // Static files
    await serveStatic(req, res);
  } catch (err) {
    console.error('[server] Unhandled error:', err);
    setCorsHeaders(res);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`[saavn-dl] Server running on port ${PORT}`);
  console.log(`[saavn-dl] Static dir: ${STATIC_DIR}`);
  if (LIBRARY_PATH) {
    console.log(`[saavn-dl] Library path: ${LIBRARY_PATH} (Save to Library enabled)`);
  } else {
    console.log(`[saavn-dl] SAAVN_LIBRARY_PATH not set — Save to Library disabled`);
  }
  if (MUSIC_PATH) {
    console.log(`[saavn-dl] Music path: ${MUSIC_PATH} (Sync to NAS enabled)`);
    initScheduler();
  } else {
    console.log(`[saavn-dl] SAAVN_MUSIC_PATH not set — Sync to NAS disabled`);
  }
});
