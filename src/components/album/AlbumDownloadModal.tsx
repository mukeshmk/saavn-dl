import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AlbumDetail, Quality, SaavnSong } from '../../types/saavn';
import { QUALITY_OPTIONS } from '../../types/saavn';
import type {
  AlbumDownloadMode,
  AlbumDownloadProgress,
  TrackStatus,
} from '../../utils/albumDownload';
import {
  downloadAlbumIndividual,
  downloadAlbumZip,
  downloadAlbumLibrary,
  checkLibraryEnabled,
  estimateAlbumSizeMB,
  detectMultiArtist,
} from '../../utils/albumDownload';
import { useDownloadQueue } from '../DownloadQueueContext';
import { recordDownload } from '../../utils/history';

type ModalPhase = 'config' | 'downloading' | 'done' | 'error';

interface PendingFailure {
  trackIndex: number;
  track: SaavnSong;
  error: string;
  resolve: (action: 'skip' | 'retry') => void;
}

interface Props {
  album: AlbumDetail;
  onClose: () => void;
}

export default function AlbumDownloadModal({ album, onClose }: Props) {
  const [phase, setPhase] = useState<ModalPhase>('config');
  const [quality, setQuality] = useState<Quality>('320');
  const [mode, setMode] = useState<AlbumDownloadMode>('zip');
  const [progress, setProgress] = useState<AlbumDownloadProgress | null>(null);
  const [failure, setFailure] = useState<PendingFailure | null>(null);
  const [globalError, setGlobalError] = useState('');
  const [libraryEnabled, setLibraryEnabled] = useState(false);

  useEffect(() => {
    checkLibraryEnabled().then((enabled) => {
      setLibraryEnabled(enabled);
      if (enabled) setMode('library');
    });
  }, []);

  // Multi-artist detection for Navidrome compatibility
  const multiArtistInfo = detectMultiArtist(album);
  const [albumArtistOverride, setAlbumArtistOverride] = useState<string | null>(null);
  const [showMultiArtistPrompt, setShowMultiArtistPrompt] = useState(false);
  const [albumArtistInput, setAlbumArtistInput] = useState(multiArtistInfo.suggestedAlbumArtist);

  const { addAlbum } = useDownloadQueue();

  const estimatedMB = estimateAlbumSizeMB(album.songs, quality);
  const warnLarge = estimatedMB > 200;

  const handleBackgroundDownload = () => {
    // If multi-artist and not yet addressed, resolve it first for the queue
    const override = multiArtistInfo.isMultiArtist
      ? (albumArtistOverride !== null ? (albumArtistOverride || undefined) : albumArtistInput.trim() || 'Various Artists')
      : undefined;
    addAlbum(album, quality, mode, override);
    onClose();
  };

  const handleStart = useCallback(async () => {
    // If multi-artist album and user hasn't addressed the prompt yet, show it
    if (multiArtistInfo.isMultiArtist && albumArtistOverride === null && !showMultiArtistPrompt) {
      setShowMultiArtistPrompt(true);
      return;
    }

    setPhase('downloading');
    setGlobalError('');
    setShowMultiArtistPrompt(false);

    const onProg = (p: AlbumDownloadProgress) => setProgress({ ...p });

    const onFail = (idx: number, track: SaavnSong, error: string): Promise<'skip' | 'retry'> =>
      new Promise((resolve) => setFailure({ trackIndex: idx, track, error, resolve }));

    try {
      if (mode === 'zip') {
        await downloadAlbumZip(album, quality, onProg, onFail, albumArtistOverride ?? undefined);
      } else if (mode === 'library') {
        await downloadAlbumLibrary(album, quality, onProg, onFail, albumArtistOverride ?? undefined);
      } else {
        await downloadAlbumIndividual(album, quality, onProg, onFail, albumArtistOverride ?? undefined);
      }
      setPhase('done');

      // Record to download history
      recordDownload({
        saavnId: album.id,
        type: 'album',
        title: album.title,
        artist: album.artists?.primary?.[0]?.name || album.subtitle?.split(' - ')[0]?.trim() || 'Various Artists',
        album: album.title,
        image: album.image || '',
        quality,
        mode,
        songCount: album.songs?.length || 0,
      }).catch(() => { /* best-effort */ });
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Download failed');
      setPhase('error');
    }
  }, [album, quality, mode, multiArtistInfo.isMultiArtist, albumArtistOverride, showMultiArtistPrompt]);

  const handleMultiArtistConfirm = () => {
    setAlbumArtistOverride(albumArtistInput.trim() || 'Various Artists');
    setShowMultiArtistPrompt(false);
  };

  const handleMultiArtistSkip = () => {
    // User chose to skip — set override to empty string to signal "addressed but declined"
    setAlbumArtistOverride('');
    setShowMultiArtistPrompt(false);
  };

  // Auto-start download after the user resolves the multi-artist prompt
  useEffect(() => {
    if (albumArtistOverride !== null && phase === 'config' && !showMultiArtistPrompt) {
      // Trigger download now that override is set
      handleStart();
    }
  }, [albumArtistOverride]);

  const resolveFailure = (action: 'skip' | 'retry') => {
    failure?.resolve(action);
    setFailure(null);
  };

  const doneTracks = progress?.tracks.filter(t => t.status === 'done').length ?? 0;
  const skippedTracks = progress?.tracks.filter(t => t.status === 'skipped').length ?? 0;
  const failedTracks = progress?.tracks.filter(t => t.status === 'failed').length ?? 0;
  const overallPct = Math.min(progress?.percent ?? 0, 100);
  const isBusy = phase === 'downloading';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-md"
      onClick={!isBusy ? onClose : undefined}
    >
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md rounded-2xl border border-border bg-[#0e0e12] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div className="min-w-0 pr-4">
            <h2 className="text-base font-display font-bold text-text-primary">Download Album</h2>
            <p className="text-[11px] font-mono text-white/60 truncate mt-0.5">{album.title}</p>
          </div>
          {!isBusy && (
            <button
              onClick={onClose}
              className="flex-shrink-0 p-1.5 text-white/60 hover:text-text-primary transition-colors rounded-lg hover:bg-white/5"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="p-5 space-y-5">
          <AnimatePresence mode="wait">

            {/* ── Config ──────────────────────────────────────────────── */}
            {phase === 'config' && (
              <motion.div key="config" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
                {/* Mode picker */}
                <div>
                  <p className="text-[11px] font-mono text-white/60 uppercase tracking-wider mb-2">Download Mode</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(['individual', 'zip', 'library'] as AlbumDownloadMode[]).map((m) => {
                      const isDisabled = m === 'library' && !libraryEnabled;
                      return (
                        <button
                          key={m}
                          onClick={() => !isDisabled && setMode(m)}
                          disabled={isDisabled}
                          className={`flex flex-col items-center gap-2 p-3.5 rounded-xl border text-[13px] font-display font-semibold transition-all duration-150 ${isDisabled
                            ? 'border-border bg-glass/50 text-text-muted cursor-not-allowed opacity-50'
                            : mode === m
                              ? 'border-cyan bg-cyan/10 text-cyan'
                              : 'border-border bg-glass text-text-secondary hover:border-cyan/30 hover:text-cyan'
                            }`}
                          title={isDisabled ? 'Set SAAVN_LIBRARY_PATH env var to enable' : undefined}
                        >
                          {m === 'zip' ? <ZipIcon /> : m === 'library' ? <LibraryIcon /> : <FilesIcon />}
                          {m === 'zip' ? 'ZIP Archive' : m === 'library' ? 'Save to Library' : 'Individual Files'}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] font-mono text-white/60 leading-relaxed">
                    {mode === 'zip'
                      ? `One .zip file · ${album.songs.length} tracks with cover art + metadata`
                      : mode === 'library'
                        ? `Save ${album.songs.length} tracks directly to the server library folder`
                        : `${album.songs.length} separate .m4a files downloaded one-by-one`}
                  </p>
                </div>

                {/* Quality */}
                <div>
                  <p className="text-[11px] font-mono text-white/60 uppercase tracking-wider mb-2">Quality</p>
                  <div className="flex flex-wrap gap-1.5">
                    {QUALITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setQuality(opt.value)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all duration-150 ${quality === opt.value
                          ? 'bg-cyan text-void shadow-glow'
                          : 'bg-glass border border-border text-text-secondary hover:border-cyan/30 hover:text-cyan'
                          }`}
                      >
                        {opt.label}
                        {opt.tag && (
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded leading-none ${quality === opt.value ? 'bg-void/20 text-void' : 'bg-cyan/10 text-cyan'
                            }`}>{opt.tag}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Size estimate */}
                <div className={`flex items-start gap-2.5 p-3 rounded-xl border ${warnLarge ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-glass'
                  }`}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke={warnLarge ? '#f59e0b' : '#44445a'} strokeWidth="2"
                    className="flex-shrink-0 mt-0.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <div>
                    <p className={`text-[11px] font-mono ${warnLarge ? 'text-amber-400' : 'text-white/60'}`}>
                      ~{estimatedMB < 1 ? '<1' : estimatedMB.toFixed(0)} MB · {album.songs.length} tracks · {quality} kbps
                    </p>
                    {warnLarge && (
                      <p className="text-[10px] font-mono text-amber-400/70 mt-0.5">
                        Large album — make sure you have enough free memory
                      </p>
                    )}
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={onClose}
                    className="py-2.5 px-4 rounded-xl border border-border text-sm font-display font-medium text-text-secondary hover:text-text-primary hover:border-white/20 transition-all"
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleBackgroundDownload}
                    className="flex-1 py-2.5 rounded-xl border border-violet-400/40 bg-violet-500/10 text-violet-300 text-sm font-display font-semibold hover:bg-violet-500/20 transition-all"
                  >
                    Queue It
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleStart}
                    className="flex-1 py-2.5 rounded-xl bg-cyan hover:bg-cyan-dim text-black text-sm font-display font-semibold transition-all"
                  >
                    Download Now
                  </motion.button>
                </div>

                {/* Multi-artist prompt (Navidrome fix) */}
                <AnimatePresence>
                  {showMultiArtistPrompt && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="p-3.5 rounded-xl border border-violet-400/30 bg-violet-500/5 space-y-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="16" x2="12" y2="12" />
                          <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        <div>
                          <p className="text-[12px] font-display font-semibold text-violet-300">Multi-artist album detected</p>
                          <p className="text-[11px] font-mono text-white/60 mt-1 leading-relaxed">
                            This album has {multiArtistInfo.uniqueArtists.length} different artists. Music servers like Navidrome will split it into separate albums unless all tracks share the same <span className="text-violet-300">Album Artist</span> tag.
                          </p>
                          <p className="text-[10px] font-mono text-white/40 mt-1.5">
                            Set a unified Album Artist to keep this as one album:
                          </p>
                        </div>
                      </div>

                      <input
                        type="text"
                        value={albumArtistInput}
                        onChange={(e) => setAlbumArtistInput(e.target.value)}
                        placeholder="e.g. Various Artists"
                        className="w-full bg-glass border border-border rounded-xl px-3.5 py-2.5 text-sm font-body text-text-primary placeholder:text-text-muted/50 outline-none focus:border-violet-400/50 transition-colors"
                      />

                      <div className="flex gap-2">
                        <button
                          onClick={handleMultiArtistSkip}
                          className="flex-1 py-2 rounded-xl border border-border text-[11px] font-display font-medium text-white/60 hover:text-text-primary hover:border-white/20 transition-all"
                        >
                          Skip (keep as-is)
                        </button>
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          onClick={handleMultiArtistConfirm}
                          className="flex-1 py-2 rounded-xl bg-violet-500/20 border border-violet-400/40 text-[11px] font-display font-semibold text-violet-300 hover:bg-violet-500/30 transition-all"
                        >
                          Apply &amp; Download
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* ── Downloading ──────────────────────────────────────────── */}
            {phase === 'downloading' && progress && (
              <motion.div key="downloading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                {/* Progress bar */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-display font-semibold text-text-primary">
                      {progress.zipStage === 'compressing'
                        ? 'Creating ZIP archive…'
                        : progress.zipStage === 'preparing'
                          ? 'Preparing download…'
                          : `Track ${progress.current} / ${progress.total}`}
                    </span>
                    <span className="text-[11px] font-mono text-white/60 tabular-nums">{overallPct}%</span>
                  </div>
                  <div className="h-1.5 bg-border rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-cyan"
                      animate={{ width: `${overallPct}%` }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                    />
                  </div>
                </div>

                {/* Current track info */}
                {!progress.zipStage && (
                  <div className="p-3 rounded-xl border border-border bg-glass">
                    <p className="text-[10px] font-mono text-white/60 mb-0.5 uppercase tracking-wide">Now downloading</p>
                    <p className="text-sm font-display font-semibold text-text-primary truncate">{progress.currentTitle}</p>
                    <p className="text-[11px] font-mono text-cyan mt-0.5">{progress.stage}</p>
                  </div>
                )}

                {/* ZIP compressing indicator */}
                {progress.zipStage && progress.zipStage !== 'done' && (
                  <div className="p-3 rounded-xl border border-cyan/20 bg-cyan/5 flex items-center gap-2.5">
                    <span className="w-3.5 h-3.5 border-2 border-cyan border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <p className="text-sm font-display text-cyan">{progress.stage}</p>
                  </div>
                )}

                {/* Track list */}
                <TrackStatusList tracks={progress.tracks} />

                {/* Failure prompt */}
                <AnimatePresence>
                  {failure && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="p-3 rounded-xl border border-rose/30 bg-rose/5 space-y-2"
                    >
                      <p className="text-[11px] font-display font-semibold text-rose">Track failed</p>
                      <p className="text-xs font-mono text-text-primary truncate">{failure.track.title}</p>
                      <p className="text-[10px] font-mono text-rose/70 leading-relaxed">{failure.error}</p>
                      <div className="flex gap-2 pt-0.5">
                        <button
                          onClick={() => resolveFailure('skip')}
                          className="flex-1 py-1.5 rounded-lg border border-border text-[11px] font-mono text-white/60 hover:text-text-primary transition-colors"
                        >
                          Skip Track
                        </button>
                        <button
                          onClick={() => resolveFailure('retry')}
                          className="flex-1 py-1.5 rounded-lg border border-rose/40 bg-rose/10 text-[11px] font-mono text-rose hover:bg-rose/20 transition-colors"
                        >
                          Retry
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* ── Done ────────────────────────────────────────────────── */}
            {phase === 'done' && progress && (
              <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <div className="flex flex-col items-center text-center py-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-3">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <p className="text-base font-display font-bold text-text-primary">
                    {mode === 'zip' ? 'ZIP downloaded!' : 'Download complete'}
                  </p>
                  <div className="mt-2 flex flex-wrap justify-center gap-3 text-[12px] font-mono">
                    <span className="text-emerald-400">{doneTracks} downloaded</span>
                    {skippedTracks > 0 && <span className="text-amber-400">{skippedTracks} skipped</span>}
                    {failedTracks > 0 && <span className="text-rose">{failedTracks} failed</span>}
                  </div>
                </div>
                <TrackStatusList tracks={progress.tracks} />
                <button
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl border border-border text-sm font-display font-medium text-text-secondary hover:text-text-primary hover:border-white/20 transition-all"
                >
                  Close
                </button>
              </motion.div>
            )}

            {/* ── Error ───────────────────────────────────────────────── */}
            {phase === 'error' && (
              <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="flex items-start gap-3 p-3.5 rounded-xl border border-rose/25 bg-rose/5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff6b8a" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <div>
                    <p className="text-sm font-display font-semibold text-rose">Download failed</p>
                    <p className="text-[11px] font-mono text-rose/70 mt-0.5">{globalError}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-display font-medium text-text-secondary hover:text-text-primary transition-all">
                    Close
                  </button>
                  <button
                    onClick={() => { setPhase('config'); setGlobalError(''); setProgress(null); }}
                    className="flex-1 py-2.5 rounded-xl border border-rose/40 bg-rose/10 text-sm font-display font-semibold text-rose hover:bg-rose/20 transition-all"
                  >
                    Try Again
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Track status list ────────────────────────────────────────────────────────

function TrackStatusList({ tracks }: { tracks: TrackStatus[] }) {
  if (!tracks.length) return null;
  return (
    <div className="max-h-40 overflow-y-auto space-y-0.5 rounded-xl border border-border bg-glass p-2">
      {tracks.map((t) => (
        <div key={t.id} className="flex items-center gap-2 px-1.5 py-1 rounded-lg">
          <StatusDot status={t.status} />
          <span className={`text-[11px] font-mono truncate flex-1 ${t.status === 'done' ? 'text-emerald-400'
            : t.status === 'failed' ? 'text-rose'
              : t.status === 'skipped' ? 'text-white/60/50 line-through'
                : t.status === 'downloading' ? 'text-cyan'
                  : 'text-white/60'
            }`}>{t.title}</span>
          {t.status === 'downloading' && (
            <span className="w-2.5 h-2.5 border border-cyan border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: TrackStatus['status'] }) {
  const cls: Record<TrackStatus['status'], string> = {
    pending: 'bg-text-muted/25',
    downloading: 'bg-cyan',
    done: 'bg-emerald-400',
    failed: 'bg-rose',
    skipped: 'bg-text-muted/40',
  };
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cls[status]}`} />;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ZipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <line x1="12" y1="6" x2="12" y2="14" />
      <polyline points="9 11 12 14 15 11" />
    </svg>
  );
}
