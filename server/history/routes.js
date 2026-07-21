/**
 * API History Routes — HTTP handler for /api/history/* endpoints.
 *
 * Endpoints:
 *   GET    /api/history              → list all entries (optional ?type=track|album)
 *   GET    /api/history/ids          → get downloaded IDs for quick lookups
 *   GET    /api/history/albums/:id/tracks → get tracks for a specific album
 *   POST   /api/history              → add a new entry (supports tracks array for albums)
 *   DELETE /api/history/:id          → remove a specific entry
 *   DELETE /api/history              → clear all history
 */

import { getEntries, getDownloadedIds, addEntry, removeEntry, clearHistory, getAlbumTracks } from './store.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * Handles /api/history/* requests.
 * Returns true if the request was handled, false otherwise.
 */
export async function handleHistoryRoute(req, res, url, jsonResponse) {
  const pathname = url.pathname;

  // GET /api/history — list entries (paginated, searchable)
  if (pathname === '/api/history' && req.method === 'GET') {
    try {
      const type = url.searchParams.get('type') || undefined;
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit')) || 20, 1), 100);
      const offset = Math.max(parseInt(url.searchParams.get('offset')) || 0, 0);
      const search = url.searchParams.get('search') || undefined;
      const { entries, total } = getEntries({ type, limit, offset, search });
      return jsonResponse(res, 200, { entries, total, limit, offset });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // GET /api/history/ids — quick lookup of downloaded IDs
  if (pathname === '/api/history/ids' && req.method === 'GET') {
    try {
      const ids = getDownloadedIds();
      return jsonResponse(res, 200, ids);
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // GET /api/history/albums/:id/tracks — get tracks for a specific album
  const albumTracksMatch = pathname.match(/^\/api\/history\/albums\/([^/]+)\/tracks$/);
  if (albumTracksMatch && req.method === 'GET') {
    try {
      const albumId = decodeURIComponent(albumTracksMatch[1]);
      const tracks = getAlbumTracks(albumId);
      return jsonResponse(res, 200, { tracks });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // POST /api/history — add entry
  if (pathname === '/api/history' && req.method === 'POST') {
    try {
      const body = await parseBody(req);

      if (!body.saavnId || !body.type || !body.title) {
        return jsonResponse(res, 400, { error: 'Missing required fields: saavnId, type, title' });
      }

      if (!['track', 'album'].includes(body.type)) {
        return jsonResponse(res, 400, { error: 'type must be "track" or "album"' });
      }

      const entry = addEntry(body);
      return jsonResponse(res, 201, { entry });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // DELETE /api/history — clear all (must check before parameterized route)
  if (pathname === '/api/history' && req.method === 'DELETE') {
    try {
      // Check if there's a body with an id (single removal)
      // If no body or no id, clear all
      const body = await parseBody(req).catch(() => ({}));

      if (body.id) {
        removeEntry(body.id);
        return jsonResponse(res, 200, { success: true });
      }

      clearHistory();
      return jsonResponse(res, 200, { success: true });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // DELETE /api/history/:id — remove specific entry
  if (pathname.startsWith('/api/history/') && pathname !== '/api/history/ids' && !pathname.includes('/albums/') && req.method === 'DELETE') {
    try {
      const id = pathname.replace('/api/history/', '');
      if (!id) {
        return jsonResponse(res, 400, { error: 'Missing entry id' });
      }
      removeEntry(decodeURIComponent(id));
      return jsonResponse(res, 200, { success: true });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // Not handled
  return false;
}
