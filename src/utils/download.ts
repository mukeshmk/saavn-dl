import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { SaavnSong } from '../types/saavn';
import { decryptMediaUrl, getQualityUrl, sanitizeFilename } from './decrypt';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegLoaded) return ffmpegInstance;

  ffmpegInstance = new FFmpeg();

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpegInstance.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  ffmpegLoaded = true;
  return ffmpegInstance;
}

export interface DownloadOptions {
  song: SaavnSong;
  quality: string;
  onProgress?: (stage: string, percent: number) => void;
}

export async function downloadWithMetadata(opts: DownloadOptions): Promise<void> {
  const { song, quality, onProgress } = opts;
  const { more_info } = song;

  onProgress?.('Decrypting URL…', 10);

  const decrypted = decryptMediaUrl(more_info.encrypted_media_url);
  const audioUrl = getQualityUrl(decrypted, quality);

  onProgress?.('Fetching audio…', 25);

  // Fetch audio
  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) throw new Error(`Failed to fetch audio: ${audioResp.status}`);
  const audioBlob = await audioResp.blob();

  onProgress?.('Fetching cover art…', 40);

  // Fetch cover art (use larger resolution)
  const imageUrl = song.image.replace('150x150', '500x500').replace('50x50', '500x500');
  let coverBlob: Blob | null = null;
  try {
    const imgResp = await fetch(imageUrl);
    if (imgResp.ok) coverBlob = await imgResp.blob();
  } catch {
    // cover art optional
  }

  onProgress?.('Loading ffmpeg…', 55);

  const ff = await getFFmpeg();

  // Write input audio
  await ff.writeFile('input.mp4', await fetchFile(audioBlob));

  // Build ffmpeg args
  const fallbackArtists =
  more_info.artists.primary
    ?.map((a) => a.name)
    .join(', ') || 'Unknown Artist';

  const subtitleArtists =
  song.subtitle
    ?.split(' - ')[0]
    ?.trim();

  const artistTag =
  subtitleArtists || fallbackArtists;
  const title = song.title;
  const album = more_info.album;
  const year = song.year;

  const args: string[] = ['-i', 'input.mp4'];

  if (coverBlob) {
    await ff.writeFile('cover.jpg', await fetchFile(coverBlob));
    args.push('-i', 'cover.jpg');
    args.push('-map', '0:a', '-map', '1:v');
    args.push('-c:v', 'mjpeg');
    args.push('-disposition:v', 'attached_pic');
  }

  args.push(
    '-c:a', 'copy',
    '-metadata', `title=${title}`,
    '-metadata', `artist=${artistTag}`,
    '-metadata', `album_artist=${fallbackArtists}`,
    '-metadata', `album=${album}`,
    '-metadata', `date=${year}`,
    '-metadata', `comment=Downloaded via saavn-dl / Rhythmax`,
    'output.mp4'
  );

  onProgress?.('Embedding metadata…', 75);

  await ff.exec(args);

  onProgress?.('Preparing download…', 90);

  const outputData = await ff.readFile('output.mp4');
  // FileData may be Uint8Array with SharedArrayBuffer; copy to regular ArrayBuffer
  const outputBuffer = outputData instanceof Uint8Array
    ? outputData.buffer.slice(outputData.byteOffset, outputData.byteOffset + outputData.byteLength)
    : outputData;
  const outputBlob = new Blob([outputBuffer as BlobPart], { type: 'audio/mp4' });

  // Cleanup
  try {
    await ff.deleteFile('input.mp4');
    await ff.deleteFile('output.mp4');
    if (coverBlob) await ff.deleteFile('cover.jpg');
  } catch {
    // ignore cleanup errors
  }

  const filename = sanitizeFilename(`${title} - ${artistTag}`) + '.m4a';
  triggerDownload(outputBlob, filename);

  onProgress?.('Done!', 100);
}

export async function downloadDirect(song: SaavnSong, quality: string): Promise<void> {
  const { more_info } = song;
  const decrypted = decryptMediaUrl(more_info.encrypted_media_url);
  const audioUrl = getQualityUrl(decrypted, quality);

  const fallbackArtists =
  more_info.artists.primary
    ?.map((a) => a.name)
    .join(', ') || 'Unknown Artist';

  const subtitleArtists =
  song.subtitle
    ?.split(' - ')[0]
    ?.trim();

  const artistTag =
  subtitleArtists || fallbackArtists;
  const filename = sanitizeFilename(`${song.title} - ${artistTag}`) + '.mp4';

  // Fetch and trigger download
  const resp = await fetch(audioUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
