/**
 * Check the YouTube-import playlist tagging path (Task 4):
 *   - insertTrackJob persists target_playlist_id
 *   - addToTargetPlaylist is order-dependent: it SKIPS a saavnId that isn't in
 *     history yet, and ADDS it once the track has been recorded to history.
 *
 * Runs against a throwaway SQLite file (no ffmpeg/network needed).
 * Run with: node --test server/downloads/queue.playlist.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Point the DB layer at a temp file BEFORE importing any module that resolves it.
const DB_FILE = join(tmpdir(), `saavn-queue-test-${randomUUID()}.db`);
process.env.SAAVN_DB_PATH = DB_FILE;

test('tagged track is added to its playlist only after history recording', async (t) => {
  const { initDb, closeDb } = await import('../db/index.js');
  const { insertTrackJob, getJobRow } = await import('./store.js');
  const { downloadWorker } = await import('./queue.js');
  const { createPlaylist, getPlaylistTracks } = await import('../playlists/store.js');
  const { recordTrack } = await import('./recorder.js');

  initDb();
  t.after(() => {
    closeDb();
    for (const ext of ['', '-wal', '-shm']) {
      try { rmSync(DB_FILE + ext, { force: true }); } catch { /* ignore */ }
    }
  });

  const pl = createPlaylist({ name: `yt-import-${randomUUID()}` });
  const song = { id: 'SONG1', title: 'Test Track', subtitle: 'Artist X - Album Y', image: '', more_info: {} };

  const jobId = insertTrackJob({ song, quality: '320', mode: 'library', playlistId: pl.id });
  const job = getJobRow(jobId);
  assert.equal(job.target_playlist_id, pl.id, 'job persists the target playlist id');

  // Before the track exists in history, the add is a no-op (silent skip).
  await downloadWorker.addToTargetPlaylist(job, song.id);
  assert.equal(getPlaylistTracks(pl.id).length, 0, 'nothing added before history record');

  // Record to history (as the worker does on successful library completion)…
  recordTrack({ saavnId: song.id, title: song.title, artist: 'Artist X', mode: 'library', filePath: 'Artist X/Album Y/Test Track - Artist X.m4a' });

  // …now the same call resolves the track and adds it.
  await downloadWorker.addToTargetPlaylist(job, song.id);
  const tracks = getPlaylistTracks(pl.id);
  assert.equal(tracks.length, 1, 'track added after history record');
  assert.equal(tracks[0].saavnId, song.id);
});
