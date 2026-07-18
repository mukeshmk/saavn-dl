import { motion, AnimatePresence } from 'framer-motion';
import { useDownloadQueue } from './DownloadQueueContext';
import { proxyImage } from '../types/saavn';
import type { QueueItem } from '../utils/downloadQueue';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function DownloadManagerPanel({ isOpen, onClose }: Props) {
  const { items, removeItem, retryItem, clearCompleted } = useDownloadQueue();

  const activeItems = items.filter((i) => i.status === 'downloading');
  const queuedItems = items.filter((i) => i.status === 'queued');
  const completedItems = items.filter((i) => i.status === 'done');
  const failedItems = items.filter((i) => i.status === 'failed');

  const hasCompleted = completedItems.length > 0 || failedItems.length > 0;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-sm border-l border-border bg-[#0a0a0e]/95 backdrop-blur-xl shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="text-base font-display font-bold text-text-primary">Downloads</h2>
                <p className="text-[11px] font-mono text-white/50 mt-0.5">
                  {activeItems.length > 0
                    ? `${activeItems.length} active · ${queuedItems.length} queued`
                    : items.length === 0
                      ? 'No downloads'
                      : `${completedItems.length} completed${failedItems.length > 0 ? ` · ${failedItems.length} failed` : ''}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {hasCompleted && (
                  <button
                    onClick={clearCompleted}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-mono text-white/50 border border-border hover:border-white/20 hover:text-white/70 transition-all"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 text-white/50 hover:text-text-primary transition-colors rounded-lg hover:bg-white/5"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
              {items.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/20 mb-3">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <p className="text-sm font-display text-white/40">No downloads yet</p>
                  <p className="text-[11px] font-mono text-white/25 mt-1">
                    Songs and albums you download will appear here
                  </p>
                </div>
              )}

              {/* Active downloads */}
              {activeItems.map((item) => (
                <DownloadRow key={item.id} item={item} onRemove={removeItem} onRetry={retryItem} />
              ))}

              {/* Queued */}
              {queuedItems.map((item) => (
                <DownloadRow key={item.id} item={item} onRemove={removeItem} onRetry={retryItem} />
              ))}

              {/* Failed */}
              {failedItems.map((item) => (
                <DownloadRow key={item.id} item={item} onRemove={removeItem} onRetry={retryItem} />
              ))}

              {/* Completed */}
              {completedItems.length > 0 && (
                <div className="pt-2">
                  <p className="text-[10px] font-mono text-white/30 uppercase tracking-wider mb-1.5 px-1">Completed</p>
                  {completedItems.map((item) => (
                    <DownloadRow key={item.id} item={item} onRemove={removeItem} onRetry={retryItem} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Individual row ───────────────────────────────────────────────────────────

function DownloadRow({
  item,
  onRemove,
  onRetry,
}: {
  item: QueueItem;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const thumbUrl = proxyImage(item.image, '50x50');

  const statusColor = {
    queued: 'text-white/50',
    downloading: 'text-cyan',
    done: 'text-emerald-400',
    failed: 'text-rose',
  }[item.status];

  const borderColor = {
    queued: 'border-border',
    downloading: 'border-cyan/20',
    done: 'border-emerald-500/20',
    failed: 'border-rose/20',
  }[item.status];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`flex items-center gap-3 p-2.5 rounded-xl border ${borderColor} bg-glass/50 transition-all`}
    >
      {/* Thumbnail */}
      <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-border flex-shrink-0">
        <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
        {item.status === 'downloading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <span className="w-3 h-3 border-2 border-cyan border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {item.status === 'done' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-emerald-400">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}
        {item.status === 'failed' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-rose">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-display font-semibold text-text-primary truncate">
            {item.title}
          </span>
          {item.type === 'album' && (
            <span className="flex-shrink-0 px-1 py-0.5 bg-violet-500/10 border border-violet-500/25 text-violet-300 text-[8px] font-bold font-mono rounded uppercase leading-none">
              Album
            </span>
          )}
        </div>
        <p className="text-[10px] text-white/50 font-body truncate mt-0.5">{item.artist}</p>
        <p className={`text-[10px] font-mono ${statusColor} truncate mt-0.5`}>
          {item.status === 'downloading' ? `${item.stage} · ${Math.round(item.progress)}%` : item.stage}
        </p>

        {/* Progress bar */}
        {item.status === 'downloading' && (
          <div className="mt-1.5 h-1 bg-border rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-cyan"
              animate={{ width: `${item.progress}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
        )}

        {/* Error message */}
        {item.status === 'failed' && item.error && (
          <p className="text-[9px] font-mono text-rose/70 mt-0.5 truncate">{item.error}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        {item.status === 'failed' && (
          <button
            onClick={() => onRetry(item.id)}
            className="p-1.5 rounded-lg text-cyan hover:bg-cyan/10 transition-all"
            title="Retry"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        )}
        {item.status !== 'downloading' && (
          <button
            onClick={() => onRemove(item.id)}
            className="p-1.5 rounded-lg text-white/40 hover:text-rose hover:bg-rose/10 transition-all"
            title="Remove"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </motion.div>
  );
}
