/**
 * Sync Manager — config persistence, directory browsing, and file move logic.
 *
 * Manages synchronization of files from SAAVN_LIBRARY_PATH (fast SSD staging)
 * to SAAVN_MUSIC_PATH (permanent NAS storage).
 */

import { readdir, stat, readFile, writeFile, mkdir, rename, copyFile, unlink, rm } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';

// ─── Paths ────────────────────────────────────────────────────────────────────

const LIBRARY_PATH = process.env.SAAVN_LIBRARY_PATH || '';
const MUSIC_PATH = process.env.SAAVN_MUSIC_PATH || '';
const CONFIG_FILENAME = '.saavn-dl-sync.json';
const HISTORY_FILENAME = '.saavn-dl-history.json';

// Files to skip during browse and sync
const SKIP_FILES = new Set([CONFIG_FILENAME, HISTORY_FILENAME]);

// ─── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  schedule: '', // cron expression, empty = disabled
  retryLimit: 3,
  lastSyncTime: null,
  history: [], // last 20 sync results
  failedFiles: {}, // { relativePath: { retryCount, lastError, lastAttempt } }
};

// ─── Config persistence ───────────────────────────────────────────────────────

function getConfigPath() {
  if (!LIBRARY_PATH) return null;
  return join(LIBRARY_PATH, CONFIG_FILENAME);
}

export async function readConfig() {
  const configPath = getConfigPath();
  if (!configPath) return { ...DEFAULT_CONFIG };

  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    // File doesn't exist or is invalid — return defaults
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeConfig(config) {
  const configPath = getConfigPath();
  if (!configPath) throw new Error('SAAVN_LIBRARY_PATH is not configured');

  // Ensure library path exists
  if (!existsSync(LIBRARY_PATH)) {
    await mkdir(LIBRARY_PATH, { recursive: true });
  }

  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function updateConfig(partial) {
  const config = await readConfig();
  const updated = { ...config, ...partial };
  await writeConfig(updated);
  return updated;
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

/**
 * Runs a full sync: walks SAAVN_LIBRARY_PATH, moves files to SAAVN_MUSIC_PATH,
 * preserving folder structure. Respects retry limits.
 *
 * Returns a sync result object.
 */
export async function sync() {
  if (!LIBRARY_PATH) throw new Error('SAAVN_LIBRARY_PATH is not configured');
  if (!MUSIC_PATH) throw new Error('SAAVN_MUSIC_PATH is not configured');

  const config = await readConfig();
  const { retryLimit, failedFiles } = config;

  // Walk all files in library
  const allFiles = await walkDir(LIBRARY_PATH, LIBRARY_PATH);

  let moved = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];
  const updatedFailedFiles = { ...failedFiles };

  for (const relPath of allFiles) {
    // Check if file has exceeded retry limit
    const fileRecord = updatedFailedFiles[relPath];
    if (fileRecord && fileRecord.retryCount >= retryLimit) {
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
      if (updatedFailedFiles[relPath]) {
        delete updatedFailedFiles[relPath];
      }
    } catch (err) {
      failed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push({ file: relPath, error: errMsg });

      // Update retry count
      const existing = updatedFailedFiles[relPath] || { retryCount: 0 };
      updatedFailedFiles[relPath] = {
        retryCount: existing.retryCount + 1,
        lastError: errMsg,
        lastAttempt: new Date().toISOString(),
      };
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

  // Update config
  const history = [result, ...(config.history || [])].slice(0, 20);
  await writeConfig({
    ...config,
    lastSyncTime: result.timestamp,
    history,
    failedFiles: updatedFailedFiles,
  });

  return result;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

/**
 * Returns current sync status info.
 */
export async function getStatus() {
  const config = await readConfig();
  const { lastSyncTime, history, failedFiles, schedule, retryLimit } = config;

  // Count pending files (files in library not yet at retry limit)
  let pendingCount = 0;
  let needsAttentionCount = 0;

  try {
    const allFiles = await walkDir(LIBRARY_PATH, LIBRARY_PATH);
    for (const relPath of allFiles) {
      const record = failedFiles[relPath];
      if (record && record.retryCount >= retryLimit) {
        needsAttentionCount++;
      } else {
        pendingCount++;
      }
    }
  } catch {
    // Library path may not exist yet
  }

  return {
    lastSyncTime,
    schedule,
    retryLimit,
    pendingCount,
    needsAttentionCount,
    lastResult: history[0] || null,
    failedFiles: Object.entries(failedFiles)
      .filter(([_, v]) => v.retryCount >= retryLimit)
      .map(([path, info]) => ({ path, ...info })),
  };
}

/**
 * Resets the retry count for a specific file or all failed files.
 */
export async function resetRetries(relativePath) {
  const config = await readConfig();

  if (relativePath) {
    delete config.failedFiles[relativePath];
  } else {
    config.failedFiles = {};
  }

  await writeConfig(config);
}

export { LIBRARY_PATH, MUSIC_PATH };
