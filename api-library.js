/**
 * API Library Routes — HTTP handler for /api/library/* endpoints.
 *
 * Endpoints:
 *   GET  /api/library/browse?path=      → directory listing
 *   POST /api/library/sync              → triggers immediate sync
 *   GET  /api/library/sync/status       → sync status + scheduler state
 *   GET  /api/library/sync/config       → current config
 *   POST /api/library/sync/config       → update config (schedule, retryLimit)
 *   POST /api/library/sync/reset-retries → reset retry count for file(s)
 */

import { browse, sync, readConfig, updateConfig, getStatus, resetRetries, MUSIC_PATH } from './sync-manager.js';
import { startScheduler, stopScheduler, getSchedulerStatus, isSyncRunning, setSyncRunning } from './sync-scheduler.js';
import cron from 'node-cron';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * Handles /api/library/* requests.
 * Returns true if the request was handled, false otherwise.
 */
export async function handleLibraryRoute(req, res, url, jsonResponse) {
  const pathname = url.pathname;

  // GET /api/library/browse?path=
  if (pathname === '/api/library/browse' && req.method === 'GET') {
    try {
      const relativePath = url.searchParams.get('path') || '';
      const result = await browse(relativePath);
      return jsonResponse(res, 200, result);
    } catch (err) {
      const status = err.message.includes('traversal') ? 403 : 500;
      return jsonResponse(res, status, { error: err.message });
    }
  }

  // POST /api/library/sync
  if (pathname === '/api/library/sync' && req.method === 'POST') {
    if (isSyncRunning()) {
      return jsonResponse(res, 409, { error: 'Sync is already in progress' });
    }

    setSyncRunning(true);
    try {
      const result = await sync();
      return jsonResponse(res, 200, result);
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    } finally {
      setSyncRunning(false);
    }
  }

  // GET /api/library/sync/status
  if (pathname === '/api/library/sync/status' && req.method === 'GET') {
    try {
      const status = await getStatus();
      const scheduler = getSchedulerStatus();
      return jsonResponse(res, 200, { ...status, scheduler });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // GET /api/library/sync/config
  if (pathname === '/api/library/sync/config' && req.method === 'GET') {
    try {
      const config = await readConfig();
      return jsonResponse(res, 200, {
        schedule: config.schedule,
        retryLimit: config.retryLimit,
        enabled: !!MUSIC_PATH,
      });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // POST /api/library/sync/config
  if (pathname === '/api/library/sync/config' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const updates = {};

      // Validate and apply schedule
      if ('schedule' in body) {
        if (body.schedule && !cron.validate(body.schedule)) {
          return jsonResponse(res, 400, { error: 'Invalid cron expression' });
        }
        updates.schedule = body.schedule || '';
      }

      // Validate and apply retry limit
      if ('retryLimit' in body) {
        const limit = parseInt(body.retryLimit, 10);
        if (isNaN(limit) || limit < 1 || limit > 100) {
          return jsonResponse(res, 400, { error: 'retryLimit must be between 1 and 100' });
        }
        updates.retryLimit = limit;
      }

      const config = await updateConfig(updates);

      // Restart scheduler if schedule changed
      if ('schedule' in updates) {
        if (updates.schedule) {
          startScheduler(updates.schedule);
        } else {
          stopScheduler();
        }
      }

      return jsonResponse(res, 200, {
        schedule: config.schedule,
        retryLimit: config.retryLimit,
        enabled: !!MUSIC_PATH,
      });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // POST /api/library/sync/reset-retries
  if (pathname === '/api/library/sync/reset-retries' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      await resetRetries(body.path || null);
      return jsonResponse(res, 200, { success: true });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // Not handled
  return false;
}
