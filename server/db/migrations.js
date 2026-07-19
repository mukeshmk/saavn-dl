/**
 * Migrations — imports existing JSON data into SQLite on first run.
 *
 * Detects .saavn-dl-history.json and .saavn-dl-sync.json files,
 * reads their contents, and inserts into the appropriate SQLite tables.
 * Marks migration as complete via a sync_config entry so it only runs once.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { getDb } from './index.js';

const LIBRARY_PATH = process.env.SAAVN_LIBRARY_PATH || '';
const FALLBACK_DIR = resolve('./data');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getHistoryJsonPath() {
  if (LIBRARY_PATH) return join(LIBRARY_PATH, '.saavn-dl-history.json');
  return join(FALLBACK_DIR, '.saavn-dl-history.json');
}

function getSyncConfigJsonPath() {
  if (!LIBRARY_PATH) return null;
  return join(LIBRARY_PATH, '.saavn-dl-sync.json');
}

async function readJsonFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Migration ────────────────────────────────────────────────────────────────

/**
 * Run migrations if not already done.
 * Safe to call multiple times — uses a flag in sync_config to track completion.
 */
export async function runMigrations() {
  const db = getDb();

  // Check if migration already ran
  const migrated = db.prepare('SELECT value FROM sync_config WHERE key = ?').get('migration_complete');
  if (migrated) {
    return { migrated: false, reason: 'already_complete' };
  }

  console.log('[migrations] Starting data migration from JSON files...');

  let historyCount = 0;
  let syncConfigMigrated = false;
  let syncRunsMigrated = 0;
  let failedFilesMigrated = 0;

  // ── Migrate download history ──────────────────────────────────────────────

  const historyPath = getHistoryJsonPath();
  if (existsSync(historyPath)) {
    const data = await readJsonFile(historyPath);

    if (data && data.entries && Array.isArray(data.entries)) {
      const insertAlbum = db.prepare(`
        INSERT OR IGNORE INTO albums (id, saavn_id, title, artist, image, quality, mode, song_count, downloaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertTrack = db.prepare(`
        INSERT OR IGNORE INTO tracks (id, saavn_id, title, artist, album_title, image, quality, downloaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const migrateEntries = db.transaction((entries) => {
        for (const entry of entries) {
          if (entry.type === 'album') {
            insertAlbum.run(
              entry.id || `album-${entry.saavnId}-${Date.now()}`,
              entry.saavnId,
              entry.title || '',
              entry.artist || '',
              entry.image || '',
              entry.quality || '',
              entry.mode || '',
              entry.songCount || 0,
              entry.downloadedAt || new Date().toISOString()
            );
          } else {
            // Track entries from the old system
            insertTrack.run(
              entry.id || `track-${entry.saavnId}-${Date.now()}`,
              entry.saavnId,
              entry.title || '',
              entry.artist || '',
              entry.album || '',
              entry.image || '',
              entry.quality || '',
              entry.downloadedAt || new Date().toISOString()
            );
          }
          historyCount++;
        }
      });

      migrateEntries(data.entries);
      console.log(`[migrations] Migrated ${historyCount} history entries`);
    }
  } else {
    console.log('[migrations] No history JSON found, skipping history migration');
  }

  // ── Migrate sync config ───────────────────────────────────────────────────

  const syncConfigPath = getSyncConfigJsonPath();
  if (syncConfigPath && existsSync(syncConfigPath)) {
    const data = await readJsonFile(syncConfigPath);

    if (data) {
      const upsertConfig = db.prepare(`
        INSERT OR REPLACE INTO sync_config (key, value) VALUES (?, ?)
      `);

      const insertRun = db.prepare(`
        INSERT INTO sync_runs (timestamp, moved, failed, skipped, errors)
        VALUES (?, ?, ?, ?, ?)
      `);

      const insertFailedFile = db.prepare(`
        INSERT OR REPLACE INTO sync_failed_files (relative_path, retry_count, last_error, last_attempt)
        VALUES (?, ?, ?, ?)
      `);

      const migrateSyncData = db.transaction((config) => {
        // Config values
        if (config.schedule) upsertConfig.run('schedule', config.schedule);
        if (config.retryLimit) upsertConfig.run('retry_limit', String(config.retryLimit));
        if (config.lastSyncTime) upsertConfig.run('last_sync_time', config.lastSyncTime);
        syncConfigMigrated = true;

        // Sync run history
        if (config.history && Array.isArray(config.history)) {
          for (const run of config.history) {
            insertRun.run(
              run.timestamp || new Date().toISOString(),
              run.moved || 0,
              run.failed || 0,
              run.skipped || 0,
              JSON.stringify(run.errors || [])
            );
            syncRunsMigrated++;
          }
        }

        // Failed files
        if (config.failedFiles && typeof config.failedFiles === 'object') {
          for (const [relPath, info] of Object.entries(config.failedFiles)) {
            insertFailedFile.run(
              relPath,
              info.retryCount || 0,
              info.lastError || '',
              info.lastAttempt || new Date().toISOString()
            );
            failedFilesMigrated++;
          }
        }
      });

      migrateSyncData(data);
      console.log(`[migrations] Migrated sync config, ${syncRunsMigrated} sync runs, ${failedFilesMigrated} failed files`);
    }
  } else {
    console.log('[migrations] No sync config JSON found, skipping sync migration');
  }

  // ── Mark migration complete ───────────────────────────────────────────────

  db.prepare('INSERT OR REPLACE INTO sync_config (key, value) VALUES (?, ?)').run(
    'migration_complete',
    new Date().toISOString()
  );

  const result = {
    migrated: true,
    historyEntries: historyCount,
    syncConfigMigrated,
    syncRuns: syncRunsMigrated,
    failedFiles: failedFilesMigrated,
  };

  console.log('[migrations] Migration complete:', result);
  return result;
}
