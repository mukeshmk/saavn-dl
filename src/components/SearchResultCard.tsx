import { useState } from 'react';
import { motion } from 'framer-motion';
import type { SearchResult } from '../types/saavn';
import { extractArtistFromSubtitle, formatDuration, searchImage } from '../types/saavn';

interface SearchResultCardProps {
  result: SearchResult;
  index: number;
  onSelect: (result: SearchResult) => void;
  isLoading: boolean;    // this specific card is being re-fetched
  anyLoading: boolean;   // any card in the list is being fetched
}

export default function SearchResultCard({
  result,
  index,
  onSelect,
  isLoading,
  anyLoading,
}: SearchResultCardProps) {
  const [imgError, setImgError] = useState(false);

  const artist   = extractArtistFromSubtitle(result.subtitle);
  const duration = result.more_info?.duration ? formatDuration(result.more_info.duration) : null;
  const imageUrl = searchImage(result.image);

  // Dim other cards while one is loading, but don't make them un-clickable
  const dimmed = anyLoading && !isLoading;

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: dimmed ? 0.45 : 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.035, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => !anyLoading && onSelect(result)}
      disabled={anyLoading}
      className={`group w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 text-left ${
        isLoading
          ? 'border-violet-500/40 bg-violet-500/5 cursor-wait'
          : anyLoading
          ? 'border-border bg-glass cursor-not-allowed'
          : 'border-border bg-glass hover:border-violet-500/40 hover:bg-violet-500/5 cursor-pointer active:scale-[0.99]'
      }`}
    >
      {/* Album art thumbnail */}
      <div className="relative flex-shrink-0 w-11 h-11 rounded-lg overflow-hidden bg-border">
        {/* Image */}
        {!imgError && (
          <img
          src={imageUrl}
          alt={result.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
        )}
        {/* Fallback icon */}
        {imgError && (
          <div className="w-full h-full flex items-center justify-center text-text-muted/40">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
            </svg>
          </div>
        )}

        {/* Loading spinner overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-void/60 rounded-lg flex items-center justify-center">
            <span className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Text block */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-sm font-display font-semibold leading-tight truncate transition-colors duration-150 ${
              isLoading ? 'text-violet-300' : 'text-text-primary group-hover:text-violet-300'
            }`}
          >
            {result.title}
          </span>
          {result.isExplicit && (
            <span className="flex-shrink-0 px-1 py-0.5 bg-rose/10 border border-rose/25 text-rose text-[9px] font-bold font-mono rounded uppercase leading-none">
              E
            </span>
          )}
        </div>
        <p className="text-xs text-text-secondary font-body mt-0.5 truncate">{artist}</p>
      </div>

      {/* Right meta */}
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        {result.year && (
          <span className="text-[11px] font-mono text-text-muted">{result.year}</span>
        )}
        {duration && (
          <span className="text-[11px] font-mono text-text-muted tabular-nums">{duration}</span>
        )}
      </div>
    </motion.button>
  );
}
