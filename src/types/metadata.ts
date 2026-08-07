import type { SaavnSong } from './saavn';
import { getSongArtist } from './saavn';
import { sanitizeFilename } from '../utils/decrypt';

// ─── Editable metadata shape ──────────────────────────────────────────────────

export interface TrackMetadata {
  filename: string;       // without extension
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  genre: string;
  year: string;
  trackNumber: string;
  discNumber: string;
  composer: string;
  copyright: string;
  comment: string;
}

// ─── Build default metadata from a SaavnSong ─────────────────────────────────

export function buildDefaultMetadata(song: SaavnSong): TrackMetadata {
  const artist = getSongArtist(song);

  const filename = `${song.title} - ${artist}`;

  return {
    filename,
    title: song.title,
    artist,
    albumArtist: song.more_info.artists?.primary?.map((a) => a.name).join(', ') || artist,
    album: song.more_info.album || '',
    genre: '',
    year: song.year || '',
    trackNumber: '',
    discNumber: '',
    composer: '',
    copyright: song.more_info.copyright_text || '',
    comment: '',
  };
}

// ─── Compare ──────────────────────────────────────────────────────────────────

export function metadataIsModified(
  original: TrackMetadata,
  edited: TrackMetadata,
): boolean {
  return (Object.keys(original) as (keyof TrackMetadata)[]).some(
    (k) => original[k] !== edited[k],
  );
}

// ─── Filename sanitisation ────────────────────────────────────────────────────

// Single client-side filename sanitizer — illegal filesystem chars become '-'.
// Shared with download/album filenames (and matches the server's parity-tested
// behavior) so the same name is produced everywhere.
export { sanitizeFilename as sanitizeFilenameField };
