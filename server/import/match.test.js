/**
 * Unit checks for title cleaning + candidate ranking (no network).
 * Run with: node --test server/import/match.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, rankCandidates, scoreCandidate } from './match.js';

test('cleanTitle strips bracketed noise and channel tags', () => {
  assert.equal(cleanTitle('Artist A - First Song (Official Video)'), 'Artist A - First Song');
  assert.equal(cleanTitle('Second Song [4K] | T-Series'), 'Second Song');
  assert.equal(cleanTitle('Kesariya (Full Video) | Brahmastra'), 'Kesariya');
});

test('cleanTitle removes ft./feat. clauses', () => {
  assert.equal(cleanTitle('Song Title ft. Someone Else'), 'Song Title');
  assert.equal(cleanTitle('Song Title feat. A & B'), 'Song Title');
});

test('cleanTitle removes standalone noise words and emojis', () => {
  assert.equal(cleanTitle('My Song Lyrical'), 'My Song');
  assert.equal(cleanTitle('My Song 🔥🎵 Official Audio'), 'My Song');
});

test('cleanTitle leaves an already-clean title untouched', () => {
  assert.equal(cleanTitle('Kesariya'), 'Kesariya');
});

// Canned search results (lean SearchResult shape) — no network.
const CANDIDATES = [
  { id: 'wrong1', title: 'Kesariya Lofi Flip', subtitle: 'VIBIE - Kesariya (Lofi Flip)', more_info: { duration: '240' } },
  { id: 'right', title: 'Kesariya', subtitle: 'Pritam, Arijit Singh - Brahmastra', more_info: { duration: '268' } },
  { id: 'wrong2', title: 'Kesariya Dance Mix', subtitle: 'Pritam - Brahmastra', more_info: { duration: '210' } },
];

test('rankCandidates ranks the exact title match first', () => {
  const entry = { title: 'Kesariya (Official Video) | Arijit Singh', uploader: 'Arijit Singh', duration: 268 };
  const { candidates, suggestedIndex } = rankCandidates(entry, CANDIDATES);
  assert.equal(suggestedIndex, 0);
  assert.equal(candidates[0].id, 'right');
  // projected shape is lean (no encrypted_media_url leaks through)
  assert.ok(!('encrypted_media_url' in (candidates[0].more_info || {})));
});

test('rankCandidates returns suggestedIndex -1 for no candidates', () => {
  const { candidates, suggestedIndex } = rankCandidates({ title: 'x' }, []);
  assert.equal(candidates.length, 0);
  assert.equal(suggestedIndex, -1);
});

test('scoreCandidate rewards close duration', () => {
  const entry = { title: 'Kesariya', uploader: '', duration: 268 };
  const exact = scoreCandidate(entry, CANDIDATES[1]); // 268s
  const off = scoreCandidate(entry, { ...CANDIDATES[1], more_info: { duration: '200' } });
  assert.ok(exact > off);
});
