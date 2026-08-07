import JSZip from 'jszip';
import type { SaavnSong, AlbumDetail } from '../types/saavn';
import { getSongArtist } from '../types/saavn';
import { sanitizeFilename } from './decrypt';
import { trackToBlob, triggerDownload } from './download';
import { proxyFetch } from './proxy';
import { recordDownload } from './history';
import { getConfig } from './config';

// ─── Naming helpers (single source for on-disk folder + file names) ───────────

/** Album folder: "Title (Year)" — the "(Year)" suffix is omitted when year is empty. */
function albumFolderName(title: string, year: string): string {
  return `${sanitizeFilename(title)}${year ? ` (${year})` : ''}`;
}

/** Track filename: "NN - Title - Artist.m4a"; the number prefix is omitted when trackNumber is undefined. */
function trackFileName(title: string, artist: string, trackNumber?: number): string {
  const prefix = trackNumber != null ? `${String(trackNumber).padStart(2, '0')} - ` : '';
  return `${prefix}${sanitizeFilename(title)} - ${sanitizeFilename(artist)}.m4a`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlbumDownloadMode = 'individual' | 'zip' | 'library';

export interface TrackStatus {
  id: string;
  title: string;
  status: 'pending' | 'downloading' | 'done' | 'failed' | 'skipped';
  error?: string;
  blob?: Blob;
  filePath?: string;
}

export interface AlbumDownloadProgress {
  current: number;
  total: number;
  currentTitle: string;
  stage: string;
  percent: number;
  tracks: TrackStatus[];
  zipStage?: 'compressing' | 'preparing' | 'done';
}

export type ProgressCallback = (p: AlbumDownloadProgress) => void;
export type FailureCallback = (
  trackIndex: number,
  track: SaavnSong,
  error: string,
) => Promise<'skip' | 'retry'>;

// ─── Size estimation ──────────────────────────────────────────────────────────

const KBPS_TO_BYTES_PER_SEC: Record<string, number> = {
  '12': 1_500,
  '48': 6_000,
  '96': 12_000,
  '160': 20_000,
  '320': 40_000,
};

export function estimateAlbumSizeMB(songs: SaavnSong[], quality: string): number {
  const bps = KBPS_TO_BYTES_PER_SEC[quality] ?? 40_000;
  const totalSec = songs.reduce(
    (acc, s) => acc + parseInt(s.more_info?.duration || '0', 10),
    0,
  );
  return (totalSec * bps) / (1024 * 1024);
}

// ─── Multi-artist detection (Navidrome compatibility) ─────────────────────────

export interface MultiArtistInfo {
  isMultiArtist: boolean;
  uniqueArtists: string[];
  suggestedAlbumArtist: string;
}

/**
 * Detects whether an album has tracks by different artists.
 * If so, suggests a unified Album Artist value:
 * - If there's an album-level primary artist, use that.
 * - Otherwise, suggest "Various Artists".
 */
export function detectMultiArtist(album: AlbumDetail): MultiArtistInfo {
  const artistSet = new Set<string>();

  for (const song of album.songs) {
    const artist = getSongArtist(song).toLowerCase().trim();
    artistSet.add(artist);
  }

  const uniqueArtists = [...new Set(album.songs.map(s => getSongArtist(s)))];
  const isMultiArtist = artistSet.size > 1;

  // Suggest unified Album Artist
  let suggestedAlbumArtist = 'Various Artists';

  if (album.artists?.primary?.length === 1) {
    // Single album-level artist → use it
    suggestedAlbumArtist = album.artists.primary[0].name;
  } else if (album.artists?.primary?.length > 1) {
    // Multiple album-level artists → join them
    suggestedAlbumArtist = album.artists.primary.map(a => a.name).join(', ');
  }

  return { isMultiArtist, uniqueArtists, suggestedAlbumArtist };
}

// ─── Shared per-track retry policy ────────────────────────────────────────────

/**
 * Run `work` for track `i` with the standard retry policy shared by every
 * album/playlist mode: on failure ask `onFailure` — 'skip' marks the track
 * skipped, 'retry' re-runs it (max 2 attempts, then marks it failed).
 * `work` owns the success path (it sets tracks[i] to 'done').
 */
async function runTrackWithRetry(
  i: number,
  song: SaavnSong,
  tracks: TrackStatus[],
  onFailure: FailureCallback,
  work: () => Promise<void>,
): Promise<void> {
  let attempt = 0;
  while (attempt < 2) {
    try {
      await work();
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const action = await onFailure(i, song, msg);
      if (action === 'skip') {
        tracks[i] = { ...tracks[i], status: 'skipped', error: msg };
        return;
      }
      attempt++;
      if (attempt >= 2) {
        tracks[i] = { ...tracks[i], status: 'failed', error: msg };
        return;
      }
    }
  }
}

// ─── Individual mode ──────────────────────────────────────────────────────────

export async function downloadAlbumIndividual(
  album: AlbumDetail,
  quality: string,
  onProgress: ProgressCallback,
  onFailure: FailureCallback,
  albumArtistOverride?: string,
): Promise<void> {
  const songs = album.songs;
  const tracks: TrackStatus[] = songs.map(s => ({ id: s.id, title: s.title, status: 'pending' as const }));

  const emit = (i: number, stage: string, pct: number) =>
    onProgress({ current: i + 1, total: songs.length, currentTitle: songs[i]?.title ?? '', stage, percent: pct, tracks: [...tracks] });

  for (let i = 0; i < songs.length; i++) {
    tracks[i] = { ...tracks[i], status: 'downloading' };
    emit(i, 'Starting…', Math.round((i / songs.length) * 100));

    await runTrackWithRetry(i, songs[i], tracks, onFailure, async () => {
      const blob = await trackToBlob(songs[i], {
        quality,
        albumArtistOverride,
        scope: songs[i].id,
        onProgress: (stage, p) => {
          tracks[i] = { ...tracks[i], status: 'downloading' };
          emit(i, stage, Math.round(((i + p / 100) / songs.length) * 100));
        },
      });
      // Trigger individual download
      const artistName = getSongArtist(songs[i]);
      const filename = trackFileName(songs[i].title, artistName, i + 1);
      triggerDownload(blob, filename);
      tracks[i] = { ...tracks[i], status: 'done' };
    });
  }

  onProgress({ current: songs.length, total: songs.length, currentTitle: '', stage: 'Done!', percent: 100, tracks: [...tracks] });
}

// ─── ZIP mode ─────────────────────────────────────────────────────────────────

export async function downloadAlbumZip(
  album: AlbumDetail,
  quality: string,
  onProgress: ProgressCallback,
  onFailure: FailureCallback,
  albumArtistOverride?: string,
): Promise<void> {
  const songs = album.songs;
  const tracks: TrackStatus[] = songs.map(s => ({ id: s.id, title: s.title, status: 'pending' as const }));
  const completed: Array<{ filename: string; blob: Blob }> = [];

  const emit = (i: number, stage: string, pct: number, zipStage?: AlbumDownloadProgress['zipStage']) =>
    onProgress({
      current: Math.min(i + 1, songs.length),
      total: songs.length,
      currentTitle: songs[Math.min(i, songs.length - 1)]?.title ?? '',
      stage,
      percent: pct,
      tracks: [...tracks],
      zipStage,
    });

  // ── Phase 1: download each track → blob ──────────────────────────────────

  for (let i = 0; i < songs.length; i++) {
    tracks[i] = { ...tracks[i], status: 'downloading' };
    emit(i, 'Starting…', Math.round((i / songs.length) * 88));

    await runTrackWithRetry(i, songs[i], tracks, onFailure, async () => {
      const blob = await trackToBlob(songs[i], {
        quality,
        albumArtistOverride,
        scope: songs[i].id,
        onProgress: (stage, p) => {
          emit(i, stage, Math.round(((i + p / 100) / songs.length) * 88));
        },
      });
      const artistName = getSongArtist(songs[i]);
      const filename = trackFileName(songs[i].title, artistName, i + 1);
      completed.push({ filename, blob });
      tracks[i] = { ...tracks[i], status: 'done' };
    });
  }

  // ── Phase 2: build ZIP ────────────────────────────────────────────────────

  emit(songs.length - 1, 'Building ZIP…', 89, 'compressing');

  const zip = new JSZip();
  const folder = zip.folder(albumFolderName(album.title, album.year))!;
  for (const { filename, blob } of completed) folder.file(filename, blob);

  const zipBlob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' },
    (meta) => emit(songs.length - 1, `Compressing ${meta.percent.toFixed(0)}%…`, 89 + Math.round(meta.percent * 0.09), 'compressing'),
  );

  emit(songs.length - 1, 'Preparing download…', 99, 'preparing');

  // Release track blobs from memory
  completed.length = 0;

  const zipFilename = `${albumFolderName(album.title, album.year)}.zip`;
  triggerDownload(zipBlob, zipFilename);

  onProgress({
    current: songs.length,
    total: songs.length,
    currentTitle: '',
    stage: 'Done!',
    percent: 100,
    tracks: [...tracks],
    zipStage: 'done',
  });
}

// ─── Library mode (save to server) ───────────────────────────────────────────

export async function checkLibraryEnabled(): Promise<boolean> {
  const cfg = await getConfig();
  return !!cfg?.libraryEnabled;
}

async function saveToLibrary(blob: Blob, artist: string, album: string, filename: string): Promise<string> {
  const resp = await fetch('/api/library/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Artist': encodeURIComponent(artist),
      'X-Album': encodeURIComponent(album),
      'X-Filename': encodeURIComponent(filename),
    },
    body: blob,
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: 'Unknown server error' }));
    throw new Error(data.error || `Server responded with ${resp.status}`);
  }

  const data = await resp.json();
  return data.path || '';
}

// ─── Check existing tracks (shared by album + playlist library modes) ─────────

interface ExistingTrackInfo {
  filePath: string;
  exists: boolean;
}

interface CheckTracksResponse {
  existing: Record<string, ExistingTrackInfo>;
}

/**
 * Check which tracks already exist in the library (checks both staging and music paths).
 */
async function checkExistingTracks(saavnIds: string[]): Promise<Record<string, ExistingTrackInfo>> {
  try {
    const resp = await fetch('/api/library/check-tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saavnIds }),
    });
    if (resp.ok) {
      const data: CheckTracksResponse = await resp.json();
      return data.existing || {};
    }
  } catch {
    // Fall through — treat all as missing
  }
  return {};
}

// ─── Album Library mode ───────────────────────────────────────────────────────

export async function downloadAlbumLibrary(
  album: AlbumDetail,
  quality: string,
  onProgress: ProgressCallback,
  onFailure: FailureCallback,
  albumArtistOverride?: string,
): Promise<void> {
  const songs = album.songs;
  const tracks: TrackStatus[] = songs.map(s => ({ id: s.id, title: s.title, status: 'pending' as const }));

  const albumFolder = albumFolderName(album.title, album.year);

  const emit = (i: number, stage: string, pct: number) =>
    onProgress({ current: i + 1, total: songs.length, currentTitle: songs[i]?.title ?? '', stage, percent: pct, tracks: [...tracks] });

  // Check which tracks already exist in the library
  emit(0, 'Checking existing tracks…', 0);
  const saavnIds = songs.map(s => s.id);
  const existingMap = await checkExistingTracks(saavnIds);

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    const existingInfo = existingMap[song.id];

    // Skip tracks that already exist on disk
    if (existingInfo?.exists && existingInfo.filePath) {
      tracks[i] = { ...tracks[i], status: 'done', filePath: existingInfo.filePath };
      emit(i, 'Already in library ✓', Math.round(((i + 1) / songs.length) * 100));
      continue;
    }

    tracks[i] = { ...tracks[i], status: 'downloading' };
    emit(i, 'Starting…', Math.round((i / songs.length) * 100));

    await runTrackWithRetry(i, songs[i], tracks, onFailure, async () => {
      const blob = await trackToBlob(songs[i], {
        quality,
        albumArtistOverride,
        scope: songs[i].id,
        onProgress: (stage, p) => {
          tracks[i] = { ...tracks[i], status: 'downloading' };
          emit(i, stage, Math.round(((i + p / 100) / songs.length) * 100));
        },
      });

      // Save to server library instead of triggering browser download
      const artistName = getSongArtist(songs[i]);
      const filename = trackFileName(songs[i].title, artistName, i + 1);

      // Use album artist override (Navidrome fix) or album-level artist for folder structure
      const folderArtist = albumArtistOverride || album.artists?.primary?.[0]?.name || artistName;

      emit(i, 'Saving to library…', Math.round(((i + 0.95) / songs.length) * 100));
      const savedPath = await saveToLibrary(blob, folderArtist, albumFolder, filename);

      tracks[i] = { ...tracks[i], status: 'done', filePath: savedPath };

      // Record to history so the track exists in the DB for playlist linking
      recordDownload({
        saavnId: song.id,
        type: 'track',
        title: song.title,
        artist: artistName,
        album: album.title,
        image: song.image || '',
        quality,
        mode: 'library',
        songCount: 0,
        duration: song.more_info?.duration || '0',
        playCount: song.play_count || '0',
        year: song.year || album.year || '',
        language: song.language || album.language || '',
        isExplicit: song.isExplicit || false,
        filePath: savedPath,
      }).catch(() => { /* best-effort */ });
    });
  }

  onProgress({ current: songs.length, total: songs.length, currentTitle: '', stage: 'Done!', percent: 100, tracks: [...tracks] });
}

// ─── Playlist Library mode ────────────────────────────────────────────────────
// Unlike album library mode, this uses each track's own Artist/Album for folder structure,
// skips already-downloaded tracks, and generates an m3u playlist file.

/**
 * Create an m3u playlist file in the library.
 */
async function createPlaylistFile(name: string, tracks: { saavnId: string; title: string; artist: string; duration: number; filePath: string }[]): Promise<string> {
  const resp = await fetch('/api/library/playlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, tracks }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(data.error || `Playlist creation failed: ${resp.status}`);
  }
  const data = await resp.json();
  return data.path || '';
}

// ─── Album artist resolution for playlist tracks ──────────────────────────────

interface AlbumArtistInfo {
  albumArtist: string;
  year: string;
}

const DETAIL_API = 'https://sda.rhythmax.workers.dev/album';

/**
 * Fetches album details for each unique album_id in the playlist to resolve
 * the correct album artist. This ensures tracks land in the same folder as
 * when downloading the full album (Navidrome compatibility).
 *
 * Returns a Map of album_id → { albumArtist, year }
 */
async function resolveAlbumArtists(songs: SaavnSong[]): Promise<Map<string, AlbumArtistInfo>> {
  const map = new Map<string, AlbumArtistInfo>();

  // Collect unique album URLs keyed by album_id
  const albumUrls = new Map<string, string>();
  for (const song of songs) {
    const albumId = song.more_info?.album_id;
    const albumUrl = song.more_info?.album_url;
    if (albumId && albumUrl && !albumUrls.has(albumId)) {
      albumUrls.set(albumId, albumUrl);
    }
  }

  // Fetch album details in parallel (batches of 5 to avoid hammering the API)
  const entries = [...albumUrls.entries()];
  const BATCH_SIZE = 5;

  for (let batch = 0; batch < entries.length; batch += BATCH_SIZE) {
    const chunk = entries.slice(batch, batch + BATCH_SIZE);
    const results = await Promise.allSettled(
      chunk.map(async ([albumId, albumUrl]) => {
        try {
          const res = await proxyFetch(`${DETAIL_API}?url=${encodeURIComponent(albumUrl)}`);
          if (!res.ok) return null;
          const detail: AlbumDetail = await res.json();
          if (!detail?.id) return null;

          // Determine album artist using the same logic as downloadAlbumLibrary
          let albumArtist: string;
          if (detail.artists?.primary?.length === 1) {
            albumArtist = detail.artists.primary[0].name;
          } else if (detail.artists?.primary?.length > 1) {
            albumArtist = detail.artists.primary.map(a => a.name).join(', ');
          } else {
            albumArtist = detail.subtitle?.split(' - ')[0]?.trim() || '';
          }

          return { albumId, albumArtist, year: detail.year || '' };
        } catch {
          return null;
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const { albumId, albumArtist, year } = result.value;
        map.set(albumId, { albumArtist, year });
      }
    }
  }

  return map;
}

/**
 * Download a playlist to library with per-track Artist/Album folder structure.
 * Fetches album details for each unique album to get the correct album artist
 * (avoids the Navidrome split-album problem).
 * Skips tracks that already exist in the library and generates an m3u file.
 */
export async function downloadPlaylistLibrary(
  album: AlbumDetail,
  quality: string,
  onProgress: ProgressCallback,
  onFailure: FailureCallback,
  _albumArtistOverride?: string,
): Promise<void> {
  const songs = album.songs;
  const tracks: TrackStatus[] = songs.map(s => ({ id: s.id, title: s.title, status: 'pending' as const }));

  const emit = (i: number, stage: string, pct: number) =>
    onProgress({ current: i + 1, total: songs.length, currentTitle: songs[i]?.title ?? '', stage, percent: pct, tracks: [...tracks] });

  // Phase 1: Check which tracks already exist in the library
  emit(0, 'Checking existing tracks…', 0);
  const saavnIds = songs.map(s => s.id);
  const existingMap = await checkExistingTracks(saavnIds);

  // Phase 2: Fetch album details for unique albums to get correct album artists
  emit(0, 'Resolving album artists…', 1);
  const albumArtistMap = await resolveAlbumArtists(songs);

  // Collect all track paths (existing + newly downloaded) for the m3u
  const playlistTracks: { saavnId: string; title: string; artist: string; duration: number; filePath: string }[] = [];

  // Phase 3: Download missing tracks, skip existing ones
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    const existingInfo = existingMap[song.id];

    // If track already exists on disk, skip download and use existing path
    if (existingInfo?.exists && existingInfo.filePath) {
      tracks[i] = { ...tracks[i], status: 'done', filePath: existingInfo.filePath };
      playlistTracks.push({
        saavnId: song.id,
        title: song.title,
        artist: getSongArtist(song),
        duration: parseInt(song.more_info?.duration || '0', 10),
        filePath: existingInfo.filePath,
      });
      emit(i, 'Already in library ✓', Math.round(((i + 1) / songs.length) * 95));
      continue;
    }

    tracks[i] = { ...tracks[i], status: 'downloading' };
    emit(i, 'Starting…', Math.round((i / songs.length) * 95));

    await runTrackWithRetry(i, songs[i], tracks, onFailure, async () => {
      // Get the album artist for this track's album (from fetched album details)
      const albumId = song.more_info?.album_id || '';
      const albumInfo = albumArtistMap.get(albumId);
      const folderArtist = albumInfo?.albumArtist || getSongArtist(song);
      const albumArtistOverride = albumInfo?.albumArtist || undefined;

      // Embed with the correct album artist tag
      const blob = await trackToBlob(songs[i], {
        quality,
        albumArtistOverride,
        scope: songs[i].id,
        onProgress: (stage, p) => {
          tracks[i] = { ...tracks[i], status: 'downloading' };
          emit(i, stage, Math.round(((i + p / 100) / songs.length) * 95));
        },
      });

      // Use album artist for folder, track's own album name for subfolder
      const trackAlbum = song.more_info?.album || album.title;
      const trackYear = song.year || albumInfo?.year || '';
      const albumFolder = albumFolderName(trackAlbum, trackYear);
      const artistName = getSongArtist(song);
      const filename = trackFileName(song.title, artistName);

      emit(i, 'Saving to library…', Math.round(((i + 0.95) / songs.length) * 95));
      const savedPath = await saveToLibrary(blob, folderArtist, albumFolder, filename);

      tracks[i] = { ...tracks[i], status: 'done', filePath: savedPath };
      playlistTracks.push({
        saavnId: song.id,
        title: song.title,
        artist: artistName,
        duration: parseInt(song.more_info?.duration || '0', 10),
        filePath: savedPath,
      });

      // Record to history so the track exists in the DB before playlist linking
      recordDownload({
        saavnId: song.id,
        type: 'track',
        title: song.title,
        artist: artistName,
        album: trackAlbum,
        image: song.image || '',
        quality,
        mode: 'library',
        songCount: 0,
        duration: song.more_info?.duration || '0',
        playCount: song.play_count || '0',
        year: song.year || trackYear,
        language: song.language || '',
        isExplicit: song.isExplicit || false,
        filePath: savedPath,
      }).catch(() => { /* best-effort */ });
    });
  }

  // Phase 4: Generate m3u playlist file
  if (playlistTracks.length > 0) {
    emit(songs.length - 1, 'Creating playlist file…', 96);
    try {
      await createPlaylistFile(album.title, playlistTracks);
    } catch (err) {
      console.error('Failed to create playlist file:', err);
      // Non-fatal — tracks were still saved
    }
  }

  onProgress({ current: songs.length, total: songs.length, currentTitle: '', stage: 'Done!', percent: 100, tracks: [...tracks] });
}
