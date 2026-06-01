import { motion, AnimatePresence } from 'framer-motion';
import type { SearchResult } from '../types/saavn';
import SearchResultCard from '../components/SearchResultCard';

interface SearchResultsProps {
  results: SearchResult[];
  query: string;
  isSearching: boolean;
  fetchingId: string | null;
  onSelect: (result: SearchResult) => void;
  error: string;
}

export default function SearchResults({
  results,
  query,
  isSearching,
  fetchingId,
  onSelect,
  error,
}: SearchResultsProps) {
  // While a result is being fetched, show the results grid normally
  // (the individual card shows its own spinner)
  const isFetchingResult = fetchingId !== null && results.length > 0;

  return (
    <AnimatePresence mode="wait">

      {/* ── Searching skeleton ──────────────────────────────────────────── */}
      {isSearching && (
        <motion.div
          key="searching"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="space-y-2"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <span className="text-[11px] font-mono text-white/60 truncate">
              Searching for "{query}"…
            </span>
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <SearchSkeleton key={i} delay={i * 0.055} />
          ))}
        </motion.div>
      )}

      {/* ── Search API error ───────────────────────────────────────────── */}
      {!isSearching && error && results.length === 0 && (
        <motion.div
          key="error"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="flex items-start gap-3 p-4 rounded-xl border border-rose/20 bg-rose/5"
        >
          <div className="w-7 h-7 rounded-lg bg-rose/10 border border-rose/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ff6b8a" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-display font-semibold text-rose">Search failed</p>
            <p className="text-xs font-mono text-rose/70 mt-0.5">{error}</p>
          </div>
        </motion.div>
      )}

      {/* ── No results ─────────────────────────────────────────────────── */}
      {!isSearching && !error && results.length === 0 && query && (
        <motion.div
          key="empty"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="text-center py-12"
        >
          <p className="text-3xl mb-3">🎵</p>
          <p className="text-sm font-display font-semibold text-white/80">
            No results for "{query}"
          </p>
          <p className="text-xs font-mono text-white/60 mt-1.5">Try different keywords</p>
        </motion.div>
      )}

      {/* ── Results grid ───────────────────────────────────────────────── */}
      {!isSearching && results.length > 0 && (
        <motion.div
          key="results"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Header row */}
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-between mb-3"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-mono text-white/60 uppercase tracking-wider flex-shrink-0">
                Results for
              </span>
              <span className="text-[11px] font-mono text-cyan truncate">
                "{query}"
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isFetchingResult && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-[11px] font-mono text-violet-400/70 flex items-center gap-1"
                >
                  <span className="w-2.5 h-2.5 border border-violet-400 border-t-transparent rounded-full animate-spin inline-block" />
                  Loading…
                </motion.span>
              )}
              <span className="text-[11px] font-mono text-text-muted">
                {results.length} songs
              </span>
            </div>
          </motion.div>

          {/* Cards — 1 col mobile, 2 col md+ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {results.map((r, i) => (
              <SearchResultCard
                key={r.id}
                result={r}
                index={i}
                onSelect={onSelect}
                isLoading={fetchingId === r.id}
                anyLoading={isFetchingResult}
              />
            ))}
          </div>
        </motion.div>
      )}

    </AnimatePresence>
  );
}

// ─── Shimmer skeleton card ────────────────────────────────────────────────────

function SearchSkeleton({ delay }: { delay: number }) {
  const shimmer = {
    background: 'linear-gradient(90deg,#1e1e28 0%,#2a2a38 50%,#1e1e28 100%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.8s ease-in-out infinite',
  };
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay }}
      className="flex items-center gap-3 p-3 rounded-xl border border-border bg-glass"
    >
      <div className="w-11 h-11 rounded-lg flex-shrink-0" style={shimmer} />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 rounded w-3/5" style={shimmer} />
        <div className="h-3 rounded w-2/5" style={shimmer} />
      </div>
      <div className="h-3 w-9 rounded" style={shimmer} />
    </motion.div>
  );
}
