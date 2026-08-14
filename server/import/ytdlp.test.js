/**
 * Unit checks for the yt-dlp wrapper (no network, no binary).
 * Run with: node --test server/import/ytdlp.test.js
 *
 * Covers the security- and correctness-critical pure pieces:
 *   - the YouTube host allowlist (accept/reject)
 *   - `--proxy` is threaded in only when SAAVN_YTDLP_PROXY is set
 *   - a real `--dump-single-json` shape parses into our entry objects (truncated to limit)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isAllowedYoutubeUrl, buildExtractArgs, parseEntries } from './ytdlp.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'ytdlp.fixture.json'), 'utf-8'));

test('isAllowedYoutubeUrl accepts supported YouTube hosts', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=FF05kDJOgLk&list=RDFF05kDJOgLk&start_radio=1',
    'https://youtube.com/playlist?list=PLxyz',
    'https://music.youtube.com/watch?v=abc',
    'https://youtu.be/FF05kDJOgLk',
  ]) {
    assert.equal(isAllowedYoutubeUrl(url), true, url);
  }
});

test('isAllowedYoutubeUrl rejects everything else', () => {
  for (const url of [
    'https://vimeo.com/12345',
    'https://youtube.com.evil.com/watch?v=x',
    'ftp://youtube.com/watch?v=x',
    'not a url',
    'https://saavncdn.com/x.mp4',
    '',
  ]) {
    assert.equal(isAllowedYoutubeUrl(url), false, url);
  }
});

test('buildExtractArgs omits --proxy when SAAVN_YTDLP_PROXY is unset', () => {
  const args = buildExtractArgs('https://youtu.be/x', { limit: 50, env: {} });
  assert.ok(!args.includes('--proxy'));
  assert.ok(args.includes('--flat-playlist'));
  assert.ok(args.includes('--dump-single-json'));
  // limit is bounded via --playlist-end
  const i = args.indexOf('--playlist-end');
  assert.ok(i >= 0 && args[i + 1] === '50');
  // URL is the final positional arg
  assert.equal(args[args.length - 1], 'https://youtu.be/x');
});

test('buildExtractArgs includes --proxy <value> when SAAVN_YTDLP_PROXY is set', () => {
  const args = buildExtractArgs('https://youtu.be/x', {
    env: { SAAVN_YTDLP_PROXY: 'socks5://127.0.0.1:1080' },
  });
  const i = args.indexOf('--proxy');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], 'socks5://127.0.0.1:1080');
});

test('parseEntries maps a --dump-single-json payload and skips null ids', () => {
  const entries = parseEntries(fixture);
  // fixture has 4 entries, one with a null id → dropped
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], {
    videoId: 'FF05kDJOgLk',
    title: 'Artist A - First Song (Official Video)',
    uploader: 'Artist A',
    duration: 215,
  });
  // falls back channel → uploader when uploader is absent
  assert.equal(entries[1].uploader, 'T-Series');
  // null duration coerces to 0; uploader_id used as last resort
  assert.equal(entries[2].duration, 0);
  assert.equal(entries[2].uploader, '@somechannel');
});

test('parseEntries truncates to the limit', () => {
  assert.equal(parseEntries(fixture, 1).length, 1);
});

test('parseEntries treats a single-video dump as one entry', () => {
  const entries = parseEntries({ id: 'solo123', title: 'Solo', duration: 100 });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].videoId, 'solo123');
});
