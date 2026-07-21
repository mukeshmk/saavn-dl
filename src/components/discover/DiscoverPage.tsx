import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { proxyImage } from '../../types/saavn';
import type { PlaylistDetail, AlbumDetail } from '../../types/saavn';
import { fetchHomeFeed, fetchNewReleases, fetchRelatedAlbums, fetchArtistPlaylists, getPersonalizationData } from '../../utils/discover';
import type { HomeFeedSection, DiscoverAlbum, DiscoverPlaylist } from '../../utils/discover';
import { fetchPlaylistDetail } from '../../utils/playlist';
import { fetchAlbumDetail } from '../../utils/album';

interface Props {
  onPlaylistSelect: (playlist: PlaylistDetail) => void;
  onAlbumSelect: (album: AlbumDetail) => void;
}

export default function DiscoverPage({
  onPlaylistSelect,
  onAlbumSelect,
}: Props) {
  const [homeSections, setHomeSections] = useState<HomeFeedSection[]>([]);
  const [newReleases, setNewReleases] = useState<DiscoverAlbum[]>([]);
  const [relatedAlbums, setRelatedAlbums] = useState<DiscoverAlbum[]>([]);
  const [artistPlaylists, setArtistPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItem, setLoadingItem] = useState<string | null>(null);

  // Fetch data on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      // Get personalization data from history
      const { languages, lastAlbumId, frequentArtistTokens } = await getPersonalizationData();
      const langs = languages.length > 0 ? languages : undefined;

      // Fire all requests in parallel
      const [home, releases, related, playlists] = await Promise.allSettled([
        fetchHomeFeed(langs),
        fetchNewReleases(langs),
        lastAlbumId ? fetchRelatedAlbums(lastAlbumId) : Promise.resolve([]),
        frequentArtistTokens.length > 0
          ? fetchArtistPlaylists(frequentArtistTokens[0])
          : Promise.resolve([]),
      ]);

      if (cancelled) return;

      if (home.status === 'fulfilled') setHomeSections(home.value);
      if (releases.status === 'fulfilled') setNewReleases(releases.value);
      if (related.status === 'fulfilled') setRelatedAlbums(related.value);
      if (playlists.status === 'fulfilled') setArtistPlaylists(playlists.value);

      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Item click handlers ─────────────────────────────────────────────────

  const handlePlaylistClick = async (item: DiscoverPlaylist) => {
    const token = item.token || item.id;
    setLoadingItem(item.id);
    try {
      const detail = await fetchPlaylistDetail(token);
      onPlaylistSelect(detail);
    } catch (err) {
      console.error('Failed to load playlist:', err);
    } finally {
      setLoadingItem(null);
    }
  };

  const handleAlbumClick = async (item: DiscoverAlbum) => {
    const url = item.perma_url || item.album_url;
    if (!url) {
      console.warn('No URL for album:', item.title, item);
      return;
    }
    setLoadingItem(item.id);
    try {
      const detail = await fetchAlbumDetail(url);
      onAlbumSelect(detail);
    } catch (err) {
      console.error('Failed to load album:', err);
    } finally {
      setLoadingItem(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }

  const hasContent = homeSections.length > 0 || newReleases.length > 0 || relatedAlbums.length > 0 || artistPlaylists.length > 0;

  if (!hasContent) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center py-16">
        <p className="text-3xl mb-3">🎵</p>
        <p className="text-sm font-display font-semibold text-text-secondary">Nothing to discover yet</p>
        <p className="text-xs font-mono text-text-muted mt-1.5">Download some music and suggestions will appear here</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="space-y-8"
    >
      {/* Related albums from last download */}
      {relatedAlbums.length > 0 && (
        <DiscoverRow
          title="More Like Your Last Download"
          items={relatedAlbums}
          type="album"
          loadingItem={loadingItem}
          onAlbumClick={handleAlbumClick}
          onPlaylistClick={handlePlaylistClick}
        />
      )}

      {/* Artist playlists */}
      {artistPlaylists.length > 0 && (
        <DiscoverRow
          title="Based on Your Artists"
          items={artistPlaylists}
          type="playlist"
          loadingItem={loadingItem}
          onAlbumClick={handleAlbumClick}
          onPlaylistClick={handlePlaylistClick}
        />
      )}

      {/* New releases */}
      {newReleases.length > 0 && (
        <DiscoverRow
          title="New Releases"
          items={newReleases}
          type="album"
          loadingItem={loadingItem}
          onAlbumClick={handleAlbumClick}
          onPlaylistClick={handlePlaylistClick}
        />
      )}

      {/* Home feed sections */}
      {homeSections.map((section, idx) => (
        <DiscoverRow
          key={`${section.title}-${idx}`}
          title={section.title}
          items={section.items}
          type={section.type}
          loadingItem={loadingItem}
          onAlbumClick={handleAlbumClick}
          onPlaylistClick={handlePlaylistClick}
        />
      ))}
    </motion.div>
  );
}

// ─── Horizontal scrollable row ────────────────────────────────────────────────

interface DiscoverRowProps {
  title: string;
  items: (DiscoverAlbum | DiscoverPlaylist)[];
  type: 'album' | 'playlist' | 'mixed';
  loadingItem: string | null;
  onAlbumClick: (item: DiscoverAlbum) => void;
  onPlaylistClick: (item: DiscoverPlaylist) => void;
}

function DiscoverRow({ title, items, type, loadingItem, onAlbumClick, onPlaylistClick }: DiscoverRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) el.addEventListener('scroll', checkScroll, { passive: true });
    return () => { el?.removeEventListener('scroll', checkScroll); };
  }, [items]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.7;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  if (items.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-display font-semibold text-text-primary">{title}</h3>
        <div className="flex items-center gap-1">
          {canScrollLeft && (
            <button onClick={() => scroll('left')} className="w-6 h-6 rounded-full bg-glass border border-border flex items-center justify-center text-text-muted hover:text-white hover:border-white/20 transition-all">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
          )}
          {canScrollRight && (
            <button onClick={() => scroll('right')} className="w-6 h-6 rounded-full bg-glass border border-border flex items-center justify-center text-text-muted hover:text-white hover:border-white/20 transition-all">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable row */}
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.slice(0, 20).map((item) => (
          <DiscoverCard
            key={item.id}
            item={item}
            type={type}
            isLoading={loadingItem === item.id}
            onClick={() => {
              if (item.type === 'playlist') {
                onPlaylistClick(item as DiscoverPlaylist);
              } else {
                onAlbumClick(item as DiscoverAlbum);
              }
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

// ─── Discover card (individual item in a row) ─────────────────────────────────

interface DiscoverCardProps {
  item: DiscoverAlbum | DiscoverPlaylist;
  type: 'album' | 'playlist' | 'mixed';
  isLoading: boolean;
  onClick: () => void;
}

function DiscoverCard({ item, type, isLoading, onClick }: DiscoverCardProps) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const thumbUrl = proxyImage(item.image, '150x150');

  // Extract artist name from various API response shapes
  let artist = '';
  if ('artists' in item && item.artists?.primary?.[0]?.name) {
    artist = item.artists.primary[0].name;
  } else if ('more_info' in item) {
    const mi = item.more_info as any;
    if (mi?.artists && Array.isArray(mi.artists) && mi.artists[0]?.name) {
      artist = mi.artists[0].name;
    } else if (mi?.firstname) {
      artist = mi.firstname;
    }
  }
  if (!artist && item.subtitle) {
    artist = item.subtitle;
  }

  const songCount = 'more_info' in item && (item.more_info as any)?.song_count;
  const isPlaylist = item.type === 'playlist';

  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={`group flex-shrink-0 w-[140px] text-left transition-all duration-200 ${isLoading ? 'opacity-60 cursor-wait' : 'hover:scale-[1.02] active:scale-[0.98]'
        }`}
    >
      {/* Image */}
      <div className="relative w-[140px] h-[140px] rounded-xl overflow-hidden bg-border mb-2">
        {!imgLoaded && !imgError && (
          <div className="absolute inset-0 bg-border animate-pulse" />
        )}
        {!imgError && item.image && (
          <img
            src={thumbUrl}
            alt={item.title}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            className={`w-full h-full object-cover transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
        {(imgError || !item.image) && (
          <div className="w-full h-full flex items-center justify-center text-text-muted/40">
            {isPlaylist ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
              </svg>
            )}
          </div>
        )}
        {/* Loading spinner overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-void/60 flex items-center justify-center">
            <span className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {/* Type badge */}
        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-void/80 border border-border text-[9px] font-mono text-text-muted uppercase">
          {isPlaylist ? 'playlist' : 'album'}
        </div>
      </div>

      {/* Text */}
      <p className="text-[12px] font-display font-semibold text-text-primary leading-tight line-clamp-2 group-hover:text-cyan-300 transition-colors">
        {item.title}
      </p>
      <p className="text-[10px] text-text-muted font-body mt-0.5 truncate">
        {artist}
        {songCount ? ` · ${songCount} songs` : ''}
      </p>
    </button>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function RowSkeleton() {
  const shimmer = {
    background: 'linear-gradient(90deg,#1e1e28 0%,#2a2a38 50%,#1e1e28 100%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.8s ease-in-out infinite',
  };

  return (
    <div>
      <div className="h-4 w-32 rounded mb-3" style={shimmer} />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-[140px]">
            <div className="w-[140px] h-[140px] rounded-xl mb-2" style={shimmer} />
            <div className="h-3 w-24 rounded" style={shimmer} />
            <div className="h-2.5 w-16 rounded mt-1" style={shimmer} />
          </div>
        ))}
      </div>
    </div>
  );
}
