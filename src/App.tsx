import { useState } from 'react';
import { useEffect } from 'react';
import { getFFmpeg } from './utils/download';
import { motion, AnimatePresence } from 'framer-motion';
import URLInput from './components/URLInput';
import TrackCard from './components/TrackCard';
import TrackSkeleton from './components/TrackSkeleton';
import type { SaavnSong } from './types/saavn';

const API_BASE = 'https://sda.rhythmax.workers.dev';

type FetchState = 'idle' | 'loading' | 'success' | 'error';

export default function App() {
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [song, setSong] = useState<SaavnSong | null>(null);
  const [error, setError] = useState('');
  const [showUpdates, setShowUpdates] = useState(false);
  const [updates, setUpdates] = useState<any[]>([]);

  useEffect(() => {
  getFFmpeg().catch(console.error);
  }, []);

  useEffect(() => {
  fetch('/updates.json')
    .then((res) => res.json())
    .then(setUpdates)
    .catch(console.error);
}, []);

  const handleFetch = async (url: string) => {
    setFetchState('loading');
    setSong(null);
    setError('');

    try {
      const apiUrl = `${API_BASE}/song?url=${encodeURIComponent(url)}`;
      const resp = await fetch(apiUrl);

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `HTTP ${resp.status}`);
      }

      const data: SaavnSong = await resp.json();

      if (!data?.id || !data?.more_info?.encrypted_media_url) {
        throw new Error('Invalid response from API');
      }

      setSong(data);
      setFetchState('success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
      setFetchState('error');
    }
  };

  return (
    <div className="min-h-screen bg-void relative overflow-hidden">
      {/* Background meshes */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-mesh-cyan" />
        <div className="absolute inset-0 bg-mesh-rose" />
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center min-h-screen px-4 py-12 sm:py-20">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10 text-center"
        >
          <div className="flex items-center justify-center gap-3 mb-3">
            {/* Logo mark */}
            <h1 className="text-2xl font-display font-bold text-text-primary tracking-tight">
              saavn<span className="text-cyan">-dl</span>
            </h1>
          </div>
          <p className="text-sm text-text-muted font-body">
            Download JioSaavn songs · up to{' '}
            <span className="text-cyan font-mono">320 kbps</span>
          </p>
        </motion.div>

        {/* Input card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="w-full max-w-2xl"
        >
          <URLInput onFetch={handleFetch} isLoading={fetchState === 'loading'} />
        </motion.div>

        {/* Hint */}
        <AnimatePresence>
          {fetchState === 'idle' && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.6 }}
              className="mt-4 text-[12px] text-text-muted font-mono text-center"
            >
              e.g. https://www.jiosaavn.com/song/blinding-lights/Fj9GfAxDWUY
            </motion.p>
          )}
        </AnimatePresence>

        {/* Results area */}
        <div className="w-full max-w-2xl mt-8">
          <AnimatePresence mode="wait">
            {fetchState === 'loading' && (
              <motion.div
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <TrackSkeleton />
              </motion.div>
            )}

            {fetchState === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-2xl border border-rose/20 bg-rose/5 p-5 flex items-start gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-rose/10 border border-rose/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff6b8a" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-display font-semibold text-rose">Failed to fetch</p>
                  <p className="text-xs font-mono text-rose/70 mt-0.5">{error}</p>
                </div>
              </motion.div>
            )}

            {fetchState === 'success' && song && (
              <motion.div
                key="track"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <TrackCard song={song} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      
        {/* Footer */}
<motion.div
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: 0.8 }}
  className="mt-auto pt-16 flex items-center justify-center gap-4"
>
  {/* GitHub */}
  <a
    href="https://github.com/ODSkyler/saavn-dl"
    target="_blank"
    rel="noopener noreferrer"
    className="w-10 h-10 rounded-full bg-glass border border-border flex items-center justify-center text-text-muted hover:text-white hover:border-white/20 hover:bg-white/5 transition-all duration-200"
    aria-label="GitHub"
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.866-.013-1.699-2.782.605-3.37-1.343-3.37-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.004.07 1.532 1.032 1.532 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.523 2 12 2z" />
    </svg>
  </a>

  {/* Discord */}
  <a
    href="https://discord.gg/DyrnbfSdsv"
    target="_blank"
    rel="noopener noreferrer"
    className="w-10 h-10 rounded-full bg-glass border border-border flex items-center justify-center text-text-muted hover:text-[#5865F2] hover:border-[#5865F2]/30 hover:bg-[#5865F2]/10 transition-all duration-200"
    aria-label="Discord"
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M20.222 4.779a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.078.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.249.077.077 0 0 0-.078-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.17.099 17.243a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.027 13.83 13.83 0 0 0 1.226-1.994.076.076 0 0 0-.041-.105 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.04.106c.36.698.771 1.364 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .031-.055c.5-4.708-.838-8.795-3.548-12.433a.061.061 0 0 0-.031-.028zM8.02 14.307c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.947 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.947 2.419-2.157 2.419z" />
    </svg>
  </a>

{/* Updates / Info */}
<button
  onClick={() => setShowUpdates(true)}
  className="relative w-10 h-10 rounded-full bg-glass border border-border flex items-center justify-center text-text-muted hover:text-cyan hover:border-cyan/30 hover:bg-cyan/10 transition-all duration-200"
  aria-label="Updates"
>

  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
</button>
{/* Updates Modal */}
{showUpdates && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
    <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/80 backdrop-blur-xl p-6 shadow-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-display font-bold text-text-primary">
          Updates
        </h2>

        <button
          onClick={() => setShowUpdates(false)}
          className="text-text-muted hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        {updates.map((update) => (
          <div
            key={update.id}
            className="rounded-2xl border border-border bg-glass p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-text-primary">
                {update.title}
              </p>

              <span className="text-[10px] font-mono text-cyan/80">
                {update.date}
              </span>
            </div>

            <p className="mt-1 text-xs text-text-white/90">
              {update.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  </div>
)}
</motion.div>
      </div>
    </div>
  );
}
