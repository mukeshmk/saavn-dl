import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getHistory } from '../../utils/history';
import type { HistoryEntry, HistoryQueryParams } from '../../utils/history';
import { proxyImage } from '../../types/saavn';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type FilterTab = 'all' | 'track' | 'album';

// ─── Component ────────────────────────────────────────────────────────────────

interface HistoryPageProps {
  onBack?: () => void;
}

export default function HistoryPage({ onBack }: HistoryPageProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [cleared, setCleared] = useState(false);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0); // reset to first page on new search
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params: HistoryQueryParams = {
        type: filter === 'all' ? undefined : filter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search: debouncedSearch || undefined,
      };
      const data = await getHistory(params);
      setEntries(data.entries);
      setTotal(data.total);
    } catch {
      setEntries([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filter, page, debouncedSearch]);

  useEffect(() => {
    if (cleared) return; // don't fetch if UI is cleared
    loadHistory();
  }, [loadHistory, cleared]);

  // Reset page when filter changes
  useEffect(() => {
    setPage(0);
  }, [filter]);

  const handleClearUI = () => {
    setEntries([]);
    setTotal(0);
    setCleared(true);
  };

  const handleRestore = () => {
    setCleared(false);
    setPage(0);
    // loadHistory will re-run due to cleared changing + effect dependency
  };

  // Re-fetch when cleared changes to false
  useEffect(() => {
    if (!cleared) {
      loadHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleared]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="w-8 h-8 rounded-lg border border-border bg-glass flex items-center justify-center text-text-muted hover:text-white hover:border-white/20 transition-all"
              aria-label="Go back"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <div>
            <h2 className="text-lg font-display font-bold text-text-primary">Download History</h2>
            <p className="text-[11px] font-mono text-text-muted mt-0.5">
              {cleared ? 'History cleared (still in database)' : total === 0 ? 'No downloads yet' : `${total} item${total !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {cleared ? (
            <button
              onClick={handleRestore}
              className="px-3 py-1.5 text-[11px] font-mono rounded-lg border border-cyan/20 text-cyan/80 hover:bg-cyan/10 hover:border-cyan/40 transition-all"
            >
              Restore history
            </button>
          ) : (
            entries.length > 0 && (
              <button
                onClick={handleClearUI}
                className="px-3 py-1.5 text-[11px] font-mono rounded-lg border border-rose/20 text-rose/80 hover:bg-rose/10 hover:border-rose/40 transition-all"
              >
                Clear all
              </button>
            )
          )}
        </div>
      </div>

      {/* Search bar */}
      {!cleared && (
        <div className="relative mb-4">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted/60"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or artist..."
            className="w-full pl-9 pr-4 py-2 text-sm font-body rounded-xl border border-border bg-glass text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-cyan/40 focus:ring-1 focus:ring-cyan/20 transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted/60 hover:text-text-primary transition-colors"
              aria-label="Clear search"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Filter tabs */}
      {!cleared && (
        <div className="flex gap-1 mb-4">
          {(['all', 'track', 'album'] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-display font-semibold capitalize transition-all duration-150 ${filter === tab
                ? 'bg-cyan/10 border border-cyan/30 text-cyan'
                : 'border border-transparent text-text-muted hover:text-text-secondary hover:border-border'
                }`}
            >
              {tab === 'all' ? 'All' : tab === 'track' ? 'Tracks' : 'Albums'}
            </button>
          ))}
        </div>
      )}

      {/* Loading state */}
      {loading && !cleared && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-xl border border-border bg-glass animate-pulse"
            >
              <div className="w-11 h-11 rounded-lg bg-border" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 rounded w-3/5 bg-border" />
                <div className="h-3 rounded w-2/5 bg-border" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !cleared && entries.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-16"
        >
          <div className="text-4xl mb-3">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto text-text-muted/30">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <p className="text-sm font-display font-semibold text-text-secondary">
            {debouncedSearch ? 'No results found' : 'No downloads recorded'}
          </p>
          <p className="text-xs font-mono text-text-muted mt-1.5">
            {debouncedSearch
              ? `Nothing matches "${debouncedSearch}"`
              : filter !== 'all'
                ? `No ${filter} downloads yet`
                : 'Downloaded tracks and albums will appear here'}
          </p>
        </motion.div>
      )}

      {/* Cleared state */}
      {cleared && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-16"
        >
          <div className="text-4xl mb-3">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto text-text-muted/30">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </div>
          <p className="text-sm font-display font-semibold text-text-secondary">History cleared from view</p>
          <p className="text-xs font-mono text-text-muted mt-1.5">
            Your download history is still safely stored in the database.
          </p>
          <button
            onClick={handleRestore}
            className="mt-4 px-4 py-2 text-xs font-display font-semibold rounded-xl border border-cyan/30 text-cyan hover:bg-cyan/10 hover:border-cyan/50 transition-all"
          >
            Restore history
          </button>
        </motion.div>
      )}

      {/* Entry list */}
      {!loading && !cleared && entries.length > 0 && (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {entries.map((entry, index) => (
              <HistoryEntryCard
                key={entry.id}
                entry={entry}
                index={index}
                onHide={(id) => {
                  setEntries((prev) => prev.filter((e) => e.id !== id));
                  setTotal((prev) => prev - 1);
                }}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Pagination */}
      {!loading && !cleared && totalPages > 1 && (
        <div className="flex items-center justify-between mt-5 pt-4 border-t border-border">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 text-[11px] font-mono rounded-lg border border-border text-text-secondary hover:text-white hover:border-white/20 disabled:opacity-30 disabled:pointer-events-none transition-all"
          >
            ← Previous
          </button>

          <span className="text-[11px] font-mono text-text-muted">
            Page {page + 1} of {totalPages}
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 text-[11px] font-mono rounded-lg border border-border text-text-secondary hover:text-white hover:border-white/20 disabled:opacity-30 disabled:pointer-events-none transition-all"
          >
            Next →
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ─── Entry card ───────────────────────────────────────────────────────────────

function HistoryEntryCard({
  entry,
  index,
  onHide,
}: {
  entry: HistoryEntry;
  index: number;
  onHide: (id: string) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const imageUrl = entry.image ? proxyImage(entry.image, '150x150') : '';
  const isAlbum = entry.type === 'album';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
      transition={{ duration: 0.22, delay: index * 0.02, ease: [0.16, 1, 0.3, 1] }}
      className="group flex items-center gap-3 p-3 rounded-xl border border-border bg-glass hover:border-white/10 transition-all duration-200"
    >
      {/* Thumbnail */}
      <div className="relative flex-shrink-0 w-11 h-11 rounded-lg overflow-hidden bg-border">
        {!imgError && imageUrl && (
          <img
            src={imageUrl}
            alt={entry.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        )}
        {(imgError || !imageUrl) && (
          <div className="w-full h-full flex items-center justify-center text-text-muted/40">
            {isAlbum ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </div>
        )}

        {/* Type badge */}
        <div className={`absolute bottom-0 right-0 px-1 py-px text-[8px] font-mono uppercase rounded-tl-md ${isAlbum ? 'bg-violet-500/80 text-white' : 'bg-cyan/80 text-void'
          }`}>
          {isAlbum ? 'LP' : '♪'}
        </div>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-display font-semibold text-text-primary truncate">{entry.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[11px] font-body text-text-secondary truncate">{entry.artist}</span>
          {entry.quality && (
            <>
              <span className="text-text-muted/40">·</span>
              <span className="text-[10px] font-mono text-text-muted">{entry.quality} kbps</span>
            </>
          )}
          {isAlbum && entry.songCount && entry.songCount > 0 && (
            <>
              <span className="text-text-muted/40">·</span>
              <span className="text-[10px] font-mono text-text-muted">{entry.songCount} tracks</span>
            </>
          )}
        </div>
      </div>

      {/* Date + hide */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] font-mono text-text-muted">
          {formatDate(entry.downloadedAt)}
        </span>

        {!showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted/50 opacity-0 group-hover:opacity-100 hover:text-rose hover:bg-rose/10 transition-all"
            aria-label="Hide from history"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowConfirm(false)}
              className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-white transition-colors"
              aria-label="Cancel"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              onClick={() => onHide(entry.id)}
              className="w-6 h-6 rounded flex items-center justify-center text-rose hover:bg-rose/20 transition-colors"
              aria-label="Confirm hide"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
