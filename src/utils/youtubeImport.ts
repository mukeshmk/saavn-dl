/**
 * YouTube import — client wrapper for the /api/import/* endpoints.
 *
 * These are SAME-ORIGIN calls to our own server only. The server performs every
 * external/VPN-routed operation (yt-dlp extraction, JioSaavn search, song-detail
 * fetch); the browser never talks to YouTube or JioSaavn for this feature.
 *
 * Self-hosted only — gated behind `youtubeImportEnabled` from /api/config.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface YouTubeEntry {
  videoId: string;
  title: string;
  uploader: string;
  duration: number;
}

/** Lean JioSaavn candidate (as projected by the server matcher). */
export interface MatchCandidate {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  perma_url: string;
  image: string;
  year?: string;
  language?: string;
  more_info?: { album?: string; duration?: string };
  /** True when this track is already in the library/history (server-checked). */
  downloaded?: boolean;
}

export interface ImportEntry {
  youtube: YouTubeEntry;
  /** The auto-generated search query (cleaned YouTube title) — prefills the refine box. */
  query: string;
  candidates: MatchCandidate[];
  suggestedIndex: number;
}

export interface ImportPreview {
  entries: ImportEntry[];
  max: number;
  truncated: boolean;
}

export interface CommitSelection {
  saavnId: string;
  permaUrl: string;
  title: string;
  artist: string;
}

export interface CommitResult {
  playlistId: string;
  addedNow: number;
  queued: number;
  failed: { saavnId: string | null; error: string }[];
}

// ─── URL detection (mirrors the server host allowlist) ──────────────────────

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

export function isYoutubeUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return YOUTUBE_HOSTS.has(parsed.hostname);
}

// ─── API calls ────────────────────────────────────────────────────────────────

/** Extract a YouTube playlist/mix and match each track to JioSaavn candidates. */
export async function importYoutube(url: string): Promise<ImportPreview> {
  const resp = await fetch('/api/import/youtube', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Import failed' }));
    throw new Error(err.error || `Import failed: ${resp.status}`);
  }
  return resp.json();
}

/** Re-run a manual search (title + artist/album, etc.) for one track in the review step. */
export async function searchImportCandidates(query: string): Promise<{ candidates: MatchCandidate[]; suggestedIndex: number }> {
  const resp = await fetch('/api/import/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Search failed' }));
    throw new Error(err.error || `Search failed: ${resp.status}`);
  }
  return resp.json();
}

/** Create the playlist and download/collect the selected tracks. */
export async function commitImport(opts: {
  playlistName: string;
  quality: string;
  selections: CommitSelection[];
}): Promise<CommitResult> {
  const resp = await fetch('/api/import/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Commit failed' }));
    throw new Error(err.error || `Commit failed: ${resp.status}`);
  }
  return resp.json();
}
