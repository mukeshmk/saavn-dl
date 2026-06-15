import { useState } from 'react';
import { motion } from 'framer-motion';
import type { AlbumSearchResult } from '../../types/saavn';
import { proxyImage } from '../../types/saavn';

interface Props {
  album: AlbumSearchResult;
  index: number;
  onSelect: (album: AlbumSearchResult) => void;
  isLoading: boolean;
  anyLoading: boolean;
}

export default function AlbumResultCard({ album, index, onSelect, isLoading, anyLoading }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const primaryArtist = album.more_info?.artists?.primary?.[0]?.name
    || album.subtitle?.split(' - ')[0]?.trim()
    || 'Various Artists';

  const thumbUrl = proxyImage(album.image, '150x150');
  const dimmed   = anyLoading && !isLoading;

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: dimmed ? 0.45 : 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => !anyLoading && onSelect(album)}
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
        {!imgError && (
          <img
            src={thumbUrl}
            alt={album.title}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            className={`w-full h-full object-cover transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
        {imgError && (
          <div className="w-full h-full flex items-center justify-center text-text-muted/40">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
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
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-display font-semibold leading-tight truncate transition-colors duration-150 ${
            isLoading ? 'text-cyan-300' : 'text-text-primary group-hover:text-violet-300'
          }`}>
            {album.title}
          </span>
          {album.isExplicit && (
            <span className="flex-shrink-0 px-1 py-0.5 bg-rose/10 border border-rose/25 text-rose text-[9px] font-bold font-mono rounded uppercase leading-none">E</span>
          )}
        </div>
        <p className="text-xs text-text-secondary font-body mt-0.5 truncate">{primaryArtist}</p>
      </div>

      {/* Right meta */}
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        {album.year && <span className="text-[11px] font-mono text-text-muted">{album.year}</span>}
        {album.more_info?.song_count && (
          <span className="text-[10px] font-mono text-text-muted/70">{album.more_info.song_count} tracks</span>
        )}
      </div>
    </motion.button>
  );
}
