import { useState } from 'react';
import { motion } from 'framer-motion';
import type { PlaylistSearchResult } from '../../types/saavn';
import { proxyImage } from '../../types/saavn';

interface Props {
  playlist: PlaylistSearchResult;
  index: number;
  onSelect: (playlist: PlaylistSearchResult) => void;
  isLoading: boolean;
  anyLoading: boolean;
}

export default function PlaylistResultCard({ playlist, index, onSelect, isLoading, anyLoading }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const thumbUrl = proxyImage(playlist.image, '150x150');
  const dimmed = anyLoading && !isLoading;

  const songCount = playlist.more_info?.song_count;
  const curator = playlist.more_info?.firstname || '';

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: dimmed ? 0.45 : 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => !anyLoading && onSelect(playlist)}
      disabled={anyLoading}
      className={`group w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 text-left ${
        isLoading
          ? 'border-cyan-500/40 bg-cyan-500/5 cursor-wait'
          : anyLoading
          ? 'border-border bg-glass cursor-not-allowed'
          : 'border-border bg-glass hover:border-cyan-500/40 hover:bg-cyan-500/5 cursor-pointer active:scale-[0.99]'
      }`}
    >
      {/* Thumbnail */}
      <div className="relative flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-border">
        {!imgLoaded && !imgError && (
          <div className="absolute inset-0 bg-border animate-pulse" />
        )}
        {!imgError && playlist.image && (
          <img
            src={thumbUrl}
            alt={playlist.title}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            className={`w-full h-full object-cover transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
        {(imgError || !playlist.image) && (
          <div className="w-full h-full flex items-center justify-center text-text-muted/40">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
        {/* loading spinner */}
        {isLoading && (
          <div className="absolute inset-0 bg-void/60 flex items-center justify-center">
            <span className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-display font-semibold leading-tight truncate block transition-colors duration-150 ${
          isLoading ? 'text-cyan-300' : 'text-text-primary group-hover:text-cyan-300'
        }`}>
          {playlist.title}
        </span>
        <p className="text-xs text-text-secondary font-body mt-0.5 truncate">
          {curator ? `by ${curator}` : 'Playlist'}
          {songCount ? ` · ${songCount} songs` : ''}
        </p>
      </div>

      {/* Right meta */}
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        {playlist.more_info?.language && (
          <span className="text-[10px] font-mono text-text-muted/70 uppercase">{playlist.more_info.language}</span>
        )}
      </div>

      {/* Arrow */}
      <div className="flex-shrink-0 text-text-muted group-hover:text-cyan-400 transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </motion.button>
  );
}
