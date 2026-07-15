import type { SaavnSong } from './saavn';

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
  const artist =
    song.subtitle?.split(' - ')[0]?.trim() ||
    song.more_info.artists?.primary?.map((a) => a.name).join(', ') ||
    'Unknown Artist';

  const filename = `${song.title} - ${artist}`;

  return {
    filename,
    title:       song.title,
    artist,
    albumArtist: song.more_info.artists?.primary?.map((a) => a.name).join(', ') || artist,
    album:       song.more_info.album       || '',
    genre:       '',
    year:        song.year                  || '',
    trackNumber: '',
    discNumber:  '',
    composer:    '',
    copyright:   song.more_info.copyright_text || '',
    comment:     'Downloaded via saavn-dl / Rhythmax',
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

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

export function sanitizeFilenameField(name: string): string {
  return name.replace(INVALID_FILENAME_CHARS, '').replace(/\s+/g, ' ').trim();
}

export function resolveFilename(raw: string, fallback: string): string {
  const sanitized = sanitizeFilenameField(raw);
  return sanitized || sanitizeFilenameField(fallback);
}
