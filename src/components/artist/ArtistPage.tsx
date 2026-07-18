import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ArtistDetail, ArtistAlbum } from '../../types/saavn';
import { proxyImage } from '../../types/saavn';

interface Props {
  artist: ArtistDetail;
  onBack?: () => void;
  onAlbumSelect: (albumUrl: string) => void;
}

export default function ArtistPage({ artist, onBack, onAlbumSelect }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [activeTab, setActiveTab] = useState<'albums' | 'singles' | 'latest'>('albums');

  const coverUrl = proxyImage(artist.image, '500x500');

  const tabData: Record<string, ArtistAlbum[]> = {
    albums: artist.topAlbums,
    singles: artist.singles,
    latest: artist.latest_release,
  };

  const currentList = tabData[activeTab] || [];

  // Parse listener count from subtitle like "Artist • 10755399 Listeners"
  const listenerMatch = artist.subtitle?.match(/([\d,]+)\s*Listeners/i);
  const listeners = listenerMatch
    ? Number(listenerMatch[1].replace(/,/g, '')).toLocaleString()
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
      className="w-full"
    >
      {/* ── Back button ─────────────────────────────────────────────────── */}
      {onBack && (
        <motion.button
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={onBack}
          className="mb-4 flex items-center gap-1.5 text-[12px] font-mono text-white/60 hover:text-violet-400 transition-colors group"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            className="group-hover:-translate-x-0.5 transition-transform">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to results
        </motion.button>
      )}

      {/* ── Artist hero ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-glass overflow-hidden" style={{
        boxShadow: '0 0 0 1px rgba(255,255,255,0.04), 0 8px 48px rgba(0,0,0,0.6)'
      }}>
        <div className="p-5">
          <div className="flex gap-5 items-center">
            {/* Artist image */}
            <div className="relative flex-shrink-0 w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden bg-border shadow-lg">
              {!imgLoaded && !imgError && (
                <div className="absolute inset-0 bg-border animate-pulse rounded-full" />
              )}
              {!imgError && artist.image && (
                <img
                  src={coverUrl}
                  alt={artist.name}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgError(true)}
                  className={`w-full h-full object-cover transition-opacity duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
                />
              )}
              {(imgError || !artist.image) && (
                <div className="w-full h-full flex items-center justify-center text-text-muted/40">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
              )}
            </div>

            {/* Artist info */}
            <div className="flex-1 min-w-0">
              <h2 className="text-xl sm:text-2xl font-display font-bold text-text-primary truncate">
                {artist.name}
              </h2>
              {listeners && (
                <p className="text-xs font-mono text-text-muted mt-1">
                  {listeners} listeners
                </p>
              )}
              <p className="text-xs font-mono text-text-muted mt-0.5">
                {artist.topAlbums.length} albums · {artist.singles.length} singles
              </p>
            </div>
          </div>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="border-t border-border px-5 pt-3">
          <div className="flex gap-1">
            {([
              { key: 'albums', label: 'Albums', count: artist.topAlbums.length },
              { key: 'singles', label: 'Singles', count: artist.singles.length },
              { key: 'latest', label: 'Latest', count: artist.latest_release.length },
            ] as const).filter(t => t.count > 0).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-display font-semibold transition-all duration-150 ${
                  activeTab === tab.key
                    ? 'bg-cyan/10 border border-cyan/40 text-cyan'
                    : 'border border-transparent text-text-muted hover:text-text-secondary hover:border-border'
                }`}
              >
                {tab.label}
                <span className="ml-1.5 text-[10px] opacity-60">{tab.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Album grid ──────────────────────────────────────────────────── */}
        <div className="p-5 pt-4">
          <AnimatePresence mode="wait">
            {currentList.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-8"
              >
                <p className="text-sm text-text-muted font-body">No {activeTab} found</p>
              </motion.div>
            ) : (
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-2 sm:grid-cols-3 gap-3"
              >
                {currentList.map((album, i) => (
                  <ArtistAlbumCard
                    key={album.id || `${album.token}-${i}`}
                    album={album}
                    index={i}
                    onSelect={onAlbumSelect}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Album card within artist page ────────────────────────────────────────────

function ArtistAlbumCard({
  album,
  index,
  onSelect,
}: {
  album: ArtistAlbum;
  index: number;
  onSelect: (url: string) => void;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const thumbUrl = proxyImage(album.image, '150x150');

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.03, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => onSelect(album.perma_url)}
      className="group flex flex-col gap-2 p-2 rounded-xl border border-border bg-glass hover:border-cyan-500/40 hover:bg-cyan-500/5 transition-all duration-200 cursor-pointer active:scale-[0.98] text-left"
    >
      {/* Cover art */}
      <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-border">
        {!imgLoaded && !imgError && (
          <div className="absolute inset-0 bg-border animate-pulse" />
        )}
        {!imgError && album.image && (
          <img
            src={thumbUrl}
            alt={album.title}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            className={`w-full h-full object-cover transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
        {(imgError || !album.image) && (
          <div className="w-full h-full flex items-center justify-center text-text-muted/40">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}
        {album.isExplicit && (
          <span className="absolute top-1.5 right-1.5 px-1 py-0.5 bg-rose/80 text-white text-[8px] font-bold font-mono rounded leading-none">
            E
          </span>
        )}
      </div>

      {/* Text */}
      <div className="min-w-0 px-0.5">
        <p className="text-[12px] font-display font-semibold text-text-primary truncate group-hover:text-cyan-300 transition-colors">
          {album.title}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {album.year && (
            <span className="text-[10px] font-mono text-text-muted">{album.year}</span>
          )}
          {album.song_count && album.song_count !== '0' && (
            <span className="text-[10px] font-mono text-text-muted/70">
              · {album.song_count} tracks
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}
