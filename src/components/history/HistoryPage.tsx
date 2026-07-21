import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getHistory, removeFromHistory, clearAllHistory } from '../../utils/history';
import type { HistoryEntry } from '../../utils/history';
import { proxyImage } from '../../types/saavn';

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
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const type = filter === 'all' ? undefined : filter;
      const data = await getHistory(type);
      setEntries(data);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleRemove = async (id: string) => {
    await removeFromHistory(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleClearAll = async () => {
    await clearAllHistory();
    setEntries([]);
    setShowClearConfirm(false);
  };

  const trackCount = entries.filter((e) => e.type === 'track').length;
  const albumCount = entries.filter((e) => e.type === 'album').length;

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
              {entries.length === 0 ? 'No downloads yet' : `${entries.length} item${entries.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {entries.length > 0 && (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="px-3 py-1.5 text-[11px] font-mono rounded-lg border border-rose/20 text-rose/80 hover:bg-rose/10 hover:border-rose/40 transition-all"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Filter tabs */}
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
            {tab === 'all' ? `All (${trackCount + albumCount})` : tab === 'track' ? `Tracks (${trackCount})` : `Albums (${albumCount})`}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
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
      {!loading && entries.length === 0 && (
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
          <p className="text-sm font-display font-semibold text-text-secondary">No downloads recorded</p>
          <p className="text-xs font-mono text-text-muted mt-1.5">
            {filter !== 'all' ? `No ${filter} downloads yet` : 'Downloaded tracks and albums will appear here'}
          </p>
        </motion.div>
      )}

      {/* Entry list */}
      {!loading && entries.length > 0 && (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {entries.map((entry, index) => (
              <HistoryEntryCard
                key={entry.id}
                entry={entry}
                index={index}
                onRemove={handleRemove}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Clear confirmation modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/90 backdrop-blur-xl p-6 shadow-2xl"
            >
              <h3 className="text-base font-display font-bold text-text-primary">Clear all history?</h3>
              <p className="text-xs text-text-muted mt-2">
                This will permanently remove all download history records. This action cannot be undone.
              </p>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 px-4 py-2 rounded-xl border border-border text-sm font-display text-text-secondary hover:text-white hover:border-white/20 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearAll}
                  className="flex-1 px-4 py-2 rounded-xl border border-rose/30 bg-rose/10 text-sm font-display text-rose hover:bg-rose/20 hover:border-rose/50 transition-all"
                >
                  Clear all
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Entry card ───────────────────────────────────────────────────────────────

function HistoryEntryCard({
  entry,
  index,
  onRemove,
}: {
  entry: HistoryEntry;
  index: number;
  onRemove: (id: string) => void;
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
          {isAlbum && entry.songCount > 0 && (
            <>
              <span className="text-text-muted/40">·</span>
              <span className="text-[10px] font-mono text-text-muted">{entry.songCount} tracks</span>
            </>
          )}
        </div>
      </div>

      {/* Date + remove */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] font-mono text-text-muted hidden sm:block">
          {formatDate(entry.downloadedAt)}
        </span>

        {!showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted/50 opacity-0 group-hover:opacity-100 hover:text-rose hover:bg-rose/10 transition-all"
            aria-label="Remove from history"
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
              onClick={() => onRemove(entry.id)}
              className="w-6 h-6 rounded flex items-center justify-center text-rose hover:bg-rose/20 transition-colors"
              aria-label="Confirm remove"
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
