import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Playlist } from '../../utils/playlists';
import { listPlaylists, deletePlaylist, exportAllPlaylists } from '../../utils/playlists';
import PlaylistDetail from './PlaylistDetail';
import PlaylistCreateModal from './PlaylistCreateModal';

interface PlaylistsPageProps {
  musicPathEnabled: boolean;
}

export default function PlaylistsPage({ musicPathEnabled }: PlaylistsPageProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  const loadPlaylists = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await listPlaylists();
      setPlaylists(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playlists');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  const handleDelete = async (id: string) => {
    try {
      await deletePlaylist(id);
      setPlaylists((prev) => prev.filter((p) => p.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleExportAll = async () => {
    setExporting(true);
    setExportMsg('');
    try {
      const result = await exportAllPlaylists();
      setExportMsg(`Exported ${result.count} playlist${result.count !== 1 ? 's' : ''} to Navidrome`);
      setTimeout(() => setExportMsg(''), 4000);
    } catch (err) {
      setExportMsg(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleCreated = (playlist: Playlist) => {
    setPlaylists((prev) => [playlist, ...prev]);
    setShowCreate(false);
    setSelectedId(playlist.id);
  };

  const handleBack = () => {
    setSelectedId(null);
    loadPlaylists();
  };

  // ── Detail view ──
  if (selectedId) {
    return (
      <PlaylistDetail
        playlistId={selectedId}
        musicPathEnabled={musicPathEnabled}
        onBack={handleBack}
      />
    );
  }

  // ── List view ──
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-display font-bold text-text-primary">Playlists</h2>
          <p className="text-[11px] font-mono text-text-muted mt-0.5">
            Build and export Navidrome-compatible playlists from your downloads
          </p>
        </div>
        <div className="flex items-center gap-2">
          {musicPathEnabled && playlists.length > 0 && (
            <button
              onClick={handleExportAll}
              disabled={exporting}
              className="px-3 py-1.5 rounded-lg text-[11px] font-display font-semibold border border-border bg-glass text-text-secondary hover:text-cyan hover:border-cyan/30 transition-all disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : 'Export All'}
            </button>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-display font-semibold bg-cyan/15 text-cyan border border-cyan/30 hover:bg-cyan/25 transition-all"
          >
            + New Playlist
          </button>
        </div>
      </div>

      {/* Export message */}
      <AnimatePresence>
        {exportMsg && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-3 px-3 py-2 rounded-xl border border-cyan/20 bg-cyan/5 text-[11px] font-mono text-cyan"
          >
            {exportMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      {error && (
        <div className="mb-3 px-3 py-2 rounded-xl border border-rose/20 bg-rose/5 text-[11px] font-mono text-rose/80">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-2xl border border-border bg-glass animate-pulse"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="h-4 rounded w-1/3 bg-white/5 mb-2" />
              <div className="h-3 rounded w-1/5 bg-white/5" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && playlists.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-16"
        >
          <p className="text-3xl mb-3">🎵</p>
          <p className="text-sm font-display font-semibold text-text-secondary">
            No playlists yet
          </p>
          <p className="text-xs font-mono text-text-muted mt-1.5">
            Create a playlist from your download history
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 px-4 py-2 rounded-xl text-[12px] font-display font-semibold bg-cyan/15 text-cyan border border-cyan/30 hover:bg-cyan/25 transition-all"
          >
            Create your first playlist
          </button>
        </motion.div>
      )}

      {/* Playlist cards */}
      {!loading && playlists.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-2"
        >
          {playlists.map((playlist, i) => (
            <motion.div
              key={playlist.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="group p-4 rounded-2xl border border-border bg-glass hover:border-white/15 hover:bg-white/[0.03] transition-all cursor-pointer"
              onClick={() => setSelectedId(playlist.id)}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-display font-semibold text-text-primary truncate">
                      {playlist.name}
                    </h3>
                    {playlist.autoGenerate && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-violet-500/15 text-violet-400 border border-violet-500/20">
                        Auto
                      </span>
                    )}
                  </div>
                  {playlist.description && (
                    <p className="text-[11px] text-text-muted mt-0.5 truncate">
                      {playlist.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] font-mono text-text-muted">
                      {playlist.trackCount} track{playlist.trackCount !== 1 ? 's' : ''}
                    </span>
                    <span className="text-[10px] font-mono text-text-muted">
                      Updated {new Date(playlist.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${playlist.name}"?`)) handleDelete(playlist.id);
                    }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-rose hover:bg-rose/10 transition-all"
                    aria-label="Delete playlist"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-2 14H7L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                  </button>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted group-hover:text-cyan transition-all">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <PlaylistCreateModal
            onClose={() => setShowCreate(false)}
            onCreated={handleCreated}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
