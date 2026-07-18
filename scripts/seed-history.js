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

const scanDir = process.argv[2];
const historyPath = process.argv[3] || null;

if (!scanDir) {
  console.error('Usage: node scripts/seed-history.js <scan-directory> [history-file-path]');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/seed-history.js /mnt/ssd');
  console.error('  node scripts/seed-history.js /mnt/nas /mnt/ssd/.saavn-dl-history.json');
  process.exit(1);
}

const resolvedScanDir = resolve(scanDir);

if (!existsSync(resolvedScanDir)) {
  console.error(`Error: Directory not found: ${resolvedScanDir}`);
  process.exit(1);
}

const resolvedHistoryPath = historyPath
  ? resolve(historyPath)
  : join(resolvedScanDir, '.saavn-dl-history.json');

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

async function main() {
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

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
