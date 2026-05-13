import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SaavnSong } from '../types/saavn';
import { downloadWithMetadata, downloadDirect } from '../utils/download';

interface DownloadButtonProps {
  song: SaavnSong;
  quality: string;
}

type Phase = 'idle' | 'working' | 'done' | 'error';

export default function DownloadButton({ song, quality }: DownloadButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState('');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  const [useFFmpeg, setUseFFmpeg] = useState(true);

  const handleDownload = async () => {
    if (phase === 'working') return;
    setPhase('working');
    setError('');
    setPercent(0);
    setStage('Starting…');

    try {
      if (useFFmpeg) {
        await downloadWithMetadata({
          song,
          quality,
          onProgress: (s, p) => {
            setStage(s);
            setPercent(p);
          },
        });
      } else {
        setStage('Preparing…');
        setPercent(30);
        await downloadDirect(song, quality);
        setPercent(100);
      }
      setPhase('done');
      setTimeout(() => setPhase('idle'), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Download failed';
      setError(msg);
      setPhase('error');

      // If ffmpeg fails, offer direct download
      if (useFFmpeg) {
        setUseFFmpeg(false);
      }
    }
  };

  const labelMap: Record<Phase, string> = {
    idle: `Download ${quality} kbps`,
    working: stage,
    done: 'Downloaded!',
    error: 'Retry (direct)',
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <motion.button
          onClick={handleDownload}
          disabled={phase === 'working'}
          whileTap={{ scale: phase === 'working' ? 1 : 0.97 }}
          className={`flex-1 relative flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-display font-semibold text-sm transition-all duration-200 overflow-hidden ${
            phase === 'done'
              ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-400'
              : phase === 'error'
              ? 'bg-rose/10 border border-rose/40 text-rose'
              : phase === 'working'
              ? 'bg-cyan/5 border border-cyan/20 text-cyan cursor-wait'
              : 'bg-cyan text-void hover:bg-cyan-dim shadow-glow cursor-pointer'
          }`}
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
            {phase === 'idle' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
            <span>{labelMap[phase]}</span>
          </span>
        </motion.button>

        {/* ffmpeg toggle */}
        <div className="flex flex-col items-center gap-0.5">
          <button
            onClick={() => setUseFFmpeg(!useFFmpeg)}
            title={useFFmpeg ? 'Metadata embedding ON (via ffmpeg.wasm)' : 'Direct download (no metadata)'}
            className={`w-8 h-8 rounded-lg border transition-all text-[10px] font-mono ${
              useFFmpeg
                ? 'bg-cyan/10 border-cyan/30 text-cyan'
                : 'bg-glass border-border text-text-muted hover:border-cyan/20'
            }`}
          >
            {useFFmpeg ? 'M' : 'D'}
          </button>
          <span className="text-[9px] text-text-muted font-mono">{useFFmpeg ? 'meta' : 'direct'}</span>
        </div>
      </div>

      <AnimatePresence>
        {phase === 'error' && error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-[11px] text-rose/80 font-mono pl-1"
          >
            {error}. Switched to direct mode — click to retry.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
