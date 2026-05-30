import type { SearchResult } from '../types/saavn';

const SEARCH_API = 'https://js-odskyler.vercel.app/api/songs?q=';

interface SearchApiResponse {
  results: SearchResult[];
}

export async function searchSongs(query: string): Promise<SearchResult[]> {
  const resp = await fetch(
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