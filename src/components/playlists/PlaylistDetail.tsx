import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { proxyImage } from '../../types/saavn';
import type { Playlist, PlaylistTrack, TrackSearchResult } from '../../utils/playlists';
import {
  getPlaylist,
  getPlaylistTracks,
  removeTracksFromPlaylist,
  reorderPlaylistTracks,
  addTracksToPlaylist,
  regeneratePlaylist,
  exportPlaylist,
  searchTracksForPlaylist,
} from '../../utils/playlists';

interface PlaylistDetailProps {
  playlistId: string;
  musicPathEnabled: boolean;
  onBack: () => void;
}

export default function PlaylistDetail({ playlistId, musicPathEnabled, onBack }: PlaylistDetailProps) {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [exporting, setExporting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showAddTracks, setShowAddTracks] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [pl, tr] = await Promise.all([
        getPlaylist(playlistId),
        getPlaylistTracks(playlistId),
      ]);
      setPlaylist(pl);
      setTracks(tr);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playlist');
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => { load(); }, [load]);

  const showMsg = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(''), 3000);
  };

  // ── Remove track ──
  const handleRemove = async (trackId: string) => {
    try {
      const updated = await removeTracksFromPlaylist(playlistId, [trackId]);
      setTracks(updated);
      showMsg('Track removed');
    } catch (err) {
      showMsg(err instanceof Error ? err.message : 'Remove failed');
    }
  };

  // ── Move track up/down ──
  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const newTracks = [...tracks];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newTracks.length) return;

    [newTracks[index], newTracks[targetIdx]] = [newTracks[targetIdx], newTracks[index]];
    setTracks(newTracks); // Optimistic update

    try {
      const ordered = newTracks.map((t) => t.id);
      const updated = await reorderPlaylistTracks(playlistId, ordered);
      setTracks(updated);
    } catch (err) {
      setTracks(tracks); // Revert
      showMsg('Reorder failed');
    }
  };

  // ── Export ──
  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await exportPlaylist(playlistId);
      showMsg(`Exported: ${result.filename} (${result.trackCount} tracks)`);
    } catch (err) {
      showMsg(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  // ── Regenerate ──
  const handleRegenerate = async () => {
    if (!confirm('This will replace all tracks with new results from the criteria. Continue?')) return;
    setRegenerating(true);
    try {
      const updated = await regeneratePlaylist(playlistId);
      setTracks(updated);
      showMsg('Playlist regenerated');
      // Refresh playlist metadata (track count)
      const pl = await getPlaylist(playlistId);
      setPlaylist(pl);
    } catch (err) {
      showMsg(err instanceof Error ? err.message : 'Regenerate failed');
    } finally {
      setRegenerating(false);
    }
  };

  // ── Add tracks callback ──
  const handleTracksAdded = (updated: PlaylistTrack[]) => {
    setTracks(updated);
    setShowAddTracks(false);
    showMsg('Tracks added');
    // Refresh playlist metadata
    getPlaylist(playlistId).then(setPlaylist).catch(() => { });
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-6 w-32 rounded bg-white/5 animate-pulse" />
        <div className="h-4 w-48 rounded bg-white/5 animate-pulse" />
        <div className="space-y-2 mt-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div>
        <BackButton onClick={onBack} />
        <div className="px-3 py-2 rounded-xl border border-rose/20 bg-rose/5 text-[11px] font-mono text-rose/80">
          {error || 'Playlist not found'}
        </div>
      </div>
    );
  }

  const missingPaths = tracks.filter((t) => !t.filePath).length;

  return (
    <div>
      {/* Back + Header */}
      <BackButton onClick={onBack} />

      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-display font-bold text-text-primary truncate">
              {playlist.name}
            </h2>
            {playlist.autoGenerate && (
              <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-violet-500/15 text-violet-400 border border-violet-500/20">
                Auto
              </span>
            )}
          </div>
          {playlist.description && (
            <p className="text-[11px] text-text-muted mt-0.5">{playlist.description}</p>
          )}
          <p className="text-[10px] font-mono text-text-muted mt-1">
            {tracks.length} track{tracks.length !== 1 ? 's' : ''}
            {missingPaths > 0 && (
              <span className="text-amber-400/80 ml-2">
                ({missingPaths} without file path)
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {playlist.autoGenerate && (
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="px-3 py-1.5 rounded-lg text-[11px] font-display font-semibold border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-all disabled:opacity-50"
            >
              {regenerating ? 'Running…' : 'Regenerate'}
            </button>
          )}
          <button
            onClick={() => setShowAddTracks(true)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-display font-semibold border border-border bg-glass text-text-secondary hover:text-cyan hover:border-cyan/30 transition-all"
          >
            + Add Tracks
          </button>
          {musicPathEnabled && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-3 py-1.5 rounded-lg text-[11px] font-display font-semibold bg-cyan/15 text-cyan border border-cyan/30 hover:bg-cyan/25 transition-all disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : 'Export .m3u8'}
            </button>
          )}
        </div>
      </div>

      {/* Action message */}
      <AnimatePresence>
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-3 px-3 py-2 rounded-xl border border-cyan/20 bg-cyan/5 text-[11px] font-mono text-cyan"
          >
            {actionMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Track list */}
      {tracks.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-2xl mb-2">🎶</p>
          <p className="text-sm font-display text-text-secondary">No tracks in this playlist</p>
          <p className="text-xs font-mono text-text-muted mt-1">Add tracks from your download history</p>
        </div>
      ) : (
        <div className="space-y-1">
          {tracks.map((track, i) => (
            <motion.div
              key={track.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="group flex items-center gap-3 p-2.5 rounded-xl border border-transparent hover:border-border hover:bg-white/[0.02] transition-all"
            >
              {/* Position */}
              <span className="w-5 text-[10px] font-mono text-text-muted text-right flex-shrink-0">
                {i + 1}
              </span>

              {/* Image */}
              <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 bg-surface">
                {track.image ? (
                  <img
                    src={proxyImage(track.image, '50x50')}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">♪</div>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-display font-semibold text-text-primary truncate">
                  {track.title}
                </p>
                <p className="text-[10px] text-text-muted truncate">
                  {track.artist}
                  {track.albumTitle && <span className="text-text-muted/60"> · {track.albumTitle}</span>}
                </p>
              </div>

              {/* Duration */}
              <span className="text-[10px] font-mono text-text-muted flex-shrink-0">
                {track.duration > 0 ? formatDuration(track.duration) : ''}
              </span>

              {/* File path indicator */}
              {!track.filePath && (
                <span className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-400/50" title="No file path" />
              )}

              {/* Actions */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={() => handleMove(i, 'up')}
                  disabled={i === 0}
                  className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-white disabled:opacity-30 transition-colors"
                  aria-label="Move up"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
                <button
                  onClick={() => handleMove(i, 'down')}
                  disabled={i === tracks.length - 1}
                  className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-white disabled:opacity-30 transition-colors"
                  aria-label="Move down"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <button
                  onClick={() => handleRemove(track.id)}
                  className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-rose transition-colors"
                  aria-label="Remove"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Add tracks panel */}
      <AnimatePresence>
        {showAddTracks && (
          <AddTracksPanel
            playlistId={playlistId}
            existingTrackIds={new Set(tracks.map((t) => t.saavnId))}
            onAdd={handleTracksAdded}
            onClose={() => setShowAddTracks(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Add Tracks Panel ─────────────────────────────────────────────────────────

function AddTracksPanel({
  playlistId,
  existingTrackIds,
  onAdd,
  onClose,
}: {
  playlistId: string;
  existingTrackIds: Set<string>;
  onAdd: (tracks: PlaylistTrack[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TrackSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const data = await searchTracksForPlaylist(q.trim(), 30);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleInput = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const toggleSelect = (saavnId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(saavnId)) next.delete(saavnId);
      else next.add(saavnId);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setAdding(true);
    try {
      const updated = await addTracksToPlaylist(playlistId, [...selected]);
      onAdd(updated);
    } catch {
      // error handled by parent
    } finally {
      setAdding(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-lg rounded-3xl border border-white/10 bg-black/90 backdrop-blur-xl p-5 shadow-2xl max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-display font-bold text-text-primary">Add Tracks</h3>
          <button onClick={onClose} className="text-text-muted hover:text-white transition-colors text-lg">✕</button>
        </div>

        {/* Search input */}
        <div className="relative mb-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Search your download history…"
            className="w-full px-3 py-2 rounded-xl border border-border bg-surface text-[12px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-cyan/40"
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 border border-cyan border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
          {results.length === 0 && query && !searching && (
            <p className="text-center text-[11px] font-mono text-text-muted py-6">No tracks found</p>
          )}
          {results.map((track) => {
            const alreadyIn = existingTrackIds.has(track.saavnId);
            const isSelected = selected.has(track.saavnId);
            return (
              <button
                key={track.id}
                onClick={() => !alreadyIn && toggleSelect(track.saavnId)}
                disabled={alreadyIn}
                className={`w-full flex items-center gap-3 p-2 rounded-xl text-left transition-all ${alreadyIn
                  ? 'opacity-40 cursor-not-allowed'
                  : isSelected
                    ? 'bg-cyan/10 border border-cyan/30'
                    : 'hover:bg-white/[0.03] border border-transparent'
                  }`}
              >
                <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-surface">
                  {track.image ? (
                    <img src={proxyImage(track.image, '50x50')} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">♪</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-display font-semibold text-text-primary truncate">{track.title}</p>
                  <p className="text-[10px] text-text-muted truncate">{track.artist}</p>
                </div>
                {alreadyIn && (
                  <span className="text-[9px] font-mono text-text-muted">already added</span>
                )}
                {isSelected && !alreadyIn && (
                  <span className="w-4 h-4 rounded-full bg-cyan flex items-center justify-center flex-shrink-0">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        {selected.size > 0 && (
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-[11px] font-mono text-text-muted">
              {selected.size} track{selected.size !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={handleAdd}
              disabled={adding}
              className="px-4 py-1.5 rounded-lg text-[11px] font-display font-semibold bg-cyan/15 text-cyan border border-cyan/30 hover:bg-cyan/25 transition-all disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add to Playlist'}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={onClick}
      className="mb-3 flex items-center gap-1.5 text-[12px] font-mono text-text-muted hover:text-violet-400 transition-colors group"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        className="group-hover:-translate-x-0.5 transition-transform">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      Back to playlists
    </motion.button>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
