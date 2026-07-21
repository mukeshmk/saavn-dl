/**
 * API Playlist Routes — HTTP handler for /api/playlists/* endpoints.
 *
 * Endpoints:
 *   GET    /api/playlists                    → list all playlists
 *   POST   /api/playlists                    → create a playlist
 *   GET    /api/playlists/search-tracks      → search history tracks for adding to playlists
 *   POST   /api/playlists/preview            → preview auto-generate criteria results
 *   POST   /api/playlists/export-all         → export all playlists as .m3u8 files
 *   POST   /api/playlists/backfill           → trigger file path backfill scan
 *   GET    /api/playlists/:id                → get a single playlist with metadata
 *   PUT    /api/playlists/:id                → update playlist name/description/criteria
 *   DELETE /api/playlists/:id                → delete a playlist
 *   GET    /api/playlists/:id/tracks         → get ordered tracks in a playlist
 *   POST   /api/playlists/:id/tracks         → add tracks to a playlist
 *   DELETE /api/playlists/:id/tracks         → remove tracks from a playlist
 *   PUT    /api/playlists/:id/reorder        → reorder tracks in a playlist
 *   POST   /api/playlists/:id/regenerate     → re-run auto criteria
 *   POST   /api/playlists/:id/export         → export single playlist as .m3u8
 */

import {
  createPlaylist,
  getPlaylist,
  listPlaylists,
  updatePlaylist,
  deletePlaylist,
  getPlaylistTracks,
  addTracksBySaavnId,
  removeTracksFromPlaylist,
  reorderPlaylistTracks,
  regeneratePlaylist,
  previewAutoCriteria,
  searchTracks,
  generateM3U8,
  generateAllM3U8,
  backfillFilePaths,
} from './store.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const MUSIC_PATH = process.env.SAAVN_MUSIC_PATH || '';

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

/**
 * Sanitize a playlist name for use as a filename.
 */
function sanitizeFilename(name) {
  return name
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Write a .m3u8 file to SAAVN_MUSIC_PATH/Playlists/
 */
async function writeM3U8ToDisk(name, content) {
  if (!MUSIC_PATH) {
    throw new Error('SAAVN_MUSIC_PATH is not configured — cannot export playlists');
  }

  const playlistsDir = join(MUSIC_PATH, 'Playlists');
  if (!existsSync(playlistsDir)) {
    await mkdir(playlistsDir, { recursive: true });
  }

  const filename = `${sanitizeFilename(name)}.m3u8`;
  const filePath = join(playlistsDir, filename);

  // Path traversal protection
  const resolvedPath = resolve(filePath);
  if (!resolvedPath.startsWith(resolve(playlistsDir))) {
    throw new Error('Invalid playlist name — path traversal detected');
  }

  await writeFile(filePath, content, 'utf-8');
  return { filename, path: `Playlists/${filename}` };
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * Handles /api/playlists/* requests.
 * Returns true if the request was handled, false otherwise.
 */
export async function handlePlaylistRoute(req, res, url, jsonResponse) {
  const pathname = url.pathname;

  // ── GET /api/playlists — list all playlists ──
  if (pathname === '/api/playlists' && req.method === 'GET') {
    try {
      const playlists = listPlaylists();
      return jsonResponse(res, 200, { playlists });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── POST /api/playlists — create a playlist ──
  if (pathname === '/api/playlists' && req.method === 'POST') {
    try {
      const body = await parseBody(req);

      if (!body.name || !body.name.trim()) {
        return jsonResponse(res, 400, { error: 'Missing required field: name' });
      }

      const playlist = createPlaylist({
        name: body.name.trim(),
        description: body.description || '',
        autoGenerate: !!body.autoGenerate,
        autoCriteria: body.autoCriteria || null,
      });

      return jsonResponse(res, 201, { playlist });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── GET /api/playlists/search-tracks?q=&limit= ──
  if (pathname === '/api/playlists/search-tracks' && req.method === 'GET') {
    try {
      const q = url.searchParams.get('q') || '';
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit')) || 20, 1), 100);

      if (!q.trim()) {
        return jsonResponse(res, 400, { error: 'Missing query parameter: q' });
      }

      const tracks = searchTracks(q.trim(), limit);
      return jsonResponse(res, 200, { tracks });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── POST /api/playlists/preview — preview auto-generate results ──
  if (pathname === '/api/playlists/preview' && req.method === 'POST') {
    try {
      const body = await parseBody(req);

      if (!body.criteria) {
        return jsonResponse(res, 400, { error: 'Missing required field: criteria' });
      }

      const tracks = previewAutoCriteria(body.criteria);
      return jsonResponse(res, 200, { tracks, count: tracks.length });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── POST /api/playlists/export-all — export all playlists as .m3u8 ──
  if (pathname === '/api/playlists/export-all' && req.method === 'POST') {
    try {
      if (!MUSIC_PATH) {
        return jsonResponse(res, 403, { error: 'SAAVN_MUSIC_PATH is not configured' });
      }

      const allM3U8 = generateAllM3U8();
      const exported = [];

      for (const m3u8 of allM3U8) {
        const result = await writeM3U8ToDisk(m3u8.name, m3u8.content);
        exported.push({ name: m3u8.name, ...result, trackCount: m3u8.trackCount });
      }

      return jsonResponse(res, 200, { exported, count: exported.length });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── POST /api/playlists/backfill — trigger file path backfill ──
  if (pathname === '/api/playlists/backfill' && req.method === 'POST') {
    try {
      if (!MUSIC_PATH) {
        return jsonResponse(res, 403, { error: 'SAAVN_MUSIC_PATH is not configured — cannot backfill' });
      }

      const result = await backfillFilePaths(MUSIC_PATH);
      return jsonResponse(res, 200, result);
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── Parameterized routes: /api/playlists/:id/* ──
  const idMatch = pathname.match(/^\/api\/playlists\/([^/]+)$/);
  const tracksMatch = pathname.match(/^\/api\/playlists\/([^/]+)\/tracks$/);
  const reorderMatch = pathname.match(/^\/api\/playlists\/([^/]+)\/reorder$/);
  const regenerateMatch = pathname.match(/^\/api\/playlists\/([^/]+)\/regenerate$/);
  const exportMatch = pathname.match(/^\/api\/playlists\/([^/]+)\/export$/);

  // ── GET /api/playlists/:id — get single playlist ──
  if (idMatch && req.method === 'GET') {
    try {
      const id = decodeURIComponent(idMatch[1]);
      const playlist = getPlaylist(id);

      if (!playlist) {
        return jsonResponse(res, 404, { error: 'Playlist not found' });
      }

      return jsonResponse(res, 200, { playlist });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── PUT /api/playlists/:id — update playlist ──
  if (idMatch && req.method === 'PUT') {
    try {
      const id = decodeURIComponent(idMatch[1]);
      const body = await parseBody(req);

      const playlist = updatePlaylist(id, {
        name: body.name,
        description: body.description,
        autoCriteria: body.autoCriteria,
      });

      if (!playlist) {
        return jsonResponse(res, 404, { error: 'Playlist not found' });
      }

      return jsonResponse(res, 200, { playlist });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── DELETE /api/playlists/:id — delete playlist ──
  if (idMatch && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(idMatch[1]);
      const deleted = deletePlaylist(id);

      if (!deleted) {
        return jsonResponse(res, 404, { error: 'Playlist not found' });
      }

      return jsonResponse(res, 200, { success: true });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── GET /api/playlists/:id/tracks — get tracks in playlist ──
  if (tracksMatch && req.method === 'GET') {
    try {
      const id = decodeURIComponent(tracksMatch[1]);
      const playlist = getPlaylist(id);

      if (!playlist) {
        return jsonResponse(res, 404, { error: 'Playlist not found' });
      }

      const tracks = getPlaylistTracks(id);
      return jsonResponse(res, 200, { tracks });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── POST /api/playlists/:id/tracks — add tracks ──
  if (tracksMatch && req.method === 'POST') {
    try {
      const id = decodeURIComponent(tracksMatch[1]);
      const body = await parseBody(req);

      if (!body.saavnIds || !Array.isArray(body.saavnIds) || body.saavnIds.length === 0) {
        return jsonResponse(res, 400, { error: 'Missing required field: saavnIds (array)' });
      }

      const playlist = getPlaylist(id);
      if (!playlist) {
        return jsonResponse(res, 404, { error: 'Playlist not found' });
      }

      const tracks = addTracksBySaavnId(id, body.saavnIds);
      return jsonResponse(res, 200, { tracks });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── DELETE /api/playlists/:id/tracks — remove tracks ──
  if (tracksMatch && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(tracksMatch[1]);
      const body = await parseBody(req);

      if (!body.trackIds || !Array.isArray(body.trackIds) || body.trackIds.length === 0) {
        return jsonResponse(res, 400, { error: 'Missing required field: trackIds (array)' });
      }

      const playlist = getPlaylist(id);
      if (!playlist) {
        return jsonResponse(res, 404, { error: 'Playlist not found' });
      }

      const tracks = removeTracksFromPlaylist(id, body.trackIds);
      return jsonResponse(res, 200, { tracks });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── PUT /api/playlists/:id/reorder — reorder tracks ──
  if (reorderMatch && req.method === 'PUT') {
    try {
      const id = decodeURIComponent(reorderMatch[1]);
      const body = await parseBody(req);

      if (!body.trackIds || !Array.isArray(body.trackIds)) {
        return jsonResponse(res, 400, { error: 'Missing required field: trackIds (ordered array)' });
      }

      const playlist = getPlaylist(id);
      if (!playlist) {
        return jsonResponse(res, 404, { error: 'Playlist not found' });
      }

      const tracks = reorderPlaylistTracks(id, body.trackIds);
      return jsonResponse(res, 200, { tracks });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── POST /api/playlists/:id/regenerate — re-run auto criteria ──
  if (regenerateMatch && req.method === 'POST') {
    try {
      const id = decodeURIComponent(regenerateMatch[1]);
      const playlist = getPlaylist(id);

      if (!playlist) {
        return jsonResponse(res, 404, { error: 'Playlist not found' });
      }

      if (!playlist.autoGenerate) {
        return jsonResponse(res, 400, { error: 'Playlist is not auto-generated' });
      }

      const tracks = regeneratePlaylist(id);
      return jsonResponse(res, 200, { tracks });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // ── POST /api/playlists/:id/export — export single playlist as .m3u8 ──
  if (exportMatch && req.method === 'POST') {
    try {
      if (!MUSIC_PATH) {
        return jsonResponse(res, 403, { error: 'SAAVN_MUSIC_PATH is not configured' });
      }

      const id = decodeURIComponent(exportMatch[1]);
      const m3u8 = generateM3U8(id);

      if (!m3u8) {
        return jsonResponse(res, 404, { error: 'Playlist not found' });
      }

      const result = await writeM3U8ToDisk(m3u8.name, m3u8.content);
      return jsonResponse(res, 200, { ...result, trackCount: m3u8.trackCount });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // Not handled
  return false;
}
