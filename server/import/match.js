/**
 * YouTube-entry → JioSaavn-song matching.
 *
 * `cleanTitle` turns a noisy YouTube title into a search query; `searchJioSaavn`
 * runs that query against the JioSaavn search API THROUGH the server-side
 * allowlisted fetcher (VPN egress — never a browser/client fetch); `rankCandidates`
 * scores the results by normalized title similarity (with light artist + duration
 * weighting) and picks a suggested match. The review step in the UI is the
 * correctness backstop for the fuzzy result.
 */

import { fetchAllowed } from '../downloads/fetcher.js';
import { createLogger } from '../log.js';

const log = createLogger('import/match');

// Mirrors SEARCH_API in src/utils/search.ts. Host (*.vercel.app) is on the
// shared allowlist, so fetchAllowed can reach it over the VPN.
const SEARCH_API = 'https://rthmx.vercel.app/api/songs?q=';

const TOP_N = 5;

// ─── Title cleaning ─────────────────────────────────────────────────────────

// Standalone (unbracketed) noise phrases commonly appended to YouTube titles.
const NOISE_WORDS =
  /\b(official\s*(music\s*)?video|official\s*audio|lyric(al)?(\s*video)?|full\s*video(\s*song)?|full\s*song|video\s*song|audio|hd|4k|mv)\b/gi;

/**
 * Strip YouTube noise from a raw video title, yielding a search query.
 * Removes bracketed junk, channel/label tags after a pipe, ft./feat. clauses,
 * standalone noise words, and emojis/symbols.
 */
export function cleanTitle(raw) {
  let s = String(raw || '');
  // Drop emojis and pictographic symbols.
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F]/gu, ' ');
  // Remove bracketed/parenthesized groups: (...), [...], {...}.
  s = s.replace(/[([{][^)\]}]*[)\]}]/g, ' ');
  // Channel/label tags usually follow a pipe — keep only the first segment.
  s = s.split('|')[0];
  // Remove "ft./feat. …" to the end.
  s = s.replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ');
  // Remove standalone noise words that weren't bracketed.
  s = s.replace(NOISE_WORDS, ' ');
  // Strip stray quotes.
  s = s.replace(/["'`\u2018\u2019\u201C\u201D]/g, ' ');
  // Collapse whitespace and trim dangling separators.
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/^\s*[-–—:]\s*/, '').replace(/\s*[-–—:]\s*$/, '').trim();
  return s;
}

// ─── Scoring (pure) ─────────────────────────────────────────────────────────

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(str) {
  return new Set(normalize(str).split(' ').filter(Boolean));
}

/** Jaccard similarity over word tokens (0..1). */
function jaccard(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Artist portion of a candidate's "Artist - Album" subtitle. */
function candidateArtist(cand) {
  return (cand?.subtitle || '').split(' - ')[0] || '';
}

/**
 * Score a candidate against a YouTube entry.
 * Title similarity dominates; the uploader/artist and duration proximity nudge
 * ties. Returns a number (higher = better).
 */
export function scoreCandidate(entry, cand) {
  const cleaned = cleanTitle(entry.title);
  let score = jaccard(cleaned, cand.title || '');

  // Light artist weighting: the YouTube uploader often is (or contains) the artist.
  const artistSim = jaccard(entry.uploader || '', candidateArtist(cand));
  score += artistSim * 0.3;

  // Duration proximity (both known): reward close matches.
  const yd = Number(entry.duration) || 0;
  const cd = Number(cand.more_info?.duration) || 0;
  if (yd > 0 && cd > 0) {
    const diff = Math.abs(yd - cd);
    if (diff <= 3) score += 0.15;
    else if (diff <= 10) score += 0.08;
    else if (diff > 30) score -= 0.1;
  }
  return score;
}

/** Trim a raw search result to the lean shape the review UI + commit need. */
function projectCandidate(c) {
  return {
    id: c.id,
    token: c.token,
    title: c.title,
    subtitle: c.subtitle,
    perma_url: c.perma_url,
    image: c.image,
    year: c.year,
    language: c.language,
    more_info: { album: c.more_info?.album, duration: c.more_info?.duration },
  };
}

/**
 * Rank candidates for an entry, returning the top-N (best first) and the
 * suggested index (0 when there's a match, -1 when there are none).
 */
export function rankCandidates(entry, candidates, topN = TOP_N) {
  const scored = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && c.id)
    .map((c) => ({ c, s: scoreCandidate(entry, c) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, topN);

  return {
    candidates: scored.map((x) => projectCandidate(x.c)),
    suggestedIndex: scored.length > 0 ? 0 : -1,
  };
}

// ─── Network (VPN egress via fetchAllowed) ──────────────────────────────────

/**
 * Search JioSaavn for a query through the server-side allowlisted fetcher.
 * @returns {Promise<object[]>} raw search results
 */
export async function searchJioSaavn(query, { signal } = {}) {
  const buf = await fetchAllowed(`${SEARCH_API}${encodeURIComponent(query)}`, { signal });
  let data;
  try {
    data = JSON.parse(buf.toString('utf-8'));
  } catch {
    return [];
  }
  return Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
}

/**
 * Search JioSaavn with a free-text query (title + artist/album, whatever the
 * user typed) and rank the results against that query. Used by the review
 * step's per-track "refine search" box.
 * @returns {Promise<{ candidates: object[], suggestedIndex: number }>}
 */
export async function searchCandidates(query, { signal } = {}) {
  const results = await searchJioSaavn(query, { signal });
  return rankCandidates({ title: query, uploader: '', duration: 0 }, results);
}

/**
 * Match a single YouTube entry: clean → search → rank.
 * @returns {Promise<{ query: string, candidates: object[], suggestedIndex: number }>}
 */
export async function matchEntry(entry, { signal } = {}) {
  const query = cleanTitle(entry.title) || String(entry.title || '').trim();
  if (!query) return { query: '', candidates: [], suggestedIndex: -1 };
  try {
    const results = await searchJioSaavn(query, { signal });
    return { query, ...rankCandidates(entry, results) };
  } catch (err) {
    log.warn('match failed for "%s": %s', query, err.message);
    return { query, candidates: [], suggestedIndex: -1 };
  }
}
