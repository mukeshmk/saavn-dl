/**
 * Sync Scheduler — cron-based automatic sync execution.
 *
 * Uses node-cron to run sync on a configurable schedule.
 * Starts automatically on server boot if a schedule is configured.
 */

import cron from 'node-cron';
import { sync, readConfig } from './sync-manager.js';

let scheduledTask = null;
let currentExpression = '';
let nextRunTime = null;
let isRunning = false;

// ─── Scheduler control ────────────────────────────────────────────────────────

/**
 * Starts (or restarts) the scheduler with the given cron expression.
 * Returns true if started successfully, false if expression is invalid.
 */
export function startScheduler(cronExpression) {
  // Stop existing task if any
  stopScheduler();

  if (!cronExpression || !cronExpression.trim()) {
    return false;
  }

  // Validate cron expression
  if (!cron.validate(cronExpression)) {
    return false;
  }

  currentExpression = cronExpression;

  scheduledTask = cron.schedule(cronExpression, async () => {
    if (isRunning) {
      console.log('[sync-scheduler] Sync already in progress, skipping scheduled run');
      return;
    }

    console.log('[sync-scheduler] Running scheduled sync...');
    isRunning = true;

    try {
      const result = await sync();
      console.log(`[sync-scheduler] Sync complete: ${result.moved} moved, ${result.failed} failed, ${result.skipped} skipped`);
    } catch (err) {
      console.error('[sync-scheduler] Sync failed:', err.message);
    } finally {
      isRunning = false;
    }
  });

  console.log(`[sync-scheduler] Scheduler started with expression: ${cronExpression}`);
  return true;
}

/**
 * Stops the scheduler.
 */
export function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  currentExpression = '';
}

/**
 * Returns the scheduler status.
 */
export function getSchedulerStatus() {
  return {
    active: scheduledTask !== null,
    expression: currentExpression,
    isRunning,
  };
}

/**
 * Returns whether a sync is currently in progress (from scheduler).
 */
export function isSyncRunning() {
  return isRunning;
}

/**
 * Sets the running flag (used by manual sync trigger).
 */
export function setSyncRunning(value) {
  isRunning = value;
}

// ─── Auto-start on import ─────────────────────────────────────────────────────

/**
 * Initializes the scheduler from persisted config.
 * Call this on server startup.
 */
export async function initScheduler() {
  try {
    const config = await readConfig();
    if (config.schedule) {
      const started = startScheduler(config.schedule);
      if (started) {
        console.log(`[sync-scheduler] Auto-started with saved schedule: ${config.schedule}`);
      } else {
        console.warn(`[sync-scheduler] Saved schedule is invalid: ${config.schedule}`);
      }
    } else {
      console.log('[sync-scheduler] No schedule configured, scheduler inactive');
    }
  } catch (err) {
    console.error('[sync-scheduler] Failed to initialize scheduler:', err.message);
  }
}
