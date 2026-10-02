import type { AlbumSearchResult, AlbumDetail, SaavnSong, SaavnMoreInfo } from '../types/saavn';
import { asResultsArray, saavnToken } from '../types/saavn';
import { proxyFetch } from './proxy';

const SEARCH_API = 'https://rthmx.vercel.app/api/albums';
// Defalut API (rthmx.vercel.app). Replace with your jiosaavn-api instance.
// Visit https://github.com/ODSkyler/jiosaavn-api for more information.
const DETAIL_API = 'https://rthmx.vercel.app/api/album';
// Defalut API (rthmx.vercel.app). Replace with your jiosaavn-api instance.
// Visit https://github.com/ODSkyler/jiosaavn-api for more information.

// The token API returns album tracks flatter than /api/song (top-level
// encrypted_media_url/artists/duration, track_url instead of perma_url).
type RawAlbumSong = Omit<SaavnSong, 'more_info'> & {
  track_url?: string;
  duration?: string;
  artists?: SaavnMoreInfo['artists'];
  more_info?: Partial<SaavnMoreInfo> & { copyright?: string };
};
type RawAlbum = Omit<AlbumDetail, 'songs'> & { album_url?: string; songs: RawAlbumSong[] };

export async function searchAlbums(query: string): Promise<AlbumSearchResult[]> {
  if (!query.trim()) return [];
  const res = await proxyFetch(`${SEARCH_API}?q=${encodeURIComponent(query.trim())}`);
  if (!res.ok) throw new Error(`Album search failed: HTTP ${res.status}`);
  const data = await res.json();
  // normalise — API returns { total, start, results: [...] }
  const arr = asResultsArray<AlbumSearchResult>(data);
  return arr.filter((r) => r.type === 'album' || r.id);
}

/** Album detail by token or jiosaavn.com album URL. */
export async function fetchAlbumDetail(tokenOrUrl: string): Promise<AlbumDetail> {
  const token = saavnToken(tokenOrUrl);
  if (!token) throw new Error('Could not extract album token from JioSaavn URL');
  const res = await proxyFetch(`${DETAIL_API}?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `Album fetch failed: HTTP ${res.status}`);
  }
  const data: RawAlbum = await res.json();
  if (!data?.id || !Array.isArray(data?.songs)) {
    throw new Error('Invalid album response — missing id or songs');
  }
  // Lift album-track fields into the SaavnSong shape the client and server
  // download pipelines expect — normalized once here, not per consumer.
  return {
    ...data,
    perma_url: data.perma_url || data.album_url || '',
    songs: data.songs.map((s) => ({
      ...s,
      perma_url: s.perma_url || s.track_url || '',
      play_count: s.play_count || '0',
      more_info: {
        ...s.more_info,
        album_token: s.more_info?.album_token || data.token,
        artists: s.more_info?.artists || s.artists || { primary: [], featured: [] },
        encrypted_media_url: s.more_info?.encrypted_media_url || s.encrypted_media_url || '',
        duration: s.more_info?.duration || s.duration || '0',
        copyright_text: s.more_info?.copyright_text || s.more_info?.copyright || '',
      } as SaavnMoreInfo,
    })),
  };
}
