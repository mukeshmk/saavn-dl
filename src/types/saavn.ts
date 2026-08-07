import { getConfig } from '../utils/config';

export interface SaavnArtist {
  id: string;
  artist_token: string;
  name: string;
  image: string;
  perma_url: string;
}

export interface SaavnMoreInfo {
  album_id: string;
  album_token: string;
  album: string;
  label: string;
  album_url: string;
  encrypted_media_url: string;
  duration: string;
  copyright_text: string;
  artists: {
    primary: SaavnArtist[];
    featured: SaavnArtist[];
  };
  release_date: string;
  vcode: string;
  vlink: string;
}

export interface SaavnSong {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  type: string;
  perma_url: string;
  image: string;
  language: string;
  year: string;
  play_count: string;
  isExplicit: boolean;
  more_info: SaavnMoreInfo;
}

export type Quality = '12' | '48' | '96' | '160' | '320';

export interface QualityOption {
  value: Quality;
  label: string;
  tag?: string;
}

export const QUALITY_OPTIONS: QualityOption[] = [
  { value: '12', label: '12 kbps', tag: 'Very Low' },
  { value: '48', label: '48 kbps', tag: 'Low' },
  { value: '96', label: '96 kbps', tag: 'Normal' },
  { value: '160', label: '160 kbps', tag: 'High' },
  { value: '320', label: '320 kbps', tag: 'MAX' },
];

export interface SearchResult {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  type: string;
  perma_url: string;
  image: string;
  language?: string;
  year?: string;
  play_count?: string;
  isExplicit?: boolean;
  more_info?: {
    duration?: string;
    album?: string;
    encrypted_media_url?: string;
  };
}

export function extractArtistFromSubtitle(subtitle: string) {
  return subtitle?.split(' - ')[0]?.trim() || 'Unknown Artist';
}

/**
 * Canonical artist string for a song: the subtitle artist if present,
 * otherwise all primary artists joined. Single source of truth for the
 * artist used in filenames, tags, and multi-artist detection.
 */
export function getSongArtist(song: SaavnSong): string {
  const fromSubtitle = song.subtitle?.split(' - ')[0]?.trim();
  if (fromSubtitle) return fromSubtitle;
  return song.more_info?.artists?.primary?.map((a) => a.name).join(', ') || 'Unknown Artist';
}

/** 500x500 https cover URL for a song (raw CDN url; callers proxy as needed). */
export function getSongCoverUrl(song: SaavnSong): string {
  return song.image.replace(/\d+x\d+/, '500x500').replace('http://', 'https://');
}

/**
 * Normalize a search-style API response into an array. The API sometimes
 * returns a bare array and sometimes wraps it (e.g. { results: [...] }).
 * `keys` lists the wrapper properties to check, in order.
 */
export function asResultsArray<T>(data: unknown, keys: string[] = ['results']): T[] {
  if (Array.isArray(data)) return data as T[];
  const obj = data as Record<string, unknown> | null;
  for (const key of keys) {
    if (Array.isArray(obj?.[key])) return obj![key] as T[];
  }
  return [];
}

export function formatDuration(sec?: string) {
  if (!sec) return '';

  const total = Number(sec);

  const mins = Math.floor(total / 60);
  const secs = total % 60;

  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Image delivery.
 *
 * JioSaavn cover art lives on *.saavncdn.com and already ships in fixed sizes
 * baked into the filename (…-150x150.jpg), so we just swap the size in the URL.
 *
 * Routing mirrors proxyFetch's strategy: when a server is present, images go
 * through our own same-origin /api/proxy so they ride the same VPN path as
 * every other request (and pick up its keep-alive + 7-day image cache). This
 * skips the third-party rthmx.vercel.app/api/image hop entirely — that hop was
 * just passing the already-sized image through, adding a cold-start-prone
 * round trip for no benefit. Same-origin also sidesteps COEP: require-corp,
 * so no crossOrigin attributes are needed.
 *
 * On static deployments (no server) we fall back to the jiosaavn-api image
 * proxy, which sends the CORP header the browser needs under COEP.
 */
const IMAGE_FALLBACK_PROXY = 'https://rthmx.vercel.app/api/image';
// Default jiosaavn-api instance. Replace with your own if you self-host it.

// True once /api/config confirms a server is present. The <img> src builders
// below are synchronous and can't await, so we latch this from the same
// memoized getConfig() the rest of the app uses. It resolves before any image
// renders (data-driven views await getConfig via proxyFetch first); until then
// we take the static fallback, which also works when there's genuinely no server.
let proxyReady = false;
void getConfig().then((cfg) => { proxyReady = cfg !== null; });

function resizeSaavnImage(url: string, size: '50x50' | '150x150' | '500x500'): string {
  const sized = url.replace(/\d+x\d+/, size).replace('http://', 'https://');
  return proxyReady
    ? `/api/proxy?url=${encodeURIComponent(sized)}`
    : `${IMAGE_FALLBACK_PROXY}?url=${encodeURIComponent(sized)}`;
}

export function searchImage(url: string) {
  if (!url) return "";
  return resizeSaavnImage(url, '50x50');
}

export function isSaavnUrl(value: string) {
  return /^https?:\/\/(www\.)?jiosaavn\.com\/.+/i.test(
    value.trim()
  );
}
// ─── Album types ──────────────────────────────────────────────────────────────

export interface AlbumArtist {
  id: string;
  artist_token?: string;
  name: string;
  image?: string;
  perma_url: string;
}

export interface AlbumSearchResult {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  type: 'album';
  perma_url: string;
  image: string;
  language: string;
  year: string;
  play_count: string;
  isExplicit: boolean;
  more_info: {
    song_count: string;
    artists: {
      primary: AlbumArtist[];
      featured: AlbumArtist[];
    };
  };
}

export interface AlbumDetail {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  header_desc: string;
  type: 'album';
  perma_url: string;
  image: string;
  language: string;
  year: string;
  song_count: string;
  isExplicit: boolean;
  copyright: string;
  artists: {
    primary: AlbumArtist[];
    featured: AlbumArtist[];
  };
  songs: SaavnSong[];
}

/** Image URL for a given size — routes through /api/proxy (VPN) when a server is present. */
export function proxyImage(url: string, size: '50x50' | '150x150' | '500x500' = '150x150'): string {
  if (!url) return '';
  return resizeSaavnImage(url, size);
}

/** Alias: album 500x500 cover for the album page */
export function albumImage(url: string): string {
  return proxyImage(url, '500x500');
}

export function isSaavnAlbumUrl(value: string): boolean {
  return /jiosaavn\.com\/album\//i.test(value.trim());
}

/** Total duration from array of songs (in seconds) */
export function totalAlbumDuration(songs: SaavnSong[]): string {
  const total = songs.reduce((acc, s) => acc + parseInt(s.more_info?.duration || '0', 10), 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

// ─── Artist types ─────────────────────────────────────────────────────────────

export interface ArtistSearchResult {
  id: string;
  name: string;
  image: string;
  type: 'artist';
  perma_url: string;
}

export interface ArtistAlbum {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  type: string;
  perma_url: string;
  image: string;
  language: string;
  year: string;
  isExplicit: boolean;
  song_count: string;
  artists: {
    primary: AlbumArtist[];
    featured: AlbumArtist[];
  };
}

export interface ArtistDetail {
  id: string;
  name: string;
  subtitle: string;
  image: string;
  topAlbums: ArtistAlbum[];
  singles: ArtistAlbum[];
  latest_release: ArtistAlbum[];
}

// ─── Playlist types ───────────────────────────────────────────────────────────

export interface PlaylistSearchResult {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  type: 'playlist';
  image: string;
  perma_url: string;
  more_info: {
    firstname?: string;
    artist_name?: string[];
    entity_type?: string;
    song_count?: string;
    language?: string;
  };
}

export interface PlaylistDetail {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  header_desc: string;
  type: 'playlist';
  perma_url: string;
  image: string;
  more_info: {
    firstname?: string;
    subtitle_desc?: string[];
  };
  list_count: string;
  songs: SaavnSong[];
}
