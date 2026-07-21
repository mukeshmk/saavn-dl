import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PlaylistDetail, SaavnSong, Quality } from '../../types/saavn';
import { proxyImage, formatDuration, totalAlbumDuration } from '../../types/saavn';
import AudioPreview from '../AudioPreview';
import DownloadAction from '../DownloadAction';
import MetadataEditor from '../MetadataEditor';
import QualitySelector from '../QualitySelector';
import AlbumDownloadModal from '../album/AlbumDownloadModal';
import type { TrackMetadata } from '../../types/metadata';
import { buildDefaultMetadata, metadataIsModified } from '../../types/metadata';
import type { AlbumDetail } from '../../types/saavn';

interface Props {
  playlist: PlaylistDetail;
  onBack?: () => void;
}

/**
 * Convert a PlaylistDetail into an AlbumDetail-compatible shape
 * so we can reuse AlbumDownloadModal for batch downloads.
 */
function playlistAsAlbum(playlist: PlaylistDetail): AlbumDetail {
  return {
    id: playlist.id,
    token: playlist.token,
    title: playlist.title,
    subtitle: playlist.subtitle,
    header_desc: playlist.header_desc,
    type: 'album',
    perma_url: playlist.perma_url,
    image: playlist.image,
    language: '',
    year: '',
    song_count: playlist.list_count,
    isExplicit: false,
    copyright: '',
    artists: { primary: [], featured: [] },
    songs: playlist.songs,
  };
}

export default function PlaylistPage({ playlist, onBack }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [globalQuality, setGlobalQuality] = useState<Quality>('320');
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const coverUrl = proxyImage(playlist.image, '500x500');
  const totalDur = totalAlbumDuration(playlist.songs);
  const curator = playlist.more_info?.firstname || 'JioSaavn';
  const subtitleParts = playlist.more_info?.subtitle_desc || [];

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
        className="w-full"
      >
        {/* Back button */}
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

        {/* Playlist hero */}
        <div className="rounded-2xl border border-border bg-glass overflow-hidden" style={{
          boxShadow: '0 0 0 1px rgba(255,255,255,0.04), 0 8px 48px rgba(0,0,0,0.6)'
        }}>
          <div className="p-5">
            <div className="flex gap-5 flex-col sm:flex-row">
              {/* Cover art */}
              <div className="relative flex-shrink-0 mx-auto sm:mx-0">
                <div className="w-40 h-40 sm:w-52 sm:h-52 rounded-xl overflow-hidden bg-border">
                  {!imgLoaded && !imgError && (
                    <div className="w-full h-full animate-pulse bg-border" />
                  )}
                  {!imgError && (
                    <img
                      src={coverUrl}
                      alt={playlist.title}
                      onLoad={() => setImgLoaded(true)}
                      onError={() => setImgError(true)}
                      className={`w-full h-full object-cover transition-opacity duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
                    />
                  )}
                  {imgError && (
                    <div className="w-full h-full flex items-center justify-center text-white/30">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>

              {/* Meta */}
              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div>
                  <p className="text-[10px] font-mono text-cyan uppercase tracking-widest mb-1">Playlist</p>
                  <h2 className="text-xl sm:text-2xl font-display font-bold text-text-primary leading-tight">
                    {playlist.title}
                  </h2>
                  <p className="mt-1.5 text-sm text-text-secondary font-body">by {curator}</p>

                  {/* Description */}
                  {playlist.header_desc && (
                    <p className="mt-2 text-xs text-text-muted font-body leading-relaxed line-clamp-2">{playlist.header_desc}</p>
                  )}

                  {/* Meta chips */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <MetaChip icon="🎵" label={`${playlist.list_count} tracks`} />
                    <MetaChip icon="⏱" label={totalDur} />
                    {subtitleParts.length > 0 && subtitleParts.map((part, i) => (
                      <MetaChip key={i} icon="📋" label={part} />
                    ))}
                  </div>
                </div>

                {/* Download button */}
                <div className="mt-4">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setShowModal(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan hover:bg-cyan-dim text-black text-sm font-display font-semibold transition-all duration-200"
                    style={{ boxShadow: '0 0 20px rgba(0,212,255,0.25)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download Playlist
                  </motion.button>
                </div>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-border mx-5" />

          {/* Quality selector */}
          <div className="px-5 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-mono text-white/60 uppercase tracking-wider">Track Quality</span>
            <QualitySelector selected={globalQuality} onChange={setGlobalQuality} />
          </div>

          <div className="h-px bg-border mx-5" />

          {/* Track list */}
          <div className="px-3 py-3 space-y-0.5">
            {playlist.songs.map((song, index) => (
              <TrackRow
                key={song.id}
                song={song}
                index={index}
                quality={globalQuality}
                isExpanded={expandedId === song.id}
                onToggle={() => setExpandedId(prev => prev === song.id ? null : song.id)}
              />
            ))}
          </div>

          {/* Footer */}
          {playlist.perma_url && (
            <div className="px-5 py-3 border-t border-border">
              <a
                href={playlist.perma_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[11px] font-mono text-white/60 hover:text-violet-400 transition-colors w-fit"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Open on JioSaavn
              </a>
            </div>
          )}
        </div>
      </motion.div>

      {/* Download modal — reuses AlbumDownloadModal by converting playlist to album shape */}
      <AnimatePresence>
        {showModal && (
          <AlbumDownloadModal album={playlistAsAlbum(playlist)} onClose={() => setShowModal(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

// ─── MetaChip ─────────────────────────────────────────────────────────────────

function MetaChip({ icon, label }: { icon: string; label: string }) {
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-border text-[10px] font-mono text-text-muted">
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
}

// ─── TrackRow ─────────────────────────────────────────────────────────────────

interface TrackRowProps {
  song: SaavnSong;
  index: number;
  quality: Quality;
  isExpanded: boolean;
  onToggle: () => void;
}

function TrackRow({ song, index, quality, isExpanded, onToggle }: TrackRowProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [showMetaEditor, setShowMetaEditor] = useState(false);
  const [originalMeta, setOriginalMeta] = useState<TrackMetadata | null>(null);
  const [editedMeta, setEditedMeta] = useState<TrackMetadata | null>(null);

  useEffect(() => {
    const meta = buildDefaultMetadata(song);
    setOriginalMeta(meta);
    setEditedMeta(meta);
  }, [song.id]);

  const duration = song.more_info?.duration ? formatDuration(song.more_info.duration) : null;
  const artist = song.subtitle?.split(' - ')[0]?.trim()
    || song.more_info?.artists?.primary?.[0]?.name
    || '';
  const albumName = song.more_info?.album || '';

  const thumbUrl = proxyImage(song.image, '150x150');
  const metaModified = originalMeta && editedMeta && metadataIsModified(originalMeta, editedMeta);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02, duration: 0.2 }}
      className={`rounded-xl border transition-all duration-200 ${isExpanded ? 'border-border bg-surface' : 'border-transparent hover:border-border hover:bg-surface/60'
        }`}
    >
      {/* Row header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        {/* Track number */}
        <span className="w-5 flex-shrink-0 text-center text-[11px] font-mono text-white/60">
          {index + 1}
        </span>

        {/* Thumbnail */}
        <div className="relative flex-shrink-0 w-9 h-9 rounded-lg overflow-hidden bg-border">
          {!imgLoaded && !imgError && <div className="absolute inset-0 bg-border animate-pulse" />}
          {!imgError && (
            <img
              src={thumbUrl}
              alt={song.title}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
              className={`w-full h-full object-cover transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          )}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-display font-semibold leading-tight truncate ${isExpanded ? 'text-cyan-300' : 'text-text-primary'}`}>
            {song.title}
          </p>
          <p className="text-[11px] text-text-muted font-body mt-0.5 truncate">
            {artist}{albumName ? ` · ${albumName}` : ''}
          </p>
        </div>

        {/* Duration */}
        {duration && (
          <span className="flex-shrink-0 text-[11px] font-mono text-text-muted">{duration}</span>
        )}

        {/* Chevron */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`flex-shrink-0 text-text-muted transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 space-y-3">
              {/* Audio preview */}
              {song.more_info?.vlink && (
                <AudioPreview vlink={song.more_info.vlink} title={song.title} />
              )}

              {/* Edit Meta + Download */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowMetaEditor(true)}
                  className={`px-3 py-2 rounded-xl border transition-all duration-200 text-[11px] font-display font-medium whitespace-nowrap ${metaModified
                    ? 'border-white/20 bg-white/5 text-white/80 hover:bg-white/10'
                    : 'border-border bg-glass text-white/40 hover:border-cyan/30 hover:text-white/60'
                    }`}
                >
                  {metaModified ? 'Meta Updated' : 'Edit Meta'}
                </button>
                <div className="flex-1">
                  <DownloadAction
                    song={song}
                    quality={quality}
                    overrideMeta={metaModified ? editedMeta! : undefined}
                    overrideFilename={metaModified ? editedMeta!.filename : undefined}
                    compact
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Metadata editor modal */}
      <AnimatePresence>
        {showMetaEditor && originalMeta && editedMeta && (
          <MetadataEditor
            original={originalMeta}
            current={editedMeta}
            onUpdate={(meta) => {
              setEditedMeta(meta);
              setShowMetaEditor(false);
            }}
            onReset={() => {
              setEditedMeta(originalMeta);
              setShowMetaEditor(false);
            }}
            onClose={() => setShowMetaEditor(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
