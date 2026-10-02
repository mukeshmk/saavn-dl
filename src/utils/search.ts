import type { SearchResult, SaavnSong } from '../types/saavn';
import { saavnToken } from '../types/saavn';
import { proxyFetch } from './proxy';

const SEARCH_API = 'https://rthmx.vercel.app/api/songs?q=';
// Defalut API (rthmx.vercel.app). Replace with your jiosaavn-api instance.
// Visit https://github.com/ODSkyler/jiosaavn-api for more information.
const SONG_API = 'https://rthmx.vercel.app/api/song';
// Defalut API (rthmx.vercel.app). Replace with your jiosaavn-api instance.

interface SearchApiResponse {
  results: SearchResult[];
}

export async function searchSongs(query: string): Promise<SearchResult[]> {
  const resp = await proxyFetch(
    `${SEARCH_API}${encodeURIComponent(query)}`
  );

  if (!resp.ok) {
    throw new Error(`Search failed (${resp.status})`);
  }

  const data: SearchApiResponse = await resp.json();

  return Array.isArray(data.results)
    ? data.results
    : [];
}

/** Song detail by token or jiosaavn.com song URL. */
export async function fetchSongDetail(tokenOrUrl: string): Promise<SaavnSong> {
  const token = saavnToken(tokenOrUrl);
  if (!token) throw new Error('Could not extract song token from JioSaavn URL');
  const resp = await proxyFetch(`${SONG_API}?token=${encodeURIComponent(token)}`);
  if (!resp.ok) throw new Error((await resp.text().catch(() => '')) || `HTTP ${resp.status}`);
  const data: SaavnSong = await resp.json();
  if (!data?.id || !(data.encrypted_media_url || data.more_info?.encrypted_media_url)) {
    throw new Error('Invalid response — missing required fields');
  }
  return data;
}
