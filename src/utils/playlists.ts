/**
 * Playlists — client-side utility for managing playlists via /api/playlists endpoints.
 *
 * Only available when the server is running (self-hosted/Docker).
 * Playlist export writes .m3u8 files compatible with Navidrome.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutoCriteriaRule {
  field: 'year' | 'language' | 'playCount' | 'artist' | 'albumTitle' | 'albumArtist' | 'duration' | 'title' | 'quality' | 'isExplicit';
  op: 'eq' | 'gte' | 'lte' | 'contains';
  value: string | number;
}

export interface AutoCriteria {
  rules: AutoCriteriaRule[];
  sort: 'playCount' | 'year' | 'downloadedAt' | 'title' | 'artist' | 'duration';
  sortOrder: 'asc' | 'desc';
  limit: number;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  autoGenerate: boolean;
  autoCriteria: AutoCriteria | null;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistTrack {
  id: string;
  saavnId: string;
  title: string;
  artist: string;
  albumTitle: string;
  albumArtist: string;
  image: string;
  quality: string;
  duration: number;
  playCount: number;
  year: string;
  language: string;
  trackNumber: number;
  filePath: string;
  isExplicit: boolean;
  downloadedAt: string;
  position: number;
  addedAt: string;
}

export interface TrackSearchResult {
  id: string;
  saavnId: string;
  title: string;
  artist: string;
  albumTitle: string;
  image: string;
  quality: string;
  duration: number;
  playCount: number;
  year: string;
  language: string;
  filePath: string;
  isExplicit: boolean;
  downloadedAt?: string;
}

export interface ExportResult {
  filename: string;
  path: string;
  trackCount: number;
}

export interface BackfillResult {
  matched: number;
  unmatched: number;
  total: number;
}

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * List all playlists.
 */
export async function listPlaylists(): Promise<Playlist[]> {
  const resp = await fetch('/api/playlists');
  if (!resp.ok) throw new Error(`Failed to list playlists: ${resp.status}`);
  const data = await resp.json();
  return data.playlists;
}

/**
 * Get a single playlist by ID.
 */
export async function getPlaylist(id: string): Promise<Playlist> {
  const resp = await fetch(`/api/playlists/${encodeURIComponent(id)}`);
  if (!resp.ok) throw new Error(`Failed to get playlist: ${resp.status}`);
  const data = await resp.json();
  return data.playlist;
}

/**
 * Create a new playlist.
 */
export async function createPlaylist(opts: {
  name: string;
  description?: string;
  autoGenerate?: boolean;
  autoCriteria?: AutoCriteria;
}): Promise<Playlist> {
  const resp = await fetch('/api/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to create playlist: ${resp.status}`);
  }
  const data = await resp.json();
  return data.playlist;
}

/**
 * Update a playlist's name, description, or auto criteria.
 */
export async function updatePlaylist(id: string, opts: {
  name?: string;
  description?: string;
  autoCriteria?: AutoCriteria;
}): Promise<Playlist> {
  const resp = await fetch(`/api/playlists/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!resp.ok) throw new Error(`Failed to update playlist: ${resp.status}`);
  const data = await resp.json();
  return data.playlist;
}

/**
 * Delete a playlist.
 */
export async function deletePlaylist(id: string): Promise<void> {
  const resp = await fetch(`/api/playlists/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!resp.ok) throw new Error(`Failed to delete playlist: ${resp.status}`);
}

/**
 * Get tracks in a playlist (ordered).
 */
export async function getPlaylistTracks(id: string): Promise<PlaylistTrack[]> {
  const resp = await fetch(`/api/playlists/${encodeURIComponent(id)}/tracks`);
  if (!resp.ok) throw new Error(`Failed to get playlist tracks: ${resp.status}`);
  const data = await resp.json();
  return data.tracks;
}

/**
 * Add tracks to a playlist by saavnId.
 */
export async function addTracksToPlaylist(id: string, saavnIds: string[]): Promise<PlaylistTrack[]> {
  const resp = await fetch(`/api/playlists/${encodeURIComponent(id)}/tracks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ saavnIds }),
  });
  if (!resp.ok) throw new Error(`Failed to add tracks: ${resp.status}`);
  const data = await resp.json();
  return data.tracks;
}

/**
 * Remove tracks from a playlist by track IDs.
 */
export async function removeTracksFromPlaylist(id: string, trackIds: string[]): Promise<PlaylistTrack[]> {
  const resp = await fetch(`/api/playlists/${encodeURIComponent(id)}/tracks`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackIds }),
  });
  if (!resp.ok) throw new Error(`Failed to remove tracks: ${resp.status}`);
  const data = await resp.json();
  return data.tracks;
}

/**
 * Reorder tracks in a playlist.
 */
export async function reorderPlaylistTracks(id: string, trackIds: string[]): Promise<PlaylistTrack[]> {
  const resp = await fetch(`/api/playlists/${encodeURIComponent(id)}/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackIds }),
  });
  if (!resp.ok) throw new Error(`Failed to reorder tracks: ${resp.status}`);
  const data = await resp.json();
  return data.tracks;
}

/**
 * Regenerate an auto-generated playlist (re-runs its criteria).
 */
export async function regeneratePlaylist(id: string): Promise<PlaylistTrack[]> {
  const resp = await fetch(`/api/playlists/${encodeURIComponent(id)}/regenerate`, {
    method: 'POST',
  });
  if (!resp.ok) throw new Error(`Failed to regenerate playlist: ${resp.status}`);
  const data = await resp.json();
  return data.tracks;
}

/**
 * Preview what tracks would match given auto-generate criteria.
 */
export async function previewAutoCriteria(criteria: AutoCriteria): Promise<TrackSearchResult[]> {
  const resp = await fetch('/api/playlists/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ criteria }),
  });
  if (!resp.ok) throw new Error(`Failed to preview criteria: ${resp.status}`);
  const data = await resp.json();
  return data.tracks;
}

/**
 * Search tracks in download history (for adding to playlists).
 */
export async function searchTracksForPlaylist(query: string, limit = 20): Promise<TrackSearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const resp = await fetch(`/api/playlists/search-tracks?${params}`);
  if (!resp.ok) throw new Error(`Failed to search tracks: ${resp.status}`);
  const data = await resp.json();
  return data.tracks;
}

/**
 * Export a single playlist as .m3u8 file to SAAVN_MUSIC_PATH/Playlists/.
 */
export async function exportPlaylist(id: string): Promise<ExportResult> {
  const resp = await fetch(`/api/playlists/${encodeURIComponent(id)}/export`, {
    method: 'POST',
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Export failed' }));
    throw new Error(err.error || `Failed to export playlist: ${resp.status}`);
  }
  return await resp.json();
}

/**
 * Export all playlists as .m3u8 files.
 */
export async function exportAllPlaylists(): Promise<{ exported: ExportResult[]; count: number }> {
  const resp = await fetch('/api/playlists/export-all', { method: 'POST' });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Export failed' }));
    throw new Error(err.error || `Failed to export playlists: ${resp.status}`);
  }
  return await resp.json();
}

/**
 * Trigger file path backfill (scans SAAVN_MUSIC_PATH and matches to history tracks).
 */
export async function runBackfill(): Promise<BackfillResult> {
  const resp = await fetch('/api/playlists/backfill', { method: 'POST' });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Backfill failed' }));
    throw new Error(err.error || `Failed to run backfill: ${resp.status}`);
  }
  return await resp.json();
}
