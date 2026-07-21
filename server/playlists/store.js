/**
 * Playlist Store — CRUD operations, auto-generate logic, and track path backfill.
 *
 * Manages playlists and their track memberships in SQLite.
 * Supports both manual playlists and auto-generated playlists based on filter criteria.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

// ─── Playlist CRUD ────────────────────────────────────────────────────────────

/**
 * Create a new playlist (manual or auto-generated).
 * If auto_generate is true, auto_criteria should be a JSON object with filter rules.
 * Returns the created playlist.
 */
export function createPlaylist({ name, description = '', autoGenerate = false, autoCriteria = null }) {
  const db = getDb();

  // Enforce unique name
  const existing = db.prepare('SELECT id FROM playlists WHERE name = ?').get(name);
  if (existing) {
    throw new Error(`A playlist named "${name}" already exists`);
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO playlists (id, name, description, auto_generate, auto_criteria, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, description, autoGenerate ? 1 : 0, autoCriteria ? JSON.stringify(autoCriteria) : '', now, now);

  // If auto-generated, populate tracks immediately
  if (autoGenerate && autoCriteria) {
    regeneratePlaylist(id);
  }

  return getPlaylist(id);
}

/**
 * Get a single playlist by ID (with track count).
 */
export function getPlaylist(id) {
  const db = getDb();

  const row = db.prepare(`
    SELECT p.*, COUNT(pt.track_id) AS track_count
    FROM playlists p
    LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
    WHERE p.id = ?
    GROUP BY p.id
  `).get(id);

  if (!row) return null;
  return formatPlaylist(row);
}

/**
 * List all playlists (with track counts).
 */
export function listPlaylists() {
  const db = getDb();

  const rows = db.prepare(`
    SELECT p.*, COUNT(pt.track_id) AS track_count
    FROM playlists p
    LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `).all();

  return rows.map(formatPlaylist);
}

/**
 * Update a playlist's name, description, or auto criteria.
 */
export function updatePlaylist(id, { name, description, autoCriteria }) {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  if (!existing) return null;

  // Check for name collision when renaming
  if (name !== undefined && name !== existing.name) {
    const clash = db.prepare('SELECT id FROM playlists WHERE name = ? AND id != ?').get(name, id);
    if (clash) {
      throw new Error(`A playlist named "${name}" already exists`);
    }
  }

  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (autoCriteria !== undefined) { updates.push('auto_criteria = ?'); params.push(JSON.stringify(autoCriteria)); }

  updates.push('updated_at = ?');
  params.push(now);
  params.push(id);

  if (updates.length > 1) {
    db.prepare(`UPDATE playlists SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  return getPlaylist(id);
}

/**
 * Delete a playlist and all its track associations.
 */
export function deletePlaylist(id) {
  const db = getDb();
  // CASCADE handles playlist_tracks deletion
  const result = db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
  return result.changes > 0;
}

// ─── Playlist tracks ──────────────────────────────────────────────────────────

/**
 * Get all tracks in a playlist, ordered by position.
 * Joins with tracks table to return full track metadata.
 */
export function getPlaylistTracks(playlistId) {
  const db = getDb();

  const rows = db.prepare(`
    SELECT t.id, t.saavn_id AS saavnId, t.title, t.artist, t.album_title AS albumTitle,
           t.album_artist AS albumArtist, t.image, t.quality, t.duration,
           t.play_count AS playCount, t.year, t.language, t.track_number AS trackNumber,
           t.file_path AS filePath, t.is_explicit AS isExplicit, t.downloaded_at AS downloadedAt,
           pt.position, pt.added_at AS addedAt
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position ASC
  `).all(playlistId);

  return rows.map(r => ({ ...r, isExplicit: !!r.isExplicit }));
}

/**
 * Add tracks to a playlist by their track IDs.
 * Appends to the end of the current track list.
 * Skips duplicates silently.
 */
export function addTracksToPlaylist(playlistId, trackIds) {
  const db = getDb();
  const now = new Date().toISOString();

  // Get current max position
  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) AS max_pos FROM playlist_tracks WHERE playlist_id = ?'
  ).get(playlistId).max_pos;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at)
    VALUES (?, ?, ?, ?)
  `);

  let position = maxPos + 1;
  const addMany = db.transaction((ids) => {
    for (const trackId of ids) {
      insert.run(playlistId, trackId, position, now);
      position++;
    }
  });

  addMany(trackIds);

  // Update playlist updated_at
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, playlistId);

  return getPlaylistTracks(playlistId);
}

/**
 * Add tracks by saavn_id (more convenient for the frontend which knows saavnIds).
 * Resolves saavn_ids to internal track IDs first.
 */
export function addTracksBySaavnId(playlistId, saavnIds) {
  const db = getDb();

  // Resolve saavn_ids to track ids
  const placeholders = saavnIds.map(() => '?').join(',');
  const tracks = db.prepare(
    `SELECT id FROM tracks WHERE saavn_id IN (${placeholders})`
  ).all(...saavnIds);

  const trackIds = tracks.map(t => t.id);
  if (trackIds.length === 0) return getPlaylistTracks(playlistId);

  return addTracksToPlaylist(playlistId, trackIds);
}

/**
 * Remove tracks from a playlist by their track IDs.
 * Re-normalizes positions after removal.
 */
export function removeTracksFromPlaylist(playlistId, trackIds) {
  const db = getDb();
  const now = new Date().toISOString();

  const placeholders = trackIds.map(() => '?').join(',');
  db.prepare(
    `DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id IN (${placeholders})`
  ).run(playlistId, ...trackIds);

  // Re-normalize positions
  normalizePositions(db, playlistId);

  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, playlistId);

  return getPlaylistTracks(playlistId);
}

/**
 * Reorder tracks in a playlist. Receives an ordered array of track IDs
 * representing the new desired order.
 */
export function reorderPlaylistTracks(playlistId, orderedTrackIds) {
  const db = getDb();
  const now = new Date().toISOString();

  const update = db.prepare(
    'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?'
  );

  const reorder = db.transaction((ids) => {
    for (let i = 0; i < ids.length; i++) {
      update.run(i, playlistId, ids[i]);
    }
  });

  reorder(orderedTrackIds);

  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, playlistId);

  return getPlaylistTracks(playlistId);
}

// ─── Auto-generate logic ──────────────────────────────────────────────────────

/**
 * Supported auto-generate criteria:
 * {
 *   rules: [
 *     { field: 'year', op: 'eq' | 'gte' | 'lte' | 'contains', value: ... },
 *     { field: 'language', op: 'eq', value: 'hindi' },
 *     { field: 'playCount', op: 'gte', value: 50000 },
 *     { field: 'artist', op: 'contains', value: 'arijit' },
 *     { field: 'albumTitle', op: 'contains', value: '...' },
 *     { field: 'duration', op: 'gte' | 'lte', value: 300 },
 *   ],
 *   sort: 'playCount' | 'year' | 'downloadedAt' | 'title' | 'artist',
 *   sortOrder: 'asc' | 'desc',
 *   limit: 50
 * }
 */

const FIELD_MAP = {
  year: 'year',
  language: 'language',
  playCount: 'play_count',
  artist: 'artist',
  albumTitle: 'album_title',
  albumArtist: 'album_artist',
  duration: 'duration',
  title: 'title',
  downloadedAt: 'downloaded_at',
  quality: 'quality',
  isExplicit: 'is_explicit',
};

const SORT_MAP = {
  playCount: 'play_count',
  year: 'year',
  downloadedAt: 'downloaded_at',
  title: 'title',
  artist: 'artist',
  duration: 'duration',
};

/**
 * Re-generates the track list for an auto-generated playlist based on its criteria.
 * Replaces existing tracks entirely.
 */
export function regeneratePlaylist(playlistId) {
  const db = getDb();

  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId);
  if (!playlist || !playlist.auto_generate) return null;

  let criteria;
  try {
    criteria = JSON.parse(playlist.auto_criteria);
  } catch {
    return null;
  }

  const { rules = [], sort = 'playCount', sortOrder = 'desc', limit = 50 } = criteria;

  // Build WHERE clauses from rules
  const conditions = [];
  const params = [];

  for (const rule of rules) {
    const column = FIELD_MAP[rule.field];
    if (!column) continue;

    switch (rule.op) {
      case 'eq':
        conditions.push(`${column} = ?`);
        params.push(rule.value);
        break;
      case 'gte':
        conditions.push(`CAST(${column} AS INTEGER) >= ?`);
        params.push(Number(rule.value));
        break;
      case 'lte':
        conditions.push(`CAST(${column} AS INTEGER) <= ?`);
        params.push(Number(rule.value));
        break;
      case 'contains':
        conditions.push(`${column} LIKE ?`);
        params.push(`%${rule.value}%`);
        break;
      default:
        break;
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortColumn = SORT_MAP[sort] || 'play_count';
  const order = sortOrder === 'asc' ? 'ASC' : 'DESC';
  const limitVal = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);

  const query = `
    SELECT id FROM tracks
    ${whereClause}
    ORDER BY ${sortColumn} ${order}
    LIMIT ?
  `;

  const tracks = db.prepare(query).all(...params, limitVal);
  const now = new Date().toISOString();

  // Replace all playlist tracks in a transaction
  const rebuild = db.transaction(() => {
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId);

    const insert = db.prepare(
      'INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)'
    );

    for (let i = 0; i < tracks.length; i++) {
      insert.run(playlistId, tracks[i].id, i, now);
    }

    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, playlistId);
  });

  rebuild();

  return getPlaylistTracks(playlistId);
}

/**
 * Preview what tracks would be returned by criteria, without saving.
 * Useful for the "preview" button in the auto-generate UI.
 */
export function previewAutoCriteria(criteria) {
  const db = getDb();

  const { rules = [], sort = 'playCount', sortOrder = 'desc', limit = 50 } = criteria;

  const conditions = [];
  const params = [];

  for (const rule of rules) {
    const column = FIELD_MAP[rule.field];
    if (!column) continue;

    switch (rule.op) {
      case 'eq':
        conditions.push(`${column} = ?`);
        params.push(rule.value);
        break;
      case 'gte':
        conditions.push(`CAST(${column} AS INTEGER) >= ?`);
        params.push(Number(rule.value));
        break;
      case 'lte':
        conditions.push(`CAST(${column} AS INTEGER) <= ?`);
        params.push(Number(rule.value));
        break;
      case 'contains':
        conditions.push(`${column} LIKE ?`);
        params.push(`%${rule.value}%`);
        break;
      default:
        break;
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortColumn = SORT_MAP[sort] || 'play_count';
  const order = sortOrder === 'asc' ? 'ASC' : 'DESC';
  const limitVal = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);

  const query = `
    SELECT id, saavn_id AS saavnId, title, artist, album_title AS albumTitle,
           image, quality, duration, play_count AS playCount, year, language,
           file_path AS filePath, is_explicit AS isExplicit
    FROM tracks
    ${whereClause}
    ORDER BY ${sortColumn} ${order}
    LIMIT ?
  `;

  const rows = db.prepare(query).all(...params, limitVal);
  return rows.map(r => ({ ...r, isExplicit: !!r.isExplicit }));
}

// ─── Track search (for adding tracks to manual playlists) ─────────────────────

/**
 * Search tracks in download history for adding to playlists.
 * Returns matching tracks with their IDs.
 */
export function searchTracks(query, limit = 20) {
  const db = getDb();
  const search = `%${query}%`;

  const rows = db.prepare(`
    SELECT id, saavn_id AS saavnId, title, artist, album_title AS albumTitle,
           image, quality, duration, play_count AS playCount, year, language,
           file_path AS filePath, is_explicit AS isExplicit, downloaded_at AS downloadedAt
    FROM tracks
    WHERE title LIKE ? OR artist LIKE ? OR album_title LIKE ?
    ORDER BY downloaded_at DESC
    LIMIT ?
  `).all(search, search, search, limit);

  return rows.map(r => ({ ...r, isExplicit: !!r.isExplicit }));
}

// ─── M3U8 Export ──────────────────────────────────────────────────────────────

/**
 * Generates M3U8 content for a playlist.
 * Returns the string content (caller handles writing to disk).
 * Tracks without a file_path are skipped with a comment.
 */
export function generateM3U8(playlistId, musicPath = '') {
  const playlist = getPlaylist(playlistId);
  if (!playlist) return null;

  const tracks = getPlaylistTracks(playlistId);
  const lines = ['#EXTM3U', `#PLAYLIST:${playlist.name}`];

  // Ensure musicPath ends with a trailing slash for clean concatenation
  const prefix = musicPath ? (musicPath.endsWith('/') ? musicPath : musicPath + '/') : '';

  for (const track of tracks) {
    if (!track.filePath) {
      lines.push(`# SKIPPED (no file path): ${track.artist} - ${track.title}`);
      continue;
    }

    const duration = track.duration || 0;
    const display = `${track.artist} - ${track.title}`;

    lines.push(`#EXTINF:${duration},${display}`);
    // Use absolute path so Navidrome can resolve tracks reliably
    lines.push(`${prefix}${track.filePath}`);
  }

  return { content: lines.join('\n') + '\n', name: playlist.name, trackCount: tracks.length };
}

/**
 * Export all playlists as M3U8 files.
 * Returns an array of { name, content } for each playlist.
 */
export function generateAllM3U8(musicPath = '') {
  const playlists = listPlaylists();
  const results = [];

  for (const playlist of playlists) {
    const m3u8 = generateM3U8(playlist.id, musicPath);
    if (m3u8) results.push(m3u8);
  }

  return results;
}

// ─── File path backfill ───────────────────────────────────────────────────────

/**
 * Scans a music directory and attempts to match files to tracks in the database
 * by reconstructing paths from metadata. Updates file_path for matched tracks.
 *
 * Returns { matched, unmatched, total }
 */
export async function backfillFilePaths(musicPath) {
  const { readdir, stat: fsStat } = await import('node:fs/promises');
  const { join, relative } = await import('node:path');

  const db = getDb();

  // Get all tracks that don't have a file_path
  const tracksWithoutPath = db.prepare(
    "SELECT id, title, artist, album_title, track_number FROM tracks WHERE file_path = '' OR file_path IS NULL"
  ).all();

  if (tracksWithoutPath.length === 0) {
    return { matched: 0, unmatched: 0, total: 0 };
  }

  // Recursively walk the music directory and collect all .m4a files
  const allFiles = [];
  async function walk(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.m4a')) {
          allFiles.push(relative(musicPath, fullPath));
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  await walk(musicPath);

  // Build a lookup map: normalize filename for fuzzy matching
  // File format from downloadAlbumLibrary: "Album (Year)/01 - Title - Artist.m4a"
  // File format from saveTrackToLibrary: "Album/Title - Artist.m4a"
  const fileMap = new Map();
  for (const filePath of allFiles) {
    const filename = filePath.split('/').pop() || '';
    // Strip track number prefix (e.g. "01 - "), then strip .m4a
    const withoutNumber = filename.replace(/^\d+\s*-\s*/, '').replace(/\.m4a$/i, '').trim();
    // Normalize to lowercase for case-insensitive matching
    const normalized = withoutNumber.toLowerCase();
    // The title is everything before the last " - Artist" chunk
    const lastDash = normalized.lastIndexOf(' - ');
    const titleOnly = lastDash > 0 ? normalized.slice(0, lastDash) : normalized;

    // Index by both so we match either format
    for (const key of new Set([normalized, titleOnly])) {
      if (!fileMap.has(key)) fileMap.set(key, []);
      fileMap.get(key).push(filePath);
    }
  }

  let matched = 0;
  let unmatched = 0;

  const update = db.prepare('UPDATE tracks SET file_path = ? WHERE id = ?');

  const batchUpdate = db.transaction((matches) => {
    for (const { id, path } of matches) {
      update.run(path, id);
    }
  });

  const matches = [];

  for (const track of tracksWithoutPath) {
    const titleNormalized = (track.title || '').toLowerCase().trim();
    // Apply the same sanitizeFilename transformation used when saving:
    // replaces /\?%*:|"<> with '-'
    const titleSanitized = titleNormalized.replace(/[/\\?%*:|"<>]/g, '-').trim();
    const artistNormalized = (track.artist || '').toLowerCase().trim();
    const artistSanitized = artistNormalized.replace(/[/\\?%*:|"<>]/g, '-').trim();

    // Try multiple key variants to maximise match rate
    const titleWithArtist = artistSanitized ? `${titleSanitized} - ${artistSanitized}` : null;
    const titleWithArtistRaw = artistNormalized ? `${titleNormalized} - ${artistNormalized}` : null;

    const candidates =
      fileMap.get(titleSanitized) ||
      (titleWithArtist ? fileMap.get(titleWithArtist) : null) ||
      fileMap.get(titleNormalized) ||
      (titleWithArtistRaw ? fileMap.get(titleWithArtistRaw) : null);

    if (candidates && candidates.length > 0) {
      // If multiple candidates, try to match by artist/album in path
      let bestMatch = candidates[0];

      if (candidates.length > 1) {
        const artistLower = (track.artist || '').toLowerCase();
        const albumLower = (track.album_title || '').toLowerCase();

        for (const candidate of candidates) {
          const pathLower = candidate.toLowerCase();
          if (pathLower.includes(artistLower) || pathLower.includes(albumLower)) {
            bestMatch = candidate;
            break;
          }
        }
      }

      matches.push({ id: track.id, path: bestMatch });
      matched++;
    } else {
      unmatched++;
    }
  }

  if (matches.length > 0) {
    batchUpdate(matches);
  }

  return { matched, unmatched, total: tracksWithoutPath.length };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizePositions(db, playlistId) {
  const rows = db.prepare(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC'
  ).all(playlistId);

  const update = db.prepare(
    'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?'
  );

  const normalize = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      update.run(i, playlistId, rows[i].track_id);
    }
  });

  normalize();
}

function formatPlaylist(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    autoGenerate: !!row.auto_generate,
    autoCriteria: row.auto_criteria ? safeParse(row.auto_criteria) : null,
    trackCount: row.track_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
