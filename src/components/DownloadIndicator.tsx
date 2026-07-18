import { motion, AnimatePresence } from 'framer-motion';
import { useDownloadQueue } from './DownloadQueueContext';
import { proxyImage } from '../types/saavn';

interface Props {
  onClick: () => void;
}

export default function DownloadIndicator({ onClick }: Props) {
  const { items, totalPending, isProcessing } = useDownloadQueue();

  const activeItem = items.find((i) => i.status === 'downloading');
  const hasItems = items.length > 0;
  const hasFailures = items.some((i) => i.status === 'failed');

  if (!hasItems) return null;

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      onClick={onClick}
      className="fixed top-4 right-4 z-40 flex items-center gap-2.5 px-3 py-2 rounded-xl border border-border bg-surface/90 backdrop-blur-xl shadow-2xl hover:border-cyan/30 hover:bg-surface transition-all duration-200 group"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)' }}
    >
      {/* Active item thumbnail or icon */}
      {activeItem ? (
        <div className="relative w-8 h-8 rounded-lg overflow-hidden bg-border flex-shrink-0">
          <img
            src={proxyImage(activeItem.image, '50x50')}
            alt=""
            className="w-full h-full object-cover"
          />
          {/* Spinning overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="w-3.5 h-3.5 border-2 border-cyan border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      ) : (
        <div className="w-8 h-8 rounded-lg bg-glass border border-border flex items-center justify-center flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>
      )}

      {/* Status text */}
      <div className="hidden sm:block min-w-0 max-w-[140px]">
        {activeItem ? (
          <>
            <p className="text-[11px] font-display font-semibold text-text-primary truncate leading-tight">
              {activeItem.title}
            </p>
            <p className="text-[10px] font-mono text-cyan truncate mt-0.5">
              {activeItem.stage}
            </p>
          </>
        ) : hasFailures ? (
          <p className="text-[11px] font-display font-semibold text-rose">
            Download failed
          </p>
        ) : (
          <p className="text-[11px] font-display font-semibold text-emerald-400">
            Downloads complete
          </p>
        )}
      </div>

      {/* Progress ring (when active) */}
      {isProcessing && activeItem && (
        <div className="relative w-6 h-6 flex-shrink-0">
          <svg className="w-6 h-6 -rotate-90" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" className="text-border" />
            <circle
              cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"
              className="text-cyan"
              strokeDasharray={`${2 * Math.PI * 10}`}
              strokeDashoffset={`${2 * Math.PI * 10 * (1 - activeItem.progress / 100)}`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.4s ease' }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[8px] font-mono text-cyan tabular-nums">
            {Math.round(activeItem.progress)}
          </span>
        </div>
      )}

      {/* Badge count */}
      <AnimatePresence>
        {totalPending > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full bg-cyan text-void text-[10px] font-mono font-bold"
          >
            {totalPending}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
