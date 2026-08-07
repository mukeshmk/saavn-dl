/**
 * History recording bridge for server-side jobs.
 *
 * Thin, best-effort wrappers over server/history/store.js so a history write can never
 * fail a download job. The field mapping mirrors what the client records today (see
 * src/utils/history.ts usage in albumDownload.ts / downloadQueue.ts) so existing history
 * views and "already downloaded" badges keep working.
 */

import { addEntry } from '../history/store.js';
import { createLogger } from '../log.js';

const log = createLogger('downloads/recorder');

/** Record a standalone track (mirrors client recordDownload({ type: 'track', ... })). */
export function recordTrack(entry) {
  try {
    addEntry({ type: 'track', ...entry });
    log.debug('recorded track history: "%s"', entry?.title || entry?.saavnId || '—');
  } catch (err) {
    log.warn('track history write failed:', err.message);
  }
}

/**
 * Record an album/playlist-level entry with per-track rows
 * (mirrors client downloadQueue.recordToHistory album branch).
 */
export function recordAlbum(entry) {
  try {
    addEntry({ type: 'album', ...entry });
    log.debug('recorded album history: "%s" (%d tracks)', entry?.title || entry?.saavnId || '—', entry?.tracks?.length || 0);
  } catch (err) {
    log.warn('album history write failed:', err.message);
  }
}
