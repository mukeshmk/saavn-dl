/**
 * Sync Manager — config persistence, directory browsing, and file move logic.
 *
 * Manages synchronization of files from SAAVN_LIBRARY_PATH (fast SSD staging)
 * to SAAVN_MUSIC_PATH (permanent NAS storage).
 *
 * Config and sync history are persisted in SQLite (via server/db).
 */

import { readdir, stat, mkdir, rename, copyFile, unlink, rm } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { getDb } from '../db/index.js';
import { generateAllM3U8 } from '../playlists/store.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const LIBRARY_PATH = process.env.SAAVN_LIBRARY_PATH || '';
const MUSIC_PATH = process.env.SAAVN_MUSIC_PATH || '';

// Files to skip during browse and sync
const SKIP_FILES = new Set(['.saavn-dl-sync.json', '.saavn-dl-history.json']);

// ─── Config persistence (SQLite key/value) ────────────────────────────────────

const DEFAULT_CONFIG = {
  schedule: '',
  retryLimit: 3,
  lastSyncTime: null,
};

export function readConfig() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM sync_config').all();

  const config = { ...DEFAULT_CONFIG };
  for (const row of rows) {
    if (row.key === 'schedule') config.schedule = row.value;
    if (row.key === 'retry_limit') config.retryLimit = parseInt(row.value, 10) || 3;
    if (row.key === 'last_sync_time') config.lastSyncTime = row.value || null;
  }

  return config;
}

export function writeConfig(partial) {
  const db = getDb();
  const upsert = db.prepare('INSERT OR REPLACE INTO sync_config (key, value) VALUES (?, ?)');

  const update = db.transaction((data) => {
    if ('schedule' in data) upsert.run('schedule', data.schedule || '');
    if ('retryLimit' in data) upsert.run('retry_limit', String(data.retryLimit));
    if ('lastSyncTime' in data) upsert.run('last_sync_time', data.lastSyncTime || '');
  });

  update(partial);
}

export function updateConfig(partial) {
  writeConfig(partial);
  return readConfig();
}

// ─── Directory browsing ───────────────────────────────────────────────────────

/**
 * Lists directory entries at a given relative path under SAAVN_LIBRARY_PATH.
 * Returns folders first, then files, each with name/size/modifiedDate/type.
 */
export async function browse(relativePath = '') {
  if (!LIBRARY_PATH) throw new Error('SAAVN_LIBRARY_PATH is not configured');

  const targetPath = resolve(LIBRARY_PATH, relativePath);
  const resolvedBase = resolve(LIBRARY_PATH);

  // Path traversal protection
  if (!targetPath.startsWith(resolvedBase)) {
    throw new Error('Invalid path — traversal attempt detected');
  }

  if (!existsSync(targetPath)) {
    return { path: relativePath, entries: [] };
  }

  const dirEntries = await readdir(targetPath, { withFileTypes: true });
  const entries = [];

  for (const entry of dirEntries) {
    // Skip internal metadata files
    if (SKIP_FILES.has(entry.name)) continue;

    const entryPath = join(targetPath, entry.name);
    const entryStat = await stat(entryPath);

    if (entry.isDirectory()) {
      // Count files and total size within the directory (non-recursive for perf)
      const subEntries = await readdir(entryPath, { withFileTypes: true });
      const fileCount = subEntries.filter(e => e.isFile()).length;

      entries.push({
        name: entry.name,
        type: 'directory',
        fileCount,
        modifiedDate: entryStat.mtime.toISOString(),
      });
    } else if (entry.isFile()) {
      entries.push({
        name: entry.name,
        type: 'file',
        size: entryStat.size,
        modifiedDate: entryStat.mtime.toISOString(),
      });
    }
  }

  // Sort: directories first (alpha), then files (alpha)
  entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return { path: relativePath, entries };
}

// ─── File sync logic ──────────────────────────────────────────────────────────

/**
 * Moves a single file from source to destination.
 * Tries fs.rename first (same-device), falls back to copy+delete (cross-device).
 */
async function moveFile(src, dest) {
  try {
    await rename(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Cross-device: copy then delete
      await copyFile(src, dest);
      await unlink(src);
    } else {
      throw err;
    }
  }
}

/**
 * Recursively collects all file paths under a directory (relative to basePath).
 */
async function walkDir(dirPath, basePath, files = []) {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await walkDir(fullPath, basePath, files);
    } else if (entry.isFile()) {
      // Skip internal metadata files
      if (SKIP_FILES.has(entry.name)) continue;
      files.push(relative(basePath, fullPath));
    }
  }

  return files;
}

/**
 * Removes empty directories recursively (bottom-up) from the given path.
 */
async function removeEmptyDirs(dirPath, basePath) {
  const resolvedBase = resolve(basePath);
  const resolvedDir = resolve(dirPath);

  // Don't remove the base directory itself
  if (resolvedDir === resolvedBase) return;

  try {
    const entries = await readdir(dirPath);
    // Filter out internal metadata files when checking if directory is "empty"
    const realEntries = entries.filter(e => !SKIP_FILES.has(e));
    if (realEntries.length === 0) {
      await rm(dirPath, { recursive: true });
      // Try parent
      const parent = resolve(dirPath, '..');
      if (parent.startsWith(resolvedBase) && parent !== resolvedBase) {
        await removeEmptyDirs(parent, basePath);
      }
    }
  } catch {
    // Directory may already be gone, that's fine
  }
}

// ─── Failed files (SQLite) ────────────────────────────────────────────────────

function getFailedFile(relPath) {
  const db = getDb();
  return db.prepare('SELECT retry_count, last_error, last_attempt FROM sync_failed_files WHERE relative_path = ?').get(relPath);
}

function upsertFailedFile(relPath, retryCount, lastError) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO sync_failed_files (relative_path, retry_count, last_error, last_attempt)
    VALUES (?, ?, ?, datetime('now'))
  `).run(relPath, retryCount, lastError);
}

function removeFailedFile(relPath) {
  const db = getDb();
  db.prepare('DELETE FROM sync_failed_files WHERE relative_path = ?').run(relPath);
}

function getAllFailedFiles() {
  const db = getDb();
  return db.prepare('SELECT relative_path, retry_count, last_error, last_attempt FROM sync_failed_files').all();
}

// ─── Sync run history (SQLite) ────────────────────────────────────────────────

function recordSyncRun(result) {
  const db = getDb();
  db.prepare(`
    INSERT INTO sync_runs (timestamp, moved, failed, skipped, errors)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    result.timestamp,
    result.moved,
    result.failed,
    result.skipped,
    JSON.stringify(result.errors || [])
  );

  // Keep only the last 20 runs
  db.prepare(`
    DELETE FROM sync_runs WHERE id NOT IN (
      SELECT id FROM sync_runs ORDER BY timestamp DESC LIMIT 20
    )
  `).run();
}

function getRecentSyncRuns(limit = 20) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM sync_runs ORDER BY timestamp DESC LIMIT ?').all(limit);
  return rows.map((r) => ({
    timestamp: r.timestamp,
    moved: r.moved,
    failed: r.failed,
    skipped: r.skipped,
    errors: JSON.parse(r.errors || '[]'),
  }));
}

// ─── Main sync ────────────────────────────────────────────────────────────────

/**
 * Runs a full sync: walks SAAVN_LIBRARY_PATH, moves files to SAAVN_MUSIC_PATH,
 * preserving folder structure. Respects retry limits.
 *
 * Returns a sync result object.
 */
export async function sync() {
  if (!LIBRARY_PATH) throw new Error('SAAVN_LIBRARY_PATH is not configured');
  if (!MUSIC_PATH) throw new Error('SAAVN_MUSIC_PATH is not configured');

  const config = readConfig();
  const { retryLimit } = config;

  // Walk all files in library
  const allFiles = await walkDir(LIBRARY_PATH, LIBRARY_PATH);

  let moved = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];

  for (const relPath of allFiles) {
    // Check if file has exceeded retry limit
    const fileRecord = getFailedFile(relPath);
    if (fileRecord && fileRecord.retry_count >= retryLimit) {
      skipped++;
      continue;
    }

    const srcPath = join(LIBRARY_PATH, relPath);
    const destPath = join(MUSIC_PATH, relPath);

    try {
      // Ensure destination directory exists
      const destDir = resolve(destPath, '..');
      await mkdir(destDir, { recursive: true });

      await moveFile(srcPath, destPath);
      moved++;

      // Clear any previous failure record on success
      removeFailedFile(relPath);
    } catch (err) {
      failed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push({ file: relPath, error: errMsg });

      // Update retry count
      const existing = getFailedFile(relPath);
      const newCount = (existing ? existing.retry_count : 0) + 1;
      upsertFailedFile(relPath, newCount, errMsg);
    }
  }

  // Clean up empty directories in source
  for (const relPath of allFiles) {
    const srcDir = resolve(join(LIBRARY_PATH, relPath), '..');
    await removeEmptyDirs(srcDir, LIBRARY_PATH);
  }

  // Build result
  const result = {
    timestamp: new Date().toISOString(),
    moved,
    failed,
    skipped,
    errors: errors.slice(0, 20), // Cap error list
  };

  // Persist sync run and update last sync time
  recordSyncRun(result);
  writeConfig({ lastSyncTime: result.timestamp });

  // Auto-export playlists as .m3u8 to MUSIC_PATH/Playlists/
  try {
    const allM3U8 = generateAllM3U8(MUSIC_PATH);
    if (allM3U8.length > 0) {
      const { writeFile } = await import('node:fs/promises');
      const playlistsDir = join(MUSIC_PATH, 'Playlists');
      if (!existsSync(playlistsDir)) {
        await mkdir(playlistsDir, { recursive: true });
      }
      for (const m3u8 of allM3U8) {
        const safeName = m3u8.name.replace(/[\/\\:*?"<>|]/g, '_').trim().slice(0, 200);
        const filePath = join(playlistsDir, `${safeName}.m3u`);
        await writeFile(filePath, m3u8.content, 'utf-8');
      }
      console.log(`[sync] Exported ${allM3U8.length} playlist(s) to ${playlistsDir}`);
    }
  } catch (err) {
    console.warn('[sync] Playlist export failed:', err.message);
  }

  return result;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

/**
 * Returns current sync status info.
 */
export async function getStatus() {
  const config = readConfig();
  const { lastSyncTime, schedule, retryLimit } = config;

  // Count pending files (files in library not yet at retry limit)
  let pendingCount = 0;
  let needsAttentionCount = 0;

  try {
    const allFiles = await walkDir(LIBRARY_PATH, LIBRARY_PATH);
    const failedFiles = getAllFailedFiles();
    const failedMap = new Map(failedFiles.map((f) => [f.relative_path, f]));

    for (const relPath of allFiles) {
      const record = failedMap.get(relPath);
      if (record && record.retry_count >= retryLimit) {
        needsAttentionCount++;
      } else {
        pendingCount++;
      }
    }
  } catch {
    // Library path may not exist yet
  }

  const history = getRecentSyncRuns(20);
  const failedFiles = getAllFailedFiles()
    .filter((f) => f.retry_count >= retryLimit)
    .map((f) => ({
      path: f.relative_path,
      retryCount: f.retry_count,
      lastError: f.last_error,
      lastAttempt: f.last_attempt,
    }));

  return {
    lastSyncTime,
    schedule,
    retryLimit,
    pendingCount,
    needsAttentionCount,
    lastResult: history[0] || null,
    failedFiles,
  };
}

/**
 * Resets the retry count for a specific file or all failed files.
 */
export function resetRetries(relativePath) {
  const db = getDb();

  if (relativePath) {
    db.prepare('DELETE FROM sync_failed_files WHERE relative_path = ?').run(relativePath);
  } else {
    db.prepare('DELETE FROM sync_failed_files').run();
  }
}

export { LIBRARY_PATH, MUSIC_PATH };
