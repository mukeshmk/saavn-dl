import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { proxyImage, formatDuration, extractArtistFromSubtitle } from '../types/saavn';
import type { Quality } from '../types/saavn';
import QualitySelector from './QualitySelector';
import {
  importYoutube,
  commitImport,
  searchImportCandidates,
  type ImportEntry,
  type CommitResult,
  type CommitSelection,
} from '../utils/youtubeImport';

interface YouTubeImportModalProps {
  url: string;
  onClose: () => void;
  onComplete: (result: CommitResult) => void;
}

type Phase = 'loading' | 'review' | 'committing' | 'done' | 'error';

const SKIP = -1;

/**
 * Default candidate for a track: prefer one that's already in the library
 * (exact match you already have → added immediately, no re-download), otherwise
 * fall back to the similarity-based suggestion. SKIP when there are no matches.
 */
function pickDefault(candidates: { downloaded?: boolean }[], suggestedIndex: number): number {
  if (candidates.length === 0) return SKIP;
  const owned = candidates.findIndex((c) => c.downloaded);
  if (owned >= 0) return owned;
  return Math.max(0, suggestedIndex);
}

function defaultName(): string {
  const d = new Date();
  return `YouTube Import ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function YouTubeImportModal({ url, onClose, onComplete }: YouTubeImportModalProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [entries, setEntries] = useState<ImportEntry[]>([]);
  const [max, setMax] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  // Per-entry: selected candidate index (or SKIP), the editable query, and a searching flag.
  const [choices, setChoices] = useState<number[]>([]);
  const [queries, setQueries] = useState<string[]>([]);
  const [searchingIdx, setSearchingIdx] = useState<number | null>(null);
  // Per-entry transient search feedback (e.g. "No matches", "Search failed").
  const [searchMsg, setSearchMsg] = useState<Record<number, string>>({});
  const [playlistName, setPlaylistName] = useState(defaultName());
  const [quality, setQuality] = useState<Quality>('320');
  const [result, setResult] = useState<CommitResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    importYoutube(url)
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries);
        setMax(data.max);
        setTruncated(data.truncated);
        setChoices(data.entries.map((e) => pickDefault(e.candidates, e.suggestedIndex)));
        setQueries(data.entries.map((e) => e.query || e.youtube.title));
        setPhase('review');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Import failed');
        setPhase('error');
      });
    return () => { cancelled = true; };
  }, [url]);

  const selectedCount = choices.filter((c) => c !== SKIP).length;

  const setChoice = (i: number, val: number) =>
    setChoices((prev) => prev.map((c, idx) => (idx === i ? val : c)));

  const setMsg = (i: number, msg: string) => setSearchMsg((prev) => ({ ...prev, [i]: msg }));
  const clearMsg = (i: number) => setSearchMsg((prev) => { const n = { ...prev }; delete n[i]; return n; });

  // Re-run the search for one track using its (possibly edited) query.
  const refine = useCallback(async (i: number) => {
    const q = (queries[i] || '').trim();
    if (!q || searchingIdx !== null) return;
    setSearchingIdx(i);
    clearMsg(i);
    try {
      const { candidates, suggestedIndex } = await searchImportCandidates(q);
      if (candidates.length === 0) {
        // Keep any existing candidates, but tell the user this query found nothing.
        setMsg(i, 'No matches found for that search.');
        return;
      }
      setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, candidates } : e)));
      setChoice(i, pickDefault(candidates, suggestedIndex));
      setMsg(i, `Updated — ${candidates.length} match${candidates.length === 1 ? '' : 'es'} found.`);
    } catch (err) {
      setMsg(i, err instanceof Error ? `Search failed: ${err.message}` : 'Search failed — try again.');
    } finally {
      setSearchingIdx(null);
    }
  }, [queries, searchingIdx]);

  const handleConfirm = useCallback(async () => {
    if (!playlistName.trim() || selectedCount === 0) return;
    setPhase('committing');
    setError('');

    const selections: CommitSelection[] = [];
    entries.forEach((entry, i) => {
      const ci = choices[i];
      if (ci === SKIP) return;
      const cand = entry.candidates[ci];
      if (!cand) return;
      selections.push({
        saavnId: cand.id,
        token: cand.token,
        permaUrl: cand.perma_url,
        title: cand.title,
        artist: extractArtistFromSubtitle(cand.subtitle),
      });
    });

    try {
      const res = await commitImport({ playlistName: playlistName.trim(), quality, selections });
      setResult(res);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed');
      setPhase('review');
    }
  }, [entries, playlistName, quality, choices, selectedCount]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-3 sm:px-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-3xl rounded-2xl sm:rounded-3xl border border-white/10 bg-black/90 backdrop-blur-xl p-4 sm:p-8 shadow-2xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div>
            <h3 className="text-base sm:text-2xl font-display font-bold text-text-primary">Import from YouTube</h3>
            <p className="text-[11px] sm:text-sm font-mono text-text-muted mt-0.5 sm:mt-1">Review matches before downloading</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-white transition-colors text-xl sm:text-2xl leading-none p-1">✕</button>
        </div>

        {/* ── Loading ── */}
        {phase === 'loading' && (
          <div className="flex flex-col items-center justify-center py-14 sm:py-20 gap-3 sm:gap-4">
            <span className="w-6 h-6 sm:w-8 sm:h-8 border-2 border-cyan border-t-transparent rounded-full animate-spin" />
            <p className="text-xs sm:text-sm font-mono text-text-muted">Extracting playlist &amp; matching tracks…</p>
          </div>
        )}

        {/* ── Error ── */}
        {phase === 'error' && (
          <div className="py-10 sm:py-14 text-center">
            <p className="text-xs sm:text-sm font-mono text-rose/80">{error}</p>
            <button onClick={onClose} className="mt-4 sm:mt-5 px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl text-xs sm:text-sm font-display font-semibold text-text-muted hover:text-text-secondary transition-colors">
              Close
            </button>
          </div>
        )}

        {/* ── Done ── */}
        {phase === 'done' && result && (
          <div className="py-10 sm:py-12 text-center space-y-4 sm:space-y-5">
            <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto rounded-full bg-cyan/15 border border-cyan/30 flex items-center justify-center text-cyan text-2xl sm:text-3xl">✓</div>
            <div className="space-y-1 sm:space-y-1.5">
              <p className="text-base sm:text-lg font-display font-semibold text-text-primary">Playlist created</p>
              <p className="text-xs sm:text-sm font-mono text-text-muted">
                {result.addedNow} added now · {result.queued} downloading{result.failed.length > 0 ? ` · ${result.failed.length} failed` : ''}
              </p>
              {result.queued > 0 && (
                <p className="text-[10px] sm:text-xs font-mono text-text-muted/70 pt-1">
                  Queued tracks appear in the playlist as their downloads complete.
                </p>
              )}
            </div>
            <button
              onClick={() => onComplete(result)}
              className="px-5 py-2.5 sm:px-6 sm:py-3 rounded-xl text-xs sm:text-sm font-display font-semibold bg-cyan/15 text-cyan border border-cyan/30 hover:bg-cyan/25 transition-all"
            >
              Go to Playlists
            </button>
          </div>
        )}

        {/* ── Review ── */}
        {(phase === 'review' || phase === 'committing') && (
          <>
            {/* Playlist name + quality */}
            <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-5">
              <div>
                <label className="text-[10px] sm:text-xs font-mono text-text-muted uppercase tracking-wider">Playlist name</label>
                <input
                  type="text"
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                  className="mt-1 sm:mt-1.5 w-full px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl border border-border bg-surface text-xs sm:text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-cyan/40"
                />
              </div>
              <div>
                <label className="text-[10px] sm:text-xs font-mono text-text-muted uppercase tracking-wider">Quality</label>
                <div className="mt-1 sm:mt-1.5"><QualitySelector selected={quality} onChange={setQuality} /></div>
              </div>
            </div>

            {truncated && (
              <div className="mb-3 sm:mb-4 px-3 py-2 sm:px-4 sm:py-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-[10px] sm:text-xs font-mono text-amber-400/80">
                Capped at {max} tracks (radio mixes are an endless, non-deterministic snapshot).
              </div>
            )}

            {/* Entry list */}
            <div className="flex-1 overflow-y-auto min-h-0 space-y-2 sm:space-y-3 pr-1">
              {entries.length === 0 && (
                <p className="text-xs sm:text-sm font-mono text-text-muted/60 italic py-8 text-center">No tracks found.</p>
              )}
              {entries.map((entry, i) => (
                <div key={entry.youtube.videoId + i} className="rounded-xl sm:rounded-2xl border border-border bg-surface/50 p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-2 mb-2 sm:mb-3">
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-semibold text-text-primary truncate">{entry.youtube.title}</p>
                      <p className="text-[10px] sm:text-xs font-mono text-text-muted truncate mt-0.5">
                        {entry.youtube.uploader || 'YouTube'}{entry.youtube.duration ? ` · ${formatDuration(String(entry.youtube.duration))}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Refine search — combine title with artist/album, etc. */}
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
                    <input
                      type="text"
                      value={queries[i] ?? ''}
                      onChange={(e) => setQueries((prev) => prev.map((q, idx) => (idx === i ? e.target.value : q)))}
                      onKeyDown={(e) => { if (e.key === 'Enter') refine(i); }}
                      placeholder="Refine search — add artist or album…"
                      className="flex-1 min-w-0 px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-xl border border-border bg-surface text-xs sm:text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-cyan/40"
                    />
                    <button
                      onClick={() => refine(i)}
                      disabled={searchingIdx !== null || !(queries[i] || '').trim()}
                      className="px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs sm:text-sm font-display font-semibold border border-border text-text-secondary hover:border-cyan/40 hover:text-cyan transition-all disabled:opacity-40 flex items-center gap-1.5"
                    >
                      {searchingIdx === i
                        ? <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 border border-current border-t-transparent rounded-full animate-spin" />
                        : 'Search'}
                    </button>
                  </div>

                  {searchMsg[i] && (
                    <p className={`text-[10px] sm:text-xs font-mono mb-2 ${searchMsg[i].startsWith('Updated') ? 'text-emerald-400/80' : 'text-amber-400/80'}`}>
                      {searchMsg[i]}
                    </p>
                  )}

                  {entry.candidates.length === 0 ? (
                    <p className="text-[10px] sm:text-xs font-mono text-rose/70">No JioSaavn match — refine the search above, or it will be skipped.</p>
                  ) : (
                    <div className="space-y-1 sm:space-y-1.5">
                      {entry.candidates.map((cand, ci) => (
                        <label key={cand.id} className="flex items-center gap-2.5 sm:gap-3 cursor-pointer py-1 px-1 rounded-lg hover:bg-white/5 transition-colors">
                          <input
                            type="radio"
                            name={`entry-${i}`}
                            checked={choices[i] === ci}
                            onChange={() => setChoice(i, ci)}
                            className="accent-cyan flex-shrink-0 w-3.5 h-3.5 sm:w-4 sm:h-4"
                          />
                          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-lg overflow-hidden flex-shrink-0 bg-surface">
                            {cand.image
                              ? <img src={proxyImage(cand.image, '150x150')} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              : <div className="w-full h-full flex items-center justify-center text-sm text-text-muted">♪</div>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs sm:text-sm font-semibold text-text-primary truncate flex items-center gap-1.5">
                              <span className="truncate">{cand.title}</span>
                              {cand.downloaded && (
                                <span className="flex-shrink-0 text-[9px] sm:text-[10px] font-mono px-1 py-0.5 sm:px-1.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                  ✓ in library
                                </span>
                              )}
                            </p>
                            <p className="text-[10px] sm:text-xs text-text-muted truncate mt-0.5">{cand.subtitle}</p>
                          </div>
                          {cand.more_info?.duration && (
                            <span className="text-[10px] sm:text-xs font-mono text-text-muted flex-shrink-0">{formatDuration(cand.more_info.duration)}</span>
                          )}
                        </label>
                      ))}
                      {/* Skip option */}
                      <label className="flex items-center gap-2.5 sm:gap-3 cursor-pointer py-1 px-1 rounded-lg hover:bg-white/5 transition-colors">
                        <input
                          type="radio"
                          name={`entry-${i}`}
                          checked={choices[i] === SKIP}
                          onChange={() => setChoice(i, SKIP)}
                          className="accent-rose flex-shrink-0 w-3.5 h-3.5 sm:w-4 sm:h-4"
                        />
                        <span className="text-xs sm:text-sm font-mono text-text-muted">Skip this track</span>
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {error && (
              <div className="mt-3 sm:mt-4 px-3 py-2 sm:px-4 sm:py-3 rounded-xl border border-rose/20 bg-rose/5 text-xs sm:text-sm font-mono text-rose/80">{error}</div>
            )}

            {/* Footer */}
            <div className="mt-4 pt-3 sm:mt-5 sm:pt-4 border-t border-border flex items-center justify-between gap-2">
              <span className="text-[10px] sm:text-xs font-mono text-text-muted">{selectedCount} of {entries.length} selected</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl text-xs sm:text-sm font-display font-semibold text-text-muted hover:text-text-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={phase === 'committing' || !playlistName.trim() || selectedCount === 0}
                  className="px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl text-xs sm:text-sm font-display font-semibold bg-cyan/15 text-cyan border border-cyan/30 hover:bg-cyan/25 transition-all disabled:opacity-50"
                >
                  {phase === 'committing' ? 'Creating…' : `Import ${selectedCount} track${selectedCount === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
