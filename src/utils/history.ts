/**
 * Download History — client-side utility for recording and querying download history.
 *
 * Uses the server-side /api/history endpoints when available (self-hosted/Docker),
 * falls back to localStorage for static deployments (Vercel).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HistoryTrackEntry {
  saavnId: string;
  title: string;
  artist: string;
  albumTitle: string;
  albumArtist: string;
  duration: string;
  playCount: string;
  year: string;
  language: string;
  trackNumber: number;
  filePath?: string;
  isExplicit: boolean;
  image: string;
}

export interface HistoryEntry {
  id: string;
  saavnId: string;
  type: 'track' | 'album';
  title: string;
  artist: string;
  album: string;
  image: string;
  quality: string;
  mode: string;
  songCount: number;
  downloadedAt: string;
  // Extended fields for richer history
  duration?: string;
  playCount?: string;
  year?: string;
  language?: string;
  isExplicit?: boolean;
  filePath?: string;
  // Per-track data for album entries (sent on POST, not returned on GET list)
  tracks?: HistoryTrackEntry[];
}

export interface DownloadedIds {
  tracks: string[];
  albums: string[];
}

// ─── Storage detection ────────────────────────────────────────────────────────

let _serverAvailable: boolean | null = null;

async function isServerAvailable(): Promise<boolean> {
  if (_serverAvailable !== null) return _serverAvailable;

  try {
    const resp = await fetch('/api/config');
    if (resp.ok) {
      const data = await resp.json();
      _serverAvailable = data.historyEnabled === true;
    } else {
      _serverAvailable = false;
    }
  } catch {
    _serverAvailable = false;
  }
  return _serverAvailable;
}

// ─── localStorage fallback ────────────────────────────────────────────────────

const LS_KEY = 'saavn-dl-history';

function lsRead(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function lsWrite(entries: HistoryEntry[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(entries));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record a completed download in history.
 */
export async function recordDownload(entry: Omit<HistoryEntry, 'id' | 'downloadedAt'>): Promise<void> {
  const useServer = await isServerAvailable();

  if (useServer) {
    try {
      await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      return;
    } catch {
      // Fall through to localStorage
    }
  }

  // localStorage fallback
  const entries = lsRead();
  const existingIdx = entries.findIndex(
    (e) => e.saavnId === entry.saavnId && e.type === entry.type
  );

  const record: HistoryEntry = {
    ...entry,
    id: `${entry.type}-${entry.saavnId}-${Date.now()}`,
    downloadedAt: new Date().toISOString(),
  };

  if (existingIdx !== -1) {
    entries[existingIdx] = record;
  } else {
    entries.unshift(record);
  }

  lsWrite(entries);
}

export interface HistoryResponse {
  entries: HistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface HistoryQueryParams {
  type?: 'track' | 'album';
  limit?: number;
  offset?: number;
  search?: string;
}

/**
 * Get history entries with pagination and optional search.
 */
export async function getHistory(params: HistoryQueryParams = {}): Promise<HistoryResponse> {
  const { type, limit = 20, offset = 0, search } = params;
  const useServer = await isServerAvailable();

  if (useServer) {
    try {
      const qp = new URLSearchParams();
      if (type) qp.set('type', type);
      qp.set('limit', String(limit));
      qp.set('offset', String(offset));
      if (search) qp.set('search', search);
      const resp = await fetch(`/api/history?${qp.toString()}`);
      if (resp.ok) {
        const data = await resp.json();
        return {
          entries: data.entries || [],
          total: data.total ?? (data.entries?.length || 0),
          limit: data.limit ?? limit,
          offset: data.offset ?? offset,
        };
      }
    } catch {
      // Fall through to localStorage
    }
  }

  // localStorage fallback — client-side filtering/pagination
  let entries = lsRead();
  if (type) entries = entries.filter((e) => e.type === type);
  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter(
      (e) => e.title.toLowerCase().includes(q) || e.artist.toLowerCase().includes(q)
    );
  }
  const total = entries.length;
  const sliced = entries.slice(offset, offset + limit);
  return { entries: sliced, total, limit, offset };
}

/**
 * Get downloaded IDs for fast "already downloaded" badge checks.
 * Returns a set-like object with track and album saavnIds.
 */
export async function getDownloadedIds(): Promise<DownloadedIds> {
  const useServer = await isServerAvailable();

  if (useServer) {
    try {
      const resp = await fetch('/api/history/ids');
      if (resp.ok) {
        return await resp.json();
      }
    } catch {
      // Fall through to localStorage
    }
  }

  const entries = lsRead();
  const tracks: string[] = [];
  const albums: string[] = [];

  for (const entry of entries) {
    if (entry.type === 'track') tracks.push(entry.saavnId);
    else if (entry.type === 'album') albums.push(entry.saavnId);
  }

  return { tracks: [...new Set(tracks)], albums: [...new Set(albums)] };
}

/**
 * Remove a specific history entry.
 */
export async function removeFromHistory(id: string): Promise<void> {
  const useServer = await isServerAvailable();

  if (useServer) {
    try {
      await fetch(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return;
    } catch {
      // Fall through to localStorage
    }
  }

  const entries = lsRead();
  lsWrite(entries.filter((e) => e.id !== id));
}

/**
 * Clear all download history.
 */
export async function clearAllHistory(): Promise<void> {
  const useServer = await isServerAvailable();

  if (useServer) {
    try {
      await fetch('/api/history', { method: 'DELETE' });
      return;
    } catch {
      // Fall through to localStorage
    }
  }

  lsWrite([]);
}
