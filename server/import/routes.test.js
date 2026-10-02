/**
 * Handler checks for /api/import/* with fully stubbed dependencies (no network,
 * no DB, no yt-dlp). Run with: node --test server/import/routes.test.js
 *
 * Covers:
 *   - 403 when the feature is disabled
 *   - 400 for a missing/non-YouTube URL
 *   - commit: in-history tracks are added immediately, missing ones are enqueued
 *     with the new playlist id
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleImportRoute } from './routes.js';
import { saavnToken } from '../downloads/fetcher.js';

/** Build a fake POST request whose body is the given JSON object. */
function fakeReq(bodyObj) {
  const req = Readable.from([Buffer.from(JSON.stringify(bodyObj))]);
  req.method = 'POST';
  return req;
}

/** Capture the (status, data) passed to jsonResponse. */
function captureResponse() {
  const calls = [];
  const jsonResponse = (_res, status, data) => { calls.push({ status, data }); return true; };
  return { calls, jsonResponse, res: {} };
}

function urlFor(path) {
  return new URL(`http://localhost${path}`);
}

test('returns 403 when the feature is disabled', async () => {
  const { calls, jsonResponse, res } = captureResponse();
  const handled = await handleImportRoute(
    fakeReq({ url: 'https://youtu.be/x' }), res, urlFor('/api/import/youtube'), jsonResponse,
    { enabled: false },
  );
  assert.equal(handled, true);
  assert.equal(calls[0].status, 403);
});

test('returns 400 for a non-YouTube URL', async () => {
  const { calls, jsonResponse, res } = captureResponse();
  await handleImportRoute(
    fakeReq({ url: 'https://vimeo.com/123' }), res, urlFor('/api/import/youtube'), jsonResponse,
    { enabled: true, deps: { fetchPlaylistEntries: async () => { throw new Error('should not run'); } } },
  );
  assert.equal(calls[0].status, 400);
});

test('youtube route returns matched entries', async () => {
  const { calls, jsonResponse, res } = captureResponse();
  const deps = {
    fetchPlaylistEntries: async () => [{ videoId: 'v1', title: 'Song One', uploader: 'A', duration: 200 }],
    matchEntry: async () => ({ query: 'Song One', candidates: [{ id: 'S1', title: 'Song One' }, { id: 'S2', title: 'Other' }], suggestedIndex: 0 }),
    // S1 already on disk, S2 not
    getExistingTracks: () => ({ S1: { exists: true, filePath: 'x.m4a' } }),
  };
  await handleImportRoute(
    fakeReq({ url: 'https://www.youtube.com/watch?v=v1&list=RDv1' }), res, urlFor('/api/import/youtube'), jsonResponse,
    { enabled: true, deps },
  );
  assert.equal(calls[0].status, 200);
  assert.equal(calls[0].data.entries.length, 1);
  assert.equal(calls[0].data.entries[0].youtube.videoId, 'v1');
  assert.equal(calls[0].data.entries[0].query, 'Song One');
  assert.equal(calls[0].data.entries[0].candidates[0].id, 'S1');
  // downloaded flag is surfaced for the review UI
  assert.equal(calls[0].data.entries[0].candidates[0].downloaded, true);
  assert.equal(calls[0].data.entries[0].candidates[1].downloaded, false);
});

test('search route re-runs a manual query and annotates downloaded', async () => {
  const { calls, jsonResponse, res } = captureResponse();
  const deps = {
    searchCandidates: async () => ({ candidates: [{ id: 'S9', title: 'Refined' }], suggestedIndex: 0 }),
    getExistingTracks: () => ({}),
  };
  await handleImportRoute(
    fakeReq({ query: 'kesariya arijit brahmastra' }), res, urlFor('/api/import/search'), jsonResponse,
    { enabled: true, deps },
  );
  assert.equal(calls[0].status, 200);
  assert.equal(calls[0].data.candidates[0].id, 'S9');
  assert.equal(calls[0].data.candidates[0].downloaded, false);
});

test('search route requires a query', async () => {
  const { calls, jsonResponse, res } = captureResponse();
  await handleImportRoute(
    fakeReq({ query: '  ' }), res, urlFor('/api/import/search'), jsonResponse, { enabled: true },
  );
  assert.equal(calls[0].status, 400);
});

test('commit adds in-history tracks now and enqueues missing ones', async () => {
  const { calls, jsonResponse, res } = captureResponse();
  const added = [];
  const enqueued = [];
  const fetched = [];
  const deps = {
    createPlaylist: ({ name }) => ({ id: 'pl1', name }),
    getExistingTracks: () => ({ A: { exists: true, filePath: 'x.m4a' } }),
    addTracksBySaavnId: (pid, ids) => { added.push({ pid, ids }); },
    fetchSongDetail: async (ref) => { fetched.push(ref); return { id: 'B', more_info: { encrypted_media_url: 'enc' } }; },
    enqueueTrack: (args) => { enqueued.push(args); return 'job-1'; },
  };

  await handleImportRoute(
    fakeReq({
      playlistName: 'My Import',
      quality: '320',
      selections: [
        { saavnId: 'A', permaUrl: 'https://jiosaavn.com/song/a/A' },
        { saavnId: 'B', token: 'Btok', permaUrl: 'https://jiosaavn.com/song/b/B' },
      ],
    }),
    res, urlFor('/api/import/commit'), jsonResponse, { enabled: true, deps },
  );

  assert.equal(calls[0].status, 200);
  const out = calls[0].data;
  assert.equal(out.playlistId, 'pl1');
  assert.equal(out.addedNow, 1);
  assert.equal(out.queued, 1);
  assert.equal(out.failed.length, 0);

  // A added immediately to the playlist
  assert.deepEqual(added, [{ pid: 'pl1', ids: ['A'] }]);
  // B enqueued as a library download tagged with the playlist id
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].mode, 'library');
  assert.equal(enqueued[0].playlistId, 'pl1');
  assert.equal(enqueued[0].song.id, 'B');
  // song detail is fetched by the candidate's token (not the perma_url)
  assert.deepEqual(fetched, ['Btok']);
});

test('saavnToken derives the token from a bare token or a JioSaavn URL', () => {
  assert.equal(saavnToken('https://www.jiosaavn.com/song/tum-hi-ho/EToxUyFpcwQ?x=1'), 'EToxUyFpcwQ');
  assert.equal(saavnToken('https://www.jiosaavn.com/album/aashiqui-2/-iNdCmFNV9o_/'), '-iNdCmFNV9o_');
  assert.equal(saavnToken('EToxUyFpcwQ'), 'EToxUyFpcwQ');
  assert.equal(saavnToken(''), '');
});

test('commit returns 409 on a duplicate playlist name', async () => {
  const { calls, jsonResponse, res } = captureResponse();
  const deps = {
    createPlaylist: () => { throw new Error('A playlist named "dup" already exists'); },
  };
  await handleImportRoute(
    fakeReq({ playlistName: 'dup', quality: '320', selections: [{ saavnId: 'A' }] }),
    res, urlFor('/api/import/commit'), jsonResponse, { enabled: true, deps },
  );
  assert.equal(calls[0].status, 409);
});
