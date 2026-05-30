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

export function formatDuration(sec?: string) {
  if (!sec) return '';

  const total = Number(sec);

  const mins = Math.floor(total / 60);
  const secs = total % 60;

  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function searchImage(url: string) {
  if (!url) return "";

  const image50 = url.replace(
    /150x150|500x500/g,
    "50x50"
  );

  return `https://js-odskyler.vercel.app/api/image?url=${encodeURIComponent(image50)}`;
}

export function isSaavnUrl(value: string) {
  return /^https?:\/\/(www\.)?jiosaavn\.com\/.+/i.test(
    value.trim()
  );
}