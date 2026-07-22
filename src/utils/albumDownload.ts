import JSZip from 'jszip';
import type { SaavnSong, AlbumDetail } from '../types/saavn';
import { sanitizeFilename } from './decrypt';
import { getFFmpeg } from './download';
import { decryptMediaUrl, getQualityUrl } from './decrypt';
import { proxyFetch } from './proxy';
import { recordDownload } from './history';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

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
    const artist = getArtistT(song).toLowerCase().trim();
    artistSet.add(artist);
  }

  const uniqueArtists = [...new Set(album.songs.map(s => getArtistT(s)))];
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

// ─── Trigger ──────────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ─── Internal ffmpeg helpers (per-track; avoid circular imports) ──────────────

function withTimeoutT<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

async function safeDeleteT(ff: FFmpeg, files: string[]): Promise<void> {
  for (const f of files) {
    try { await ff.deleteFile(f); } catch { /* ok */ }
  }
}

function validateT(data: Uint8Array | string, label: string): Uint8Array {
  if (typeof data === 'string') throw new Error(`${label}: string output`);
  if (data.byteLength < 1024) throw new Error(`${label}: output too small (${data.byteLength}B)`);
  return data;
}

function getArtistT(song: SaavnSong): string {
  return (
    song.subtitle?.split(' - ')[0]?.trim() ||
    song.more_info.artists?.primary?.[0]?.name ||
    'Unknown Artist'
  );
}

function getImageUrlT(song: SaavnSong): string {
  return song.image.replace(/\d+x\d+/, '500x500').replace('http://', 'https://');
}

/**
 * Download a single track and return it as a Blob (no browser download triggered).
 * Reuses the same ffmpeg singleton and embed strategies as `downloadWithMetadata`.
 */
async function trackToBlob(
  song: SaavnSong,
  quality: string,
  onProgress: (stage: string, pct: number) => void,
  albumArtistOverride?: string,
): Promise<Blob> {
  const { more_info } = song;

  onProgress('Decrypting…', 8);
  const decrypted = decryptMediaUrl(more_info.encrypted_media_url);
  const audioUrl = getQualityUrl(decrypted, quality);

  onProgress('Fetching audio…', 20);
  const audioResp = await proxyFetch(audioUrl);
  if (!audioResp.ok) throw new Error(`Audio fetch failed: HTTP ${audioResp.status}`);
  const audioBlob = await audioResp.blob();
  if (audioBlob.size < 1024) throw new Error('Audio response is empty — URL may have expired');

  onProgress('Fetching cover…', 35);
  let coverData: Uint8Array | null = null;
  try {
    const imgResp = await proxyFetch(getImageUrlT(song));
    if (imgResp.ok) {
      const imgBlob = await imgResp.blob();
      if (imgBlob.size > 500) coverData = new Uint8Array(await imgBlob.arrayBuffer());
    }
  } catch { /* cover is optional */ }

  onProgress('Loading ffmpeg…', 50);
  const ff = await getFFmpeg();

  const audioData = new Uint8Array(await audioBlob.arrayBuffer());
  const artist = getArtistT(song);
  const meta = { title: song.title, artist, album: more_info.album, year: song.year };

  // Determine album_artist: use override if provided, otherwise fall back to track artist
  const albumArtist = albumArtistOverride || artist;

  // Use song-id-scoped filenames so sequential calls don't collide inside wasm fs
  const inF = `in_${song.id}.mp4`;
  const outF = `out_${song.id}.mp4`;
  const covF = `cov_${song.id}.jpg`;

  await ff.writeFile(inF, audioData);

  let outputData: Uint8Array;

  if (coverData) {
    onProgress('Embedding cover + metadata…', 65);
    await ff.writeFile(covF, coverData);

    const args = [
      '-i', inF, '-i', covF,
      '-map', '0:a:0', '-map', '1:v:0',
      '-c:a', 'copy', '-c:v', 'copy',
      '-disposition:v:0', 'attached_pic',
      '-metadata', `title=${meta.title}`,
      '-metadata', `artist=${meta.artist}`,
      '-metadata', `album_artist=${albumArtist}`,
      '-metadata', `album=${meta.album}`,
      '-metadata', `date=${meta.year}`,
      '-movflags', '+faststart',
      outF,
    ];

    try {
      await withTimeoutT(ff.exec(args), 90_000, 'embed+cover');
      const raw = await ff.readFile(outF) as Uint8Array;
      await safeDeleteT(ff, [inF, covF, outF]);
      outputData = validateT(raw, outF);
    } catch (err) {
      console.warn('[album-dl] Cover embed failed, retrying without cover:', err);
      onProgress('Retrying without cover…', 72);
      await safeDeleteT(ff, [covF, outF]);
      // meta-only fallback
      const metaArgs = [
        '-i', inF, '-c', 'copy',
        '-metadata', `title=${meta.title}`,
        '-metadata', `artist=${meta.artist}`,
        '-metadata', `album_artist=${albumArtist}`,
        '-metadata', `album=${meta.album}`,
        '-metadata', `date=${meta.year}`,
        '-movflags', '+faststart',
        outF,
      ];
      await withTimeoutT(ff.exec(metaArgs), 45_000, 'meta-only');
      const raw = await ff.readFile(outF) as Uint8Array;
      await safeDeleteT(ff, [inF, outF]);
      outputData = validateT(raw, outF);
    }
  } else {
    onProgress('Embedding metadata…', 65);
    const metaArgs = [
      '-i', inF, '-c', 'copy',
      '-metadata', `title=${meta.title}`,
      '-metadata', `artist=${meta.artist}`,
      '-metadata', `album_artist=${albumArtist}`,
      '-metadata', `album=${meta.album}`,
      '-metadata', `date=${meta.year}`,
      '-movflags', '+faststart',
      outF,
    ];
    await withTimeoutT(ff.exec(metaArgs), 45_000, 'meta-only');
    const raw = await ff.readFile(outF) as Uint8Array;
    await safeDeleteT(ff, [inF, outF]);
    outputData = validateT(raw, outF);
  }

  onProgress('Done', 95);
  const buf = outputData.buffer.slice(
    outputData.byteOffset,
    outputData.byteOffset + outputData.byteLength,
  ) as ArrayBuffer;
  return new Blob([buf], { type: 'audio/mp4' });
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

    let attempt = 0;
    let resolved = false;

    while (!resolved && attempt < 2) {
      try {
        // Use downloadWithMetadata but wrapped to trigger individual file download
        const blob = await trackToBlob(songs[i], quality, (stage, p) => {
          tracks[i] = { ...tracks[i], status: 'downloading' };
          emit(i, stage, Math.round(((i + p / 100) / songs.length) * 100));
        }, albumArtistOverride);
        // Trigger individual download
        const artistName = getArtistT(songs[i]);
        const filename = `${String(i + 1).padStart(2, '0')} - ${sanitizeFilename(songs[i].title)} - ${sanitizeFilename(artistName)}.m4a`;
        triggerDownload(blob, filename);
        tracks[i] = { ...tracks[i], status: 'done' };
        resolved = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (attempt === 0) {
          const action = await onFailure(i, songs[i], msg);
          if (action === 'skip') {
            tracks[i] = { ...tracks[i], status: 'skipped', error: msg };
            resolved = true;
          } else {
            attempt++;
          }
        } else {
          // Second attempt also failed — ask again
          const action = await onFailure(i, songs[i], msg);
          if (action === 'skip') {
            tracks[i] = { ...tracks[i], status: 'skipped', error: msg };
          } else {
            tracks[i] = { ...tracks[i], status: 'failed', error: msg };
          }
          resolved = true;
        }
      }
    }
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

    let resolved = false;
    let attempt = 0;

    while (!resolved && attempt < 2) {
      try {
        const blob = await trackToBlob(songs[i], quality, (stage, p) => {
          emit(i, stage, Math.round(((i + p / 100) / songs.length) * 88));
        }, albumArtistOverride);
        const artistName = getArtistT(songs[i]);
        const filename = `${String(i + 1).padStart(2, '0')} - ${sanitizeFilename(songs[i].title)} - ${sanitizeFilename(artistName)}.m4a`;
        completed.push({ filename, blob });
        tracks[i] = { ...tracks[i], status: 'done' };
        resolved = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        const action = await onFailure(i, songs[i], msg);
        if (action === 'skip') {
          tracks[i] = { ...tracks[i], status: 'skipped', error: msg };
          resolved = true;
        } else {
          attempt++;
          if (attempt >= 2) {
            tracks[i] = { ...tracks[i], status: 'failed', error: msg };
            resolved = true;
          }
        }
      }
    }
  }

  // ── Phase 2: build ZIP ────────────────────────────────────────────────────

  emit(songs.length - 1, 'Building ZIP…', 89, 'compressing');

  const zip = new JSZip();
  const folder = zip.folder(sanitizeFilename(`${album.title} (${album.year})`))!;
  for (const { filename, blob } of completed) folder.file(filename, blob);

  const zipBlob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' },
    (meta) => emit(songs.length - 1, `Compressing ${meta.percent.toFixed(0)}%…`, 89 + Math.round(meta.percent * 0.09), 'compressing'),
  );

  emit(songs.length - 1, 'Preparing download…', 99, 'preparing');

  // Release track blobs from memory
  completed.length = 0;

  const zipFilename = `${sanitizeFilename(album.title)} (${album.year}).zip`;
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
  try {
    const resp = await fetch('/api/config');
    if (!resp.ok) return false;
    const data = await resp.json();
    return !!data.libraryEnabled;
  } catch {
    return false;
  }
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

  const albumFolder = `${sanitizeFilename(album.title)} (${album.year})`;

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

    let attempt = 0;
    let resolved = false;

    while (!resolved && attempt < 2) {
      try {
        const blob = await trackToBlob(songs[i], quality, (stage, p) => {
          tracks[i] = { ...tracks[i], status: 'downloading' };
          emit(i, stage, Math.round(((i + p / 100) / songs.length) * 100));
        }, albumArtistOverride);

        // Save to server library instead of triggering browser download
        const artistName = getArtistT(songs[i]);
        const filename = `${String(i + 1).padStart(2, '0')} - ${sanitizeFilename(songs[i].title)} - ${sanitizeFilename(artistName)}.m4a`;

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

        resolved = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (attempt === 0) {
          const action = await onFailure(i, songs[i], msg);
          if (action === 'skip') {
            tracks[i] = { ...tracks[i], status: 'skipped', error: msg };
            resolved = true;
          } else {
            attempt++;
          }
        } else {
          const action = await onFailure(i, songs[i], msg);
          if (action === 'skip') {
            tracks[i] = { ...tracks[i], status: 'skipped', error: msg };
          } else {
            tracks[i] = { ...tracks[i], status: 'failed', error: msg };
          }
          resolved = true;
        }
      }
    }
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
        artist: getArtistT(song),
        duration: parseInt(song.more_info?.duration || '0', 10),
        filePath: existingInfo.filePath,
      });
      emit(i, 'Already in library ✓', Math.round(((i + 1) / songs.length) * 95));
      continue;
    }

    tracks[i] = { ...tracks[i], status: 'downloading' };
    emit(i, 'Starting…', Math.round((i / songs.length) * 95));

    let attempt = 0;
    let resolved = false;

    while (!resolved && attempt < 2) {
      try {
        // Get the album artist for this track's album (from fetched album details)
        const albumId = song.more_info?.album_id || '';
        const albumInfo = albumArtistMap.get(albumId);
        const folderArtist = albumInfo?.albumArtist || getArtistT(song);
        const albumArtistOverride = albumInfo?.albumArtist || undefined;

        // Embed with the correct album artist tag
        const blob = await trackToBlob(songs[i], quality, (stage, p) => {
          tracks[i] = { ...tracks[i], status: 'downloading' };
          emit(i, stage, Math.round(((i + p / 100) / songs.length) * 95));
        }, albumArtistOverride);

        // Use album artist for folder, track's own album name for subfolder
        const trackAlbum = song.more_info?.album || album.title;
        const trackYear = song.year || albumInfo?.year || '';
        const albumFolder = `${sanitizeFilename(trackAlbum)}${trackYear ? ` (${trackYear})` : ''}`;
        const artistName = getArtistT(song);
        const filename = `${sanitizeFilename(song.title)} - ${sanitizeFilename(artistName)}.m4a`;

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

        resolved = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (attempt === 0) {
          const action = await onFailure(i, songs[i], msg);
          if (action === 'skip') {
            tracks[i] = { ...tracks[i], status: 'skipped', error: msg };
            resolved = true;
          } else {
            attempt++;
          }
        } else {
          const action = await onFailure(i, songs[i], msg);
          if (action === 'skip') {
            tracks[i] = { ...tracks[i], status: 'skipped', error: msg };
          } else {
            tracks[i] = { ...tracks[i], status: 'failed', error: msg };
          }
          resolved = true;
        }
      }
    }
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
