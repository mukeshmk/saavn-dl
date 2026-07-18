#!/usr/bin/env node

/**
 * seed-history.js — One-time script to populate download history from existing files on disk.
 *
 * Scans a given directory for album folders matching the naming convention:
 *   <Album Name> (<Year>)/01 - Song Title - Artist.m4a
 *
 * Creates one "album" history entry per folder, inferring:
 *   - title: folder name without the year suffix
 *   - artist: most common artist across tracks in that folder
 *   - songCount: number of .m4a files in the folder
 *   - quality: "320" (assumed, since we can't know from disk)
 *
 * Enriches each entry by searching the JioSaavn API for the real album ID and cover art.
 *
 * Usage:
 *   node scripts/seed-history.js <scan-directory> [history-file-path]
 *
 * Examples:
 *   node scripts/seed-history.js /mnt/ssd
 *   node scripts/seed-history.js /mnt/nas /mnt/ssd/.saavn-dl-history.json
 *
 * If history-file-path is omitted, defaults to <scan-directory>/.saavn-dl-history.json
 *
 * The script merges with any existing history (deduplicates by saavnId or title+artist).
 */

import { readdir, stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname, extname } from 'node:path';
import { existsSync } from 'node:fs';

// ─── Config ───────────────────────────────────────────────────────────────────

const SEARCH_API = 'https://rtmx.vercel.app/api/albums';
const DELAY_BETWEEN_REQUESTS = 500; // ms between API calls to avoid rate limiting

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const refreshMode = args.includes('--refresh');
const positionalArgs = args.filter(a => !a.startsWith('--'));

const scanDir = positionalArgs[0];
const historyPath = positionalArgs[1] || null;

if (!scanDir && !refreshMode) {
  console.error('Usage: node scripts/seed-history.js <scan-directory> [history-file-path]');
  console.error('       node scripts/seed-history.js --refresh <history-file-path>');
  console.error('');
  console.error('Modes:');
  console.error('  (default)   Scan a directory and add new album entries with API lookup');
  console.error('  --refresh   Re-fetch missing images/metadata for existing entries in the history file');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/seed-history.js /mnt/ssd');
  console.error('  node scripts/seed-history.js /mnt/nas /mnt/ssd/.saavn-dl-history.json');
  console.error('  node scripts/seed-history.js --refresh /mnt/ssd/.saavn-dl-history.json');
  process.exit(1);
}

// In refresh mode, first positional arg is the history file path
const resolvedScanDir = refreshMode ? null : resolve(scanDir);
const resolvedHistoryPath = refreshMode
  ? resolve(positionalArgs[0] || '.saavn-dl-history.json')
  : (historyPath ? resolve(historyPath) : join(resolvedScanDir, '.saavn-dl-history.json'));

if (!refreshMode && !existsSync(resolvedScanDir)) {
  console.error(`Error: Directory not found: ${resolvedScanDir}`);
  process.exit(1);
}

if (refreshMode && !existsSync(resolvedHistoryPath)) {
  console.error(`Error: History file not found: ${resolvedHistoryPath}`);
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse album folder name: "Album Name (2024)" → { title: "Album Name", year: "2024" }
 * Falls back to full folder name if no year pattern found.
 */
function parseAlbumFolder(folderName) {
  const match = folderName.match(/^(.+?)\s*\((\d{4})\)$/);
  if (match) {
    return { title: match[1].trim(), year: match[2] };
  }
  return { title: folderName, year: '' };
}

/**
 * Parse track filename: "01 - Song Title - Artist.m4a" → { title, artist }
 * Falls back to filename without extension if pattern doesn't match.
 */
function parseTrackFilename(filename) {
  const name = filename.replace(/\.m4a$/i, '');
  // Pattern: "NN - Title - Artist" or "Title - Artist"
  const match = name.match(/^(?:\d+\s*-\s*)?(.+?)\s*-\s*(.+)$/);
  if (match) {
    return { title: match[1].trim(), artist: match[2].trim() };
  }
  return { title: name, artist: 'Unknown Artist' };
}

/**
 * Find the most common artist in a list (mode).
 */
function mostCommonArtist(artists) {
  const counts = {};
  for (const a of artists) {
    counts[a] = (counts[a] || 0) + 1;
  }
  let best = artists[0] || 'Unknown Artist';
  let bestCount = 0;
  for (const [artist, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = artist;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Normalize a string for fuzzy comparison.
 */
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Search JioSaavn for an album and return the best match with id + image.
 */
async function searchAlbumOnSaavn(title, artist) {
  try {
    const query = `${title} ${artist}`;
    const res = await fetch(`${SEARCH_API}?q=${encodeURIComponent(query)}`);
    if (!res.ok) return null;

    const data = await res.json();
    const results = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];

    if (results.length === 0) return null;

    // Try to find a close title match
    const normalizedTitle = normalize(title);
    const match = results.find((r) => normalize(r.title) === normalizedTitle);

    // Use best match or fall back to first result
    const best = match || results[0];

    return {
      saavnId: best.id,
      image: best.image || '',
      title: best.title || title,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch album detail by saavnId to get image and metadata.
 * Uses JioSaavn's internal API directly with the numeric album ID.
 */
async function fetchAlbumById(saavnId) {
  try {
    const res = await fetch(
      `https://www.jiosaavn.com/api.php?__call=content.getAlbumDetails&albumid=${encodeURIComponent(saavnId)}&_format=json&_marker=0`
    );
    if (res.ok) {
      const text = await res.text();
      // JioSaavn sometimes returns JSONP or has trailing garbage — find the JSON object
      const jsonStart = text.indexOf('{');
      if (jsonStart === -1) return null;
      const data = JSON.parse(text.slice(jsonStart));
      if (data && data.image) {
        return {
          saavnId: data.albumid || saavnId,
          image: data.image,
          title: data.title || data.name || '',
        };
      }
    }
  } catch { /* ignore */ }

  return null;
}

/**
 * Generate a fallback ID for entries where API lookup fails.
 */
function generateFallbackId(title, artist) {
  const slug = `${title}-${artist}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
  return `album-seed-${slug}`;
}

// ─── Read existing history ────────────────────────────────────────────────────

async function readHistory() {
  try {
    const raw = await readFile(resolvedHistoryPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { entries: [] };
  }
}

async function writeHistory(state) {
  const dir = dirname(resolvedHistoryPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(resolvedHistoryPath, JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

async function scanAlbums() {
  const entries = await readdir(resolvedScanDir, { withFileTypes: true });
  const albums = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip hidden files/folders
    if (entry.name.startsWith('.')) continue;

    const albumDir = join(resolvedScanDir, entry.name);
    const files = await readdir(albumDir);
    const m4aFiles = files.filter(f => extname(f).toLowerCase() === '.m4a');

    if (m4aFiles.length === 0) continue;

    const { title, year } = parseAlbumFolder(entry.name);
    const trackArtists = m4aFiles.map(f => parseTrackFilename(f).artist);
    const artist = mostCommonArtist(trackArtists);

    // Use folder modified time as approximate download time
    const folderStat = await stat(albumDir);
    const downloadedAt = folderStat.mtime.toISOString();

    albums.push({
      title,
      artist,
      year,
      songCount: m4aFiles.length,
      downloadedAt,
    });
  }

  return albums;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function refreshExistingEntries() {
  console.log(`Refreshing entries in: ${resolvedHistoryPath}`);
  console.log('Looking for entries with missing images or fallback IDs...\n');

  const state = await readHistory();
  const entries = state.entries;

  // Find entries that need refreshing: missing image, or have fallback IDs
  const needsRefresh = entries.filter(e =>
    e.type === 'album' && (!e.image || e.saavnId?.startsWith('album-seed-'))
  );

  if (needsRefresh.length === 0) {
    console.log('All entries already have images and real IDs. Nothing to refresh.');
    return;
  }

  console.log(`Found ${needsRefresh.length} entries to refresh.\n`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < needsRefresh.length; i++) {
    const entry = needsRefresh[i];
    const progress = `[${i + 1}/${needsRefresh.length}]`;

    let result = null;

    // If entry has a real saavnId (not a fallback), fetch by ID directly
    if (entry.saavnId && !entry.saavnId.startsWith('album-seed-')) {
      result = await fetchAlbumById(entry.saavnId);
    }

    // If that didn't work (or it was a fallback ID), try searching by title + artist
    if (!result) {
      result = await searchAlbumOnSaavn(entry.title, entry.artist);
    }

    if (result) {
      // Update the entry in place
      const idx = entries.indexOf(entry);
      if (idx !== -1) {
        // Only update saavnId if it was a fallback
        if (entry.saavnId?.startsWith('album-seed-')) {
          entries[idx].saavnId = result.saavnId;
          entries[idx].id = `album-${result.saavnId}-seed`;
        }
        entries[idx].image = result.image;
        const what = !entry.image ? 'image updated' : 'ID + image updated';
        console.log(`  ${progress} ✓ ${entry.title} — ${entry.artist} → ${what}`);
        updated++;
      }
    } else {
      console.log(`  ${progress} ✗ ${entry.title} — ${entry.artist} (not found on API)`);
      failed++;
    }

    if (i < needsRefresh.length - 1) {
      await sleep(DELAY_BETWEEN_REQUESTS);
    }
  }

  await writeHistory(state);

  console.log(`\nDone! Updated ${updated} entries, ${failed} could not be found.`);
  console.log(`Total history entries: ${state.entries.length}`);
}

async function seedFromDirectory() {
  console.log(`Scanning: ${resolvedScanDir}`);
  console.log(`History file: ${resolvedHistoryPath}`);
  console.log('');

  const scannedAlbums = await scanAlbums();

  if (scannedAlbums.length === 0) {
    console.log('No album folders with .m4a files found.');
    return;
  }

  console.log(`Found ${scannedAlbums.length} album(s). Looking up IDs from JioSaavn API...\n`);

  // Enrich with saavnIds from the API
  const enriched = [];
  let found = 0;
  let notFound = 0;

  for (let i = 0; i < scannedAlbums.length; i++) {
    const album = scannedAlbums[i];
    const progress = `[${i + 1}/${scannedAlbums.length}]`;

    const result = await searchAlbumOnSaavn(album.title, album.artist);

    if (result) {
      enriched.push({
        id: `album-${result.saavnId}-seed`,
        saavnId: result.saavnId,
        type: 'album',
        title: result.title,
        artist: album.artist,
        album: result.title,
        image: result.image,
        quality: '320',
        mode: 'library',
        songCount: album.songCount,
        downloadedAt: album.downloadedAt,
      });
      console.log(`  ${progress} ✓ ${album.title} — ${album.artist} → id: ${result.saavnId}`);
      found++;
    } else {
      const fallbackId = generateFallbackId(album.title, album.artist);
      enriched.push({
        id: fallbackId,
        saavnId: fallbackId,
        type: 'album',
        title: album.title,
        artist: album.artist,
        album: album.title,
        image: '',
        quality: '320',
        mode: 'library',
        songCount: album.songCount,
        downloadedAt: album.downloadedAt,
      });
      console.log(`  ${progress} ✗ ${album.title} — ${album.artist} (not found, using fallback ID)`);
      notFound++;
    }

    // Rate limiting
    if (i < scannedAlbums.length - 1) {
      await sleep(DELAY_BETWEEN_REQUESTS);
    }
  }

  console.log(`\nAPI lookup complete: ${found} found, ${notFound} not found.`);

  // Merge with existing history
  const state = await readHistory();
  const existingSaavnIds = new Set(state.entries.map(e => e.saavnId));
  let added = 0;
  let skipped = 0;

  for (const album of enriched) {
    if (existingSaavnIds.has(album.saavnId)) {
      skipped++;
    } else {
      state.entries.unshift(album);
      existingSaavnIds.add(album.saavnId);
      added++;
    }
  }

  await writeHistory(state);

  console.log(`\nDone! Added ${added} new entries, skipped ${skipped} duplicates.`);
  console.log(`Total history entries: ${state.entries.length}`);
}

async function main() {
  if (refreshMode) {
    await refreshExistingEntries();
  } else {
    await seedFromDirectory();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
