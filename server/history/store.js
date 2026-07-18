/**
 * History Store — persists download history to a JSON file.
 *
 * Storage location: SAAVN_LIBRARY_PATH/.saavn-dl-history.json
 * Falls back to ./data/.saavn-dl-history.json if SAAVN_LIBRARY_PATH is not set.
 *
 * Each entry records a completed track or album download with metadata
 * for display and deduplication (by saavnId + type).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

// ─── Paths ────────────────────────────────────────────────────────────────────

const LIBRARY_PATH = process.env.SAAVN_LIBRARY_PATH || '';
const HISTORY_FILENAME = '.saavn-dl-history.json';
const FALLBACK_DIR = resolve('./data');

function getHistoryPath() {
  if (LIBRARY_PATH) return join(LIBRARY_PATH, HISTORY_FILENAME);
  return join(FALLBACK_DIR, HISTORY_FILENAME);
}

// ─── Default state ────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  entries: [], // Array of HistoryEntry
};

// ─── Read / Write ─────────────────────────────────────────────────────────────

export async function readHistory() {
  const historyPath = getHistoryPath();
  try {
    const raw = await readFile(historyPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function writeHistory(state) {
  const historyPath = getHistoryPath();
  const dir = historyPath.replace(/[/\\][^/\\]+$/, '');

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(historyPath, JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a download entry to history.
 * Deduplicates by saavnId + type — if already exists, updates the timestamp.
 */
export async function addEntry(entry) {
  const state = await readHistory();

  // Deduplicate: same saavnId + type means re-download
  const existingIdx = state.entries.findIndex(
    (e) => e.saavnId === entry.saavnId && e.type === entry.type
  );

  const record = {
    id: entry.id || `${entry.type}-${entry.saavnId}-${Date.now()}`,
    saavnId: entry.saavnId,
    type: entry.type, // 'track' | 'album'
    title: entry.title,
    artist: entry.artist,
    album: entry.album || '',
    image: entry.image || '',
    quality: entry.quality || '',
    mode: entry.mode || '', // download mode (individual, zip, library) for albums
    songCount: entry.songCount || 0, // number of tracks for albums
    downloadedAt: new Date().toISOString(),
  };

  if (existingIdx !== -1) {
    // Update existing entry with new timestamp and metadata
    state.entries[existingIdx] = { ...state.entries[existingIdx], ...record };
  } else {
    // Add new entry at the beginning (most recent first)
    state.entries.unshift(record);
  }

  await writeHistory(state);
  return record;
}

/**
 * Get all history entries, optionally filtered by type.
 */
export async function getEntries(type) {
  const state = await readHistory();
  if (type) {
    return state.entries.filter((e) => e.type === type);
  }
  return state.entries;
}

/**
 * Get a set of saavnIds that have been downloaded (for quick "already downloaded" checks).
 * Returns { tracks: Set<string>, albums: Set<string> }
 */
export async function getDownloadedIds() {
  const state = await readHistory();
  const tracks = new Set();
  const albums = new Set();

  for (const entry of state.entries) {
    if (entry.type === 'track') tracks.add(entry.saavnId);
    else if (entry.type === 'album') albums.add(entry.saavnId);
  }

  return { tracks: [...tracks], albums: [...albums] };
}

/**
 * Remove a specific entry by its id.
 */
export async function removeEntry(id) {
  const state = await readHistory();
  state.entries = state.entries.filter((e) => e.id !== id);
  await writeHistory(state);
}

/**
 * Clear all history.
 */
export async function clearHistory() {
  await writeHistory({ ...DEFAULT_STATE });
}
