import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { SaavnSong, Quality } from '../types/saavn';
import type { TrackMetadata } from '../types/metadata';
import { downloadWithMetadata, downloadDirect } from '../utils/download';
import { useDownloadQueue } from './DownloadQueueContext';
import { useDownloadPrefs } from './DownloadPrefsContext';
import type { TrackDownloadAction } from './DownloadPrefsContext';
import { recordDownload } from '../utils/history';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DownloadActionProps {
  song: SaavnSong;
  quality: Quality;
  overrideMeta?: TrackMetadata;
  overrideFilename?: string;
  onDownloadSuccess?: () => void;
  /** Compact mode for per-track rows in album view */
  compact?: boolean;
}

type Phase = 'idle' | 'working' | 'done' | 'error' | 'queued';

// ─── Save to Library (single track) ──────────────────────────────────────────

async function saveTrackToLibrary(blob: Blob, song: SaavnSong, filename: string): Promise<string> {
  const album = song.more_info?.album || 'Unknown Album';
  const artist = song.more_info?.artists?.primary?.[0]?.name || 'Unknown Artist';
  const resp = await fetch('/api/library/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Artist': encodeURIComponent(artist),
      'X-Album': encodeURIComponent(album),
      'X-Filename': encodeURIComponent(filename),
    },
    body: blob,
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: 'Unknown server error' }));
    throw new Error(data.error || `Server responded with ${resp.status}`);
  }

  const data = await resp.json();
  return data.path || '';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DownloadAction({
  song,
  quality,
  overrideMeta,
  overrideFilename,
  onDownloadSuccess,
  compact = false,
}: DownloadActionProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState('');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toggleBtnRef = useRef<HTMLButtonElement>(null);

  const { trackAction, embedMeta, libraryEnabled, setTrackAction, setEmbedMeta } = useDownloadPrefs();
  const { addTrack } = useDownloadQueue();

  // Compute dropdown position when opened
  useEffect(() => {
    if (dropdownOpen && toggleBtnRef.current) {
      const rect = toggleBtnRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
  }, [dropdownOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        toggleBtnRef.current && !toggleBtnRef.current.contains(target)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  // ── Execute action ──────────────────────────────────────────────────────────

  const executeAction = async (action?: TrackDownloadAction) => {
    const resolvedAction = action ?? trackAction;

    if (resolvedAction === 'queue') {
      addTrack(song, quality, overrideMeta, overrideFilename);
      setPhase('queued');
      setTimeout(() => setPhase('idle'), 2000);
      return;
    }

    if (phase === 'working') return;
    setPhase('working');
    setError('');
    setPercent(0);
    setStage('Starting…');

    try {
      let savedPath = '';

      if (resolvedAction === 'library') {
        // Download with metadata processing, then save to library
        if (embedMeta) {
          // We need the blob, not a browser download
          const blob = await downloadToBlob(song, quality, overrideMeta, overrideFilename, (s, p) => {
            setStage(s);
            setPercent(p);
          });
          setStage('Saving to library…');
          setPercent(92);
          const artist = getArtistForFilename(song);
          const filename = (overrideFilename ?? `${song.title} - ${artist}`) + '.m4a';
          savedPath = await saveTrackToLibrary(blob, song, sanitizeFilenameLocal(filename));
        } else {
          // Direct download blob → library
          setStage('Fetching audio…');
          setPercent(30);
          const blob = await downloadDirectToBlob(song, quality);
          setStage('Saving to library…');
          setPercent(80);
          const artist = getArtistForFilename(song);
          const filename = (overrideFilename ?? `${song.title} - ${artist}`) + '.m4a';
          savedPath = await saveTrackToLibrary(blob, song, sanitizeFilenameLocal(filename));
        }
      } else {
        // Regular download to browser
        if (embedMeta) {
          await downloadWithMetadata({
            song,
            quality,
            onProgress: (s, p) => {
              setStage(s);
              setPercent(p);
            },
            overrideMeta,
            overrideFilename,
          });
        } else {
          setStage('Preparing…');
          setPercent(30);
          await downloadDirect(song, quality, overrideFilename);
          setPercent(100);
        }
      }

      setPhase('done');
      onDownloadSuccess?.();

      // Record to download history
      recordDownload({
        saavnId: song.id,
        type: 'track',
        title: song.title,
        artist: song.subtitle?.split(' - ')[0]?.trim() || song.more_info?.artists?.primary?.[0]?.name || 'Unknown Artist',
        album: song.more_info?.album || '',
        image: song.image || '',
        quality,
        mode: resolvedAction === 'library' ? 'library' : embedMeta ? 'ffmpeg' : 'direct',
        songCount: 0,
        filePath: savedPath || undefined,
      }).catch(() => { });

      setTimeout(() => setPhase('idle'), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Download failed';
      setError(msg);
      setPhase('error');
    }
  };

  // ── Labels ────────────────────────────────────────────────────────────────────

  const actionLabels: Record<TrackDownloadAction, string> = {
    download: 'Download',
    library: 'Save to Library',
    queue: 'Add to Queue',
  };

  const actionIcons: Record<TrackDownloadAction, React.ReactNode> = {
    download: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
    library: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
    queue: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    ),
  };

  const phaseLabel =
    phase === 'working' ? stage
      : phase === 'done' ? 'Done!'
        : phase === 'queued' ? 'Queued!'
          : phase === 'error' ? 'Failed — tap to retry'
            : `${actionLabels[trackAction]} · ${quality} kbps`;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex items-stretch gap-0">
        {/* Main action button */}
        <motion.button
          onClick={() => phase === 'error' ? executeAction() : executeAction()}
          disabled={phase === 'working'}
          whileTap={{ scale: phase === 'working' ? 1 : 0.97 }}
          className={`flex-1 relative flex items-center justify-center gap-2 ${compact ? 'px-3 py-2' : 'px-5 py-3'} rounded-l-xl font-display font-semibold ${compact ? 'text-[12px]' : 'text-sm'} transition-all duration-200 overflow-hidden ${phase === 'done'
            ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-400'
            : phase === 'queued'
              ? 'bg-violet-500/10 border border-violet-500/40 text-violet-400'
              : phase === 'error'
                ? 'bg-rose/10 border border-rose/40 text-rose cursor-pointer'
                : phase === 'working'
                  ? 'bg-cyan/5 border border-cyan/20 text-cyan cursor-wait'
                  : 'bg-cyan text-void hover:bg-cyan-dim shadow-glow cursor-pointer'
            } border-r-0`}
        >
          {/* Progress fill */}
          {phase === 'working' && (
            <motion.div
              className="absolute inset-0 bg-cyan/10 origin-left"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: percent / 100 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          )}
          <span className="relative z-10 flex items-center gap-2">
            {phase === 'working' && (
              <span className="w-3.5 h-3.5 border border-cyan border-t-transparent rounded-full animate-spin flex-shrink-0" />
            )}
            {phase === 'done' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {phase === 'queued' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {phase === 'idle' && actionIcons[trackAction]}
            <span className="truncate">{phaseLabel}</span>
          </span>
        </motion.button>

        {/* Dropdown toggle */}
        <button
          ref={toggleBtnRef}
          onClick={() => setDropdownOpen(!dropdownOpen)}
          disabled={phase === 'working'}
          className={`${compact ? 'px-2' : 'px-3'} rounded-r-xl border transition-all duration-200 flex items-center justify-center ${phase === 'done'
            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
            : phase === 'queued'
              ? 'bg-violet-500/10 border-violet-500/40 text-violet-400'
              : phase === 'error'
                ? 'bg-rose/10 border-rose/40 text-rose'
                : phase === 'working'
                  ? 'bg-cyan/5 border-cyan/20 text-cyan'
                  : 'bg-cyan text-void hover:bg-cyan-dim'
            } disabled:opacity-40`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* Dropdown menu (portal to escape overflow:hidden) */}
      {createPortal(
        <AnimatePresence>
          {dropdownOpen && dropdownPos && (
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="fixed z-[9999] w-56 rounded-xl border border-border bg-surface shadow-2xl overflow-hidden"
              style={{ top: dropdownPos.top, right: dropdownPos.right }}
            >
              {/* Action options */}
              <div className="py-1">
                <DropdownItem
                  label="Download Now"
                  icon={actionIcons.download}
                  active={trackAction === 'download'}
                  onClick={() => { setTrackAction('download'); setDropdownOpen(false); }}
                />
                {libraryEnabled && (
                  <DropdownItem
                    label="Save to Library"
                    icon={actionIcons.library}
                    active={trackAction === 'library'}
                    onClick={() => { setTrackAction('library'); setDropdownOpen(false); }}
                  />
                )}
                <DropdownItem
                  label="Add to Queue"
                  icon={actionIcons.queue}
                  active={trackAction === 'queue'}
                  onClick={() => { setTrackAction('queue'); setDropdownOpen(false); }}
                />
              </div>

              {/* Divider */}
              <div className="h-px bg-border" />

              {/* Meta toggle */}
              <div className="py-1">
                <button
                  onClick={() => setEmbedMeta(!embedMeta)}
                  className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-white/5 transition-colors"
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${embedMeta ? 'bg-cyan/20 border-cyan/50' : 'border-border'}`}>
                    {embedMeta && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-cyan">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                  <span className="text-[12px] font-display text-text-secondary">Embed metadata</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Error message */}
      <AnimatePresence>
        {phase === 'error' && error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-1.5 text-[11px] text-rose/80 font-mono"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Dropdown item ────────────────────────────────────────────────────────────

function DropdownItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${active ? 'bg-cyan/10 text-cyan' : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
        }`}
    >
      <span className="flex-shrink-0 w-4 flex items-center justify-center">{icon}</span>
      <span className="text-[12px] font-display font-medium">{label}</span>
      {active && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="ml-auto flex-shrink-0">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

// ─── Helpers (for library save) ───────────────────────────────────────────────

import { decryptMediaUrl, getQualityUrl, sanitizeFilename } from '../utils/decrypt';
import { proxyFetch } from '../utils/proxy';
import { getFFmpeg } from '../utils/download';

function sanitizeFilenameLocal(name: string): string {
  return sanitizeFilename(name.replace(/\.m4a$/, '')) + '.m4a';
}

function getArtistForFilename(song: SaavnSong): string {
  return song.subtitle?.split(' - ')[0]?.trim()
    || song.more_info?.artists?.primary?.[0]?.name
    || 'Unknown Artist';
}

/**
 * Download and process a track to a Blob (with metadata) without triggering browser download.
 * Reuses the same ffmpeg logic as downloadWithMetadata but returns the blob.
 */
async function downloadToBlob(
  song: SaavnSong,
  quality: string,
  overrideMeta?: TrackMetadata,
  overrideFilename?: string,
  onProgress?: (stage: string, percent: number) => void,
): Promise<Blob> {
  const { more_info } = song;

  onProgress?.('Decrypting URL…', 8);
  const decrypted = decryptMediaUrl(more_info.encrypted_media_url);
  const audioUrl = getQualityUrl(decrypted, quality);

  onProgress?.('Fetching audio…', 18);
  const audioResp = await proxyFetch(audioUrl);
  if (!audioResp.ok) throw new Error(`Audio fetch failed: HTTP ${audioResp.status}`);
  const audioBlob = await audioResp.blob();
  if (audioBlob.size < 1024) throw new Error('Audio response is empty — URL may have expired');

  onProgress?.('Fetching cover art…', 32);
  let coverData: Uint8Array | null = null;
  try {
    const imgUrl = song.image.replace(/\d+x\d+/, '500x500').replace('http://', 'https://');
    const imgResp = await proxyFetch(imgUrl);
    if (imgResp.ok) {
      const imgBlob = await imgResp.blob();
      if (imgBlob.size > 500) {
        coverData = new Uint8Array(await imgBlob.arrayBuffer());
      }
    }
  } catch { /* cover is optional */ }

  onProgress?.('Loading ffmpeg…', 48);
  const ff = await getFFmpeg();

  const audioData = new Uint8Array(await audioBlob.arrayBuffer());
  const artist = getArtistForFilename(song);

  const meta = overrideMeta
    ? {
      title: overrideMeta.title,
      artist: overrideMeta.artist,
      albumArtist: overrideMeta.albumArtist,
      album: overrideMeta.album,
      year: overrideMeta.year,
      publisher: more_info.label,
      copyright: overrideMeta.copyright,
    }
    : {
      title: song.title,
      artist,
      albumArtist: artist,
      album: more_info.album,
      year: song.year,
      publisher: more_info.label,
      copyright: more_info.copyright_text,
    };

  let outputData: Uint8Array;

  if (coverData) {
    onProgress?.('Embedding cover + metadata…', 62);
    try {
      // Embed with cover
      await ff.writeFile('in.mp4', audioData);
      await ff.writeFile('cover.jpg', coverData);
      await ff.exec([
        '-i', 'in.mp4', '-i', 'cover.jpg',
        '-map', '0:a:0', '-map', '1:v:0',
        '-c:a', 'copy', '-c:v', 'copy',
        '-disposition:v:0', 'attached_pic',
        '-metadata', `title=${meta.title}`,
        '-metadata', `artist=${meta.artist}`,
        '-metadata', `album_artist=${meta.albumArtist}`,
        '-metadata', `album=${meta.album}`,
        '-metadata', `date=${meta.year}`,
        '-metadata', `publisher=${meta.publisher}`,
        '-metadata', `copyright=${meta.copyright}`,
        '-movflags', '+faststart',
        'out.mp4',
      ]);
      const raw = await ff.readFile('out.mp4') as Uint8Array;
      outputData = raw;
      try { await ff.deleteFile('in.mp4'); } catch { }
      try { await ff.deleteFile('cover.jpg'); } catch { }
      try { await ff.deleteFile('out.mp4'); } catch { }
    } catch {
      onProgress?.('Cover failed, metadata only…', 72);
      await ff.writeFile('in.mp4', audioData);
      await ff.exec([
        '-i', 'in.mp4', '-c', 'copy',
        '-metadata', `title=${meta.title}`,
        '-metadata', `artist=${meta.artist}`,
        '-metadata', `album_artist=${meta.albumArtist}`,
        '-metadata', `album=${meta.album}`,
        '-metadata', `date=${meta.year}`,
        '-metadata', `publisher=${meta.publisher}`,
        '-metadata', `copyright=${meta.copyright}`,
        '-movflags', '+faststart',
        'out_meta.mp4',
      ]);
      const raw = await ff.readFile('out_meta.mp4') as Uint8Array;
      outputData = raw;
      try { await ff.deleteFile('in.mp4'); } catch { }
      try { await ff.deleteFile('out_meta.mp4'); } catch { }
    }
  } else {
    onProgress?.('Embedding metadata…', 62);
    await ff.writeFile('in.mp4', audioData);
    await ff.exec([
      '-i', 'in.mp4', '-c', 'copy',
      '-metadata', `title=${meta.title}`,
      '-metadata', `artist=${meta.artist}`,
      '-metadata', `album_artist=${meta.albumArtist}`,
      '-metadata', `album=${meta.album}`,
      '-metadata', `date=${meta.year}`,
      '-metadata', `publisher=${meta.publisher}`,
      '-metadata', `copyright=${meta.copyright}`,
      '-movflags', '+faststart',
      'out_meta.mp4',
    ]);
    const raw = await ff.readFile('out_meta.mp4') as Uint8Array;
    outputData = raw;
    try { await ff.deleteFile('in.mp4'); } catch { }
    try { await ff.deleteFile('out_meta.mp4'); } catch { }
  }

  onProgress?.('Done!', 100);
  const buf = outputData.buffer.slice(outputData.byteOffset, outputData.byteOffset + outputData.byteLength) as ArrayBuffer;
  return new Blob([buf], { type: 'audio/mp4' });
}

/**
 * Download audio directly (no metadata) and return as blob.
 */
async function downloadDirectToBlob(song: SaavnSong, quality: string): Promise<Blob> {
  const decrypted = decryptMediaUrl(song.more_info.encrypted_media_url);
  const audioUrl = getQualityUrl(decrypted, quality);
  const resp = await proxyFetch(audioUrl);
  if (!resp.ok) throw new Error(`Audio fetch failed: HTTP ${resp.status}`);
  return resp.blob();
}
