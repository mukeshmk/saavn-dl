/**
 * Sync Scheduler — cron-based automatic sync execution.
 *
 * Uses node-cron to run sync on a configurable schedule.
 * Starts automatically on server boot if a schedule is configured.
 */

import cron from 'node-cron';
import { sync, readConfig } from './sync-manager.js';
import { createLogger } from '../log.js';

const log = createLogger('sync-scheduler');

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
      log.info('sync already in progress, skipping scheduled run');
      return;
    }

    log.info('running scheduled sync...');
    isRunning = true;

    try {
      const result = await sync();
      log.info('scheduled sync complete: %d moved, %d failed, %d skipped', result.moved, result.failed, result.skipped);
    } catch (err) {
      log.error('scheduled sync failed:', err.message);
    } finally {
      isRunning = false;
    }
  });

  log.info('scheduler started with expression: %s', cronExpression);
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
export function initScheduler() {
  try {
    const config = readConfig();
    if (config.schedule) {
      const started = startScheduler(config.schedule);
      if (started) {
        log.info('auto-started with saved schedule: %s', config.schedule);
      } else {
        log.warn('saved schedule is invalid: %s', config.schedule);
      }
    } else {
      log.info('no schedule configured, scheduler inactive');
    }
  } catch (err) {
    log.error('failed to initialize scheduler:', err.message);
  }
}
