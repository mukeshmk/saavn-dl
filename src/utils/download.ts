import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import type { SaavnSong } from '../types/saavn';
import { getSongArtist, getSongCoverUrl } from '../types/saavn';
import { decryptMediaUrl, getQualityUrl, sanitizeFilename } from './decrypt';
import { proxyFetch } from './proxy';
import type { TrackMetadata } from '../types/metadata';

// ─── FFmpeg singleton ──────────────────────────────────────────────────────────

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;
let loadPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegLoaded) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    ffmpegInstance = new FFmpeg();

    // Mirror log to console for debugging
    ffmpegInstance.on('log', ({ message }) => {
      console.debug('[ffmpeg]', message);
    });

    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpegInstance.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegLoaded = true;
    return ffmpegInstance;
  })();

  return loadPromise;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Race an async fn against a timeout; throws if timeout fires first. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

function validateOutput(data: Uint8Array | string, label: string): Uint8Array {
  if (typeof data === 'string') throw new Error(`${label}: got string instead of bytes`);
  if (data.byteLength < 1024) throw new Error(`${label}: output too small (${data.byteLength} bytes) — likely empty`);
  return data;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  // Copy out of potential SharedArrayBuffer
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function safeDeleteFile(ff: FFmpeg, path: string): Promise<void> {
  try { await ff.deleteFile(path); } catch { /* ignore */ }
}

// ─── Core exec with output validation ─────────────────────────────────────────

/**
 * Run ffmpeg args, read output, validate size, clean up.
 * Throws if exec times out or output is suspiciously small.
 */
async function runFFmpeg(
  ff: FFmpeg,
  args: string[],
  inputFiles: string[],
  outputFile: string,
  timeoutMs = 60_000,
): Promise<Uint8Array> {
  try {
    await withTimeout(ff.exec(args), timeoutMs, 'ffmpeg exec');
  } catch (err) {
    // Clean up before re-throwing
    for (const f of [...inputFiles, outputFile]) await safeDeleteFile(ff, f);
    throw err;
  }

  const raw = await ff.readFile(outputFile) as Uint8Array;

  for (const f of [...inputFiles, outputFile]) await safeDeleteFile(ff, f);

  return validateOutput(raw, outputFile);
}

// ─── Metadata ──────────────────────────────────────────────────────────────

interface EmbedMeta {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  year: string;
  publisher: string;
  copyright: string;
}

/** ffmpeg `-metadata` args shared by both embed strategies. */
function metadataArgs(meta: EmbedMeta): string[] {
  const args = [
    '-metadata', `title=${meta.title}`,
    '-metadata', `artist=${meta.artist}`,
    '-metadata', `album_artist=${meta.albumArtist}`,
    '-metadata', `album=${meta.album}`,
    '-metadata', `date=${meta.year}`,
  ];
  if (meta.publisher) args.push('-metadata', `publisher=${meta.publisher}`);
  if (meta.copyright) args.push('-metadata', `copyright=${meta.copyright}`);
  return args;
}

// ─── Strategy A: metadata + cover art ─────────────────────────────────────────
// `scope` uniquely names the virtual-FS temp files so batched callers (albums)
// don't collide inside ffmpeg's in-memory filesystem.

async function embedWithCover(
  ff: FFmpeg,
  audioData: Uint8Array,
  coverData: Uint8Array,
  meta: EmbedMeta,
  scope: string,
): Promise<Uint8Array> {
  const inF = `in${scope}.mp4`;
  const covF = `cover${scope}.jpg`;
  const outF = `out${scope}.mp4`;

  await ff.writeFile(inF, audioData);
  await ff.writeFile(covF, coverData);

  // For MP4/M4A containers the safest cover-art embed is:
  // map audio from input 0, map video (cover) from input 1,
  // copy both streams, tag the video as attached_pic.
  // We avoid re-encoding (-c:v copy) because the cover is already JPEG.
  const args = [
    '-i', inF,
    '-i', covF,
    '-map', '0:a:0',
    '-map', '1:v:0',
    '-c:a', 'copy',
    '-c:v', 'copy',
    '-disposition:v:0', 'attached_pic',
    ...metadataArgs(meta),
    '-movflags', '+faststart',
    outF,
  ];

  // Cover embedding can be slow — give it 90s
  return runFFmpeg(ff, args, [inF, covF], outF, 90_000);
}

// ─── Strategy B: metadata only (no cover) ─────────────────────────────────────

async function embedMetaOnly(
  ff: FFmpeg,
  audioData: Uint8Array,
  meta: EmbedMeta,
  scope: string,
): Promise<Uint8Array> {
  const inF = `in${scope}.mp4`;
  const outF = `outmeta${scope}.mp4`;

  await ff.writeFile(inF, audioData);

  const args = [
    '-i', inF,
    '-c', 'copy',
    ...metadataArgs(meta),
    '-movflags', '+faststart',
    outF,
  ];

  return runFFmpeg(ff, args, [inF], outF, 45_000);
}

// ─── Public API ────────────────────────────────────────────────────────────────

export interface DownloadOptions {
  song: SaavnSong;
  quality: string;
  onProgress?: (stage: string, percent: number) => void;
  overrideMeta?: TrackMetadata;
  overrideFilename?: string;
}

export interface TrackBlobOptions {
  quality: string;
  onProgress?: (stage: string, percent: number) => void;
  overrideMeta?: TrackMetadata;
  /** Album Artist tag override (Navidrome multi-artist fix). */
  albumArtistOverride?: string;
  /** Unique suffix for ffmpeg temp files (album batches process many in a row). */
  scope?: string;
}

/**
 * Core single-track pipeline: decrypt → fetch audio + cover → embed metadata
 * with ffmpeg → return the finished M4A as a Blob (no browser download).
 * Shared by single-track downloads, album batches, and library saves.
 */
export async function trackToBlob(song: SaavnSong, opts: TrackBlobOptions): Promise<Blob> {
  const { quality, onProgress, overrideMeta, albumArtistOverride, scope = '' } = opts;
  const { more_info } = song;

  onProgress?.('Decrypting URL…', 8);
  const decrypted = decryptMediaUrl(more_info.encrypted_media_url);
  const audioUrl = getQualityUrl(decrypted, quality);

  onProgress?.('Fetching audio…', 18);
  const audioResp = await proxyFetch(audioUrl);
  if (!audioResp.ok) throw new Error(`Audio fetch failed: HTTP ${audioResp.status}`);
  const audioBlob = await audioResp.blob();
  if (audioBlob.size < 1024) throw new Error('Audio response is empty — URL may have expired');

  onProgress?.('Fetching cover art…', 32);
  let coverData: Uint8Array | null = null;
  try {
    const imgResp = await proxyFetch(getSongCoverUrl(song));
    if (imgResp.ok) {
      const imgBlob = await imgResp.blob();
      if (imgBlob.size > 500) {
        coverData = new Uint8Array(await imgBlob.arrayBuffer());
      }
    }
  } catch {
    // cover is optional
  }

  onProgress?.('Loading ffmpeg…', 48);
  const ff = await getFFmpeg();

  const audioData = new Uint8Array(await audioBlob.arrayBuffer());
  const artist = overrideMeta?.artist ?? getSongArtist(song);
  const meta: EmbedMeta = {
    title: overrideMeta?.title ?? song.title,
    artist,
    albumArtist: albumArtistOverride ?? overrideMeta?.albumArtist ?? artist,
    album: overrideMeta?.album ?? more_info.album,
    year: overrideMeta?.year ?? song.year,
    publisher: more_info.label,
    copyright: overrideMeta?.copyright ?? more_info.copyright_text,
  };

  let outputData: Uint8Array;

  if (coverData) {
    onProgress?.('Embedding cover + metadata…', 62);
    try {
      outputData = await embedWithCover(ff, audioData, coverData, meta, scope);
    } catch (err) {
      // Cover embedding failed — retry without cover
      console.warn('[saavn-dl] Cover embed failed, retrying without cover:', err);
      onProgress?.('Cover failed, embedding metadata only…', 72);
      outputData = await embedMetaOnly(ff, audioData, meta, scope);
    }
  } else {
    onProgress?.('Embedding metadata…', 62);
    outputData = await embedMetaOnly(ff, audioData, meta, scope);
  }

  onProgress?.('Preparing…', 92);
  return new Blob([toArrayBuffer(outputData)], { type: 'audio/mp4' });
}

/** Fetch the raw audio stream as a Blob with no ffmpeg processing / metadata. */
export async function trackToBlobDirect(song: SaavnSong, quality: string): Promise<Blob> {
  const decrypted = decryptMediaUrl(song.more_info.encrypted_media_url);
  const audioUrl = getQualityUrl(decrypted, quality);
  const resp = await proxyFetch(audioUrl);
  if (!resp.ok) throw new Error(`Audio fetch failed: HTTP ${resp.status}`);
  const blob = await resp.blob();
  if (blob.size < 1024) throw new Error('Received empty file');
  return blob;
}

export async function downloadWithMetadata(opts: DownloadOptions): Promise<void> {
  const { song, quality, onProgress, overrideMeta, overrideFilename } = opts;
  const blob = await trackToBlob(song, { quality, onProgress, overrideMeta });

  const title = overrideMeta?.title ?? song.title;
  const artist = overrideMeta?.artist ?? getSongArtist(song);
  const filename = sanitizeFilename(overrideFilename ?? `${title} - ${artist}`) + '.m4a';
  triggerDownload(blob, filename);
  onProgress?.('Done!', 100);
}

export async function downloadDirect(song: SaavnSong, quality: string, overrideFilename?: string): Promise<void> {
  const artist = getSongArtist(song);
  const filename = sanitizeFilename(overrideFilename ?? `${song.title} - ${artist}`) + '.m4a';
  const blob = await trackToBlobDirect(song, quality);
  triggerDownload(blob, filename);
}
