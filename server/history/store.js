/**
 * History Store — persists download history to SQLite.
 *
 * Each entry records a completed track or album download with metadata.
 * Album entries include per-track data for playlist generation and stats.
 *
 * Deduplicates by saavnId + type — re-downloading updates the timestamp.
 */

import { getDb } from '../db/index.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a download entry to history.
 * For albums, also inserts per-track records if `tracks` array is provided.
 * Deduplicates by saavnId + type — if already exists, updates the entry.
 */
export function addEntry(entry) {
  const db = getDb();

  if (entry.type === 'album') {
    return addAlbumEntry(db, entry);
  }
  return addTrackEntry(db, entry);
}

/**
 * Get all history entries, optionally filtered by type.
 * Returns entries in reverse chronological order (most recent first).
 */
export function getEntries(type) {
  const db = getDb();

  if (type === 'track') {
    // Return standalone tracks (no album_id) — these are individually downloaded songs
    const rows = db.prepare(`
      SELECT id, saavn_id AS saavnId, title, artist, album_title AS album, image,
             quality, duration, play_count AS playCount, year, language,
             track_number AS trackNumber, file_path AS filePath, is_explicit AS isExplicit,
             downloaded_at AS downloadedAt
      FROM tracks WHERE album_id IS NULL
      ORDER BY downloaded_at DESC
    `).all();

    return rows.map((r) => ({ ...r, type: 'track', isExplicit: !!r.isExplicit }));
  }

  if (type === 'album') {
    const rows = db.prepare(`
      SELECT id, saavn_id AS saavnId, title, artist, image, quality, mode,
             song_count AS songCount, year, language, downloaded_at AS downloadedAt
      FROM albums ORDER BY downloaded_at DESC
    `).all();

    return rows.map((r) => ({ ...r, type: 'album' }));
  }

  // All entries — combine albums and standalone tracks, sorted by date
  const albums = db.prepare(`
    SELECT id, saavn_id AS saavnId, 'album' AS type, title, artist, image, quality, mode,
           song_count AS songCount, year, language, downloaded_at AS downloadedAt
    FROM albums
  `).all();

  const tracks = db.prepare(`
    SELECT id, saavn_id AS saavnId, 'track' AS type, title, artist, album_title AS album, image,
           quality, duration, play_count AS playCount, year, language,
           file_path AS filePath, is_explicit AS isExplicit, downloaded_at AS downloadedAt
    FROM tracks WHERE album_id IS NULL
  `).all();

  const all = [...albums, ...tracks.map((r) => ({ ...r, isExplicit: !!r.isExplicit }))];
  all.sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));

  return all;
}

/**
 * Get downloaded IDs for fast "already downloaded" badge checks.
 * Returns { tracks: string[], albums: string[] }
 */
export function getDownloadedIds() {
  const db = getDb();

  const trackIds = db.prepare('SELECT DISTINCT saavn_id FROM tracks').all().map((r) => r.saavn_id);
  const albumIds = db.prepare('SELECT saavn_id FROM albums').all().map((r) => r.saavn_id);

  return { tracks: trackIds, albums: albumIds };
}

/**
 * Get tracks belonging to a specific album (by album's internal id).
 */
export function getAlbumTracks(albumId) {
  const db = getDb();

  const rows = db.prepare(`
    SELECT id, saavn_id AS saavnId, title, artist, album_title AS album,
           album_artist AS albumArtist, image, quality, duration,
           play_count AS playCount, year, language, track_number AS trackNumber,
           file_path AS filePath, is_explicit AS isExplicit, downloaded_at AS downloadedAt
    FROM tracks WHERE album_id = ?
    ORDER BY track_number ASC
  `).all(albumId);

  return rows.map((r) => ({ ...r, type: 'track', isExplicit: !!r.isExplicit }));
}

/**
 * Remove a specific entry by its id.
 * Tries albums first, then tracks.
 */
export function removeEntry(id) {
  const db = getDb();

  // If removing an album, also remove its tracks
  const album = db.prepare('SELECT id FROM albums WHERE id = ?').get(id);
  if (album) {
    const deleteAlbumTracks = db.prepare('DELETE FROM tracks WHERE album_id = ?');
    const deleteAlbum = db.prepare('DELETE FROM albums WHERE id = ?');
    db.transaction(() => {
      deleteAlbumTracks.run(id);
      deleteAlbum.run(id);
    })();
    return;
  }

  // Try removing a track
  db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
}

/**
 * Clear all history — removes all albums and tracks.
 */
export function clearHistory() {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM tracks').run();
    db.prepare('DELETE FROM albums').run();
  })();
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function addAlbumEntry(db, entry) {
  const id = entry.id || `album-${entry.saavnId}-${Date.now()}`;
  const now = new Date().toISOString();

  const upsertAlbum = db.prepare(`
    INSERT INTO albums (id, saavn_id, title, artist, image, quality, mode, song_count, year, language, downloaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(saavn_id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      image = excluded.image,
      quality = excluded.quality,
      mode = excluded.mode,
      song_count = excluded.song_count,
      year = excluded.year,
      language = excluded.language,
      downloaded_at = excluded.downloaded_at
  `);

  const upsertTrack = db.prepare(`
    INSERT INTO tracks (id, saavn_id, album_id, title, artist, album_title, album_artist, image, quality, duration, play_count, year, language, track_number, file_path, is_explicit, downloaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(saavn_id) DO UPDATE SET
      album_id = excluded.album_id,
      title = excluded.title,
      artist = excluded.artist,
      album_title = excluded.album_title,
      album_artist = excluded.album_artist,
      image = excluded.image,
      quality = excluded.quality,
      duration = excluded.duration,
      play_count = excluded.play_count,
      year = excluded.year,
      language = excluded.language,
      track_number = excluded.track_number,
      file_path = excluded.file_path,
      is_explicit = excluded.is_explicit,
      downloaded_at = excluded.downloaded_at
  `);

  // Get the real album id (may already exist due to UNIQUE on saavn_id)
  const existing = db.prepare('SELECT id FROM albums WHERE saavn_id = ?').get(entry.saavnId);
  const albumId = existing ? existing.id : id;

  const insertAll = db.transaction(() => {
    upsertAlbum.run(
      albumId,
      entry.saavnId,
      entry.title || '',
      entry.artist || '',
      entry.image || '',
      entry.quality || '',
      entry.mode || '',
      entry.songCount || 0,
      entry.year || '',
      entry.language || '',
      now
    );

    // Insert per-track data if provided
    if (entry.tracks && Array.isArray(entry.tracks)) {
      for (let i = 0; i < entry.tracks.length; i++) {
        const track = entry.tracks[i];
        const trackId = `track-${track.saavnId}-${Date.now()}-${i}`;

        upsertTrack.run(
          trackId,
          track.saavnId,
          albumId,
          track.title || '',
          track.artist || '',
          track.albumTitle || entry.title || '',
          track.albumArtist || entry.artist || '',
          track.image || entry.image || '',
          entry.quality || '',
          parseInt(track.duration, 10) || 0,
          parseInt(track.playCount, 10) || 0,
          track.year || entry.year || '',
          track.language || entry.language || '',
          track.trackNumber || i + 1,
          track.filePath || '',
          track.isExplicit ? 1 : 0,
          now
        );
      }
    }
  });

  insertAll();

  return {
    id: albumId,
    saavnId: entry.saavnId,
    type: 'album',
    title: entry.title || '',
    artist: entry.artist || '',
    image: entry.image || '',
    quality: entry.quality || '',
    mode: entry.mode || '',
    songCount: entry.songCount || 0,
    downloadedAt: now,
  };
}

function addTrackEntry(db, entry) {
  const now = new Date().toISOString();
  const id = entry.id || `track-${entry.saavnId}-${Date.now()}`;

  const existing = db.prepare('SELECT id FROM tracks WHERE saavn_id = ?').get(entry.saavnId);
  const trackId = existing ? existing.id : id;

  db.prepare(`
    INSERT INTO tracks (id, saavn_id, album_id, title, artist, album_title, album_artist, image, quality, duration, play_count, year, language, track_number, file_path, is_explicit, downloaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(saavn_id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      album_title = excluded.album_title,
      album_artist = excluded.album_artist,
      image = excluded.image,
      quality = excluded.quality,
      duration = excluded.duration,
      play_count = excluded.play_count,
      year = excluded.year,
      language = excluded.language,
      track_number = excluded.track_number,
      file_path = excluded.file_path,
      is_explicit = excluded.is_explicit,
      downloaded_at = excluded.downloaded_at
  `).run(
    trackId,
    entry.saavnId,
    null, // standalone track, no album association
    entry.title || '',
    entry.artist || '',
    entry.album || '',
    entry.albumArtist || entry.artist || '',
    entry.image || '',
    entry.quality || '',
    parseInt(entry.duration, 10) || 0,
    parseInt(entry.playCount, 10) || 0,
    entry.year || '',
    entry.language || '',
    entry.trackNumber || 0,
    entry.filePath || '',
    entry.isExplicit ? 1 : 0,
    now
  );

  return {
    id: trackId,
    saavnId: entry.saavnId,
    type: 'track',
    title: entry.title || '',
    artist: entry.artist || '',
    album: entry.album || '',
    image: entry.image || '',
    quality: entry.quality || '',
    downloadedAt: now,
  };
}
