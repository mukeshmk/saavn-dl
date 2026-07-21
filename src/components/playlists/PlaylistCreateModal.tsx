import { useState } from 'react';
import { motion } from 'framer-motion';
import { proxyImage } from '../../types/saavn';
import type { Playlist, AutoCriteria, AutoCriteriaRule, TrackSearchResult } from '../../utils/playlists';
import { createPlaylist, previewAutoCriteria } from '../../utils/playlists';

interface PlaylistCreateModalProps {
  onClose: () => void;
  onCreated: (playlist: Playlist) => void;
}

type Mode = 'manual' | 'auto';

const FIELD_OPTIONS: { value: AutoCriteriaRule['field']; label: string }[] = [
  { value: 'year', label: 'Year' },
  { value: 'language', label: 'Language' },
  { value: 'playCount', label: 'Play Count' },
  { value: 'artist', label: 'Artist' },
  { value: 'albumTitle', label: 'Album' },
  { value: 'duration', label: 'Duration (sec)' },
  { value: 'title', label: 'Title' },
  { value: 'quality', label: 'Quality' },
];

const OP_OPTIONS: { value: AutoCriteriaRule['op']; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
  { value: 'contains', label: 'contains' },
];

const SORT_OPTIONS: { value: AutoCriteria['sort']; label: string }[] = [
  { value: 'playCount', label: 'Play Count' },
  { value: 'year', label: 'Year' },
  { value: 'downloadedAt', label: 'Download Date' },
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'duration', label: 'Duration' },
];

export default function PlaylistCreateModal({ onClose, onCreated }: PlaylistCreateModalProps) {
  const [mode, setMode] = useState<Mode>('manual');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Auto-generate state
  const [rules, setRules] = useState<AutoCriteriaRule[]>([]);
  const [sort, setSort] = useState<AutoCriteria['sort']>('playCount');
  const [sortOrder, setSortOrder] = useState<AutoCriteria['sortOrder']>('desc');
  const [limit, setLimit] = useState(50);
  const [preview, setPreview] = useState<TrackSearchResult[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const addRule = () => {
    setRules([...rules, { field: 'year', op: 'gte', value: '' }]);
  };

  const updateRule = (index: number, patch: Partial<AutoCriteriaRule>) => {
    setRules(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const buildCriteria = (): AutoCriteria => ({
    rules: rules.filter((r) => r.value !== ''),
    sort,
    sortOrder,
    limit,
  });

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const criteria = buildCriteria();
      const tracks = await previewAutoCriteria(criteria);
      setPreview(tracks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const playlist = await createPlaylist({
        name: name.trim(),
        description: description.trim(),
        autoGenerate: mode === 'auto',
        autoCriteria: mode === 'auto' ? buildCriteria() : undefined,
      });
      onCreated(playlist);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
      setCreating(false);
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
        className="w-full max-w-lg rounded-3xl border border-white/10 bg-black/90 backdrop-blur-xl p-5 shadow-2xl max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-display font-bold text-text-primary">New Playlist</h3>
          <button onClick={onClose} className="text-text-muted hover:text-white transition-colors text-lg">✕</button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 mb-4">
          {(['manual', 'auto'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-display font-semibold capitalize transition-all ${mode === m
                ? 'bg-cyan/10 border border-cyan/30 text-cyan'
                : 'border border-transparent text-text-muted hover:text-text-secondary hover:border-border'
                }`}
            >
              {m === 'auto' ? 'Auto-Generate' : 'Manual'}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-1">
          {/* Name + Description */}
          <div>
            <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Playlist"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-border bg-surface text-[12px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-cyan/40"
            />
          </div>

          <div>
            <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description…"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-border bg-surface text-[12px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-cyan/40"
            />
          </div>

          {/* Auto-generate criteria */}
          {mode === 'auto' && (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Filter Rules</span>
                <button
                  onClick={addRule}
                  className="text-[10px] font-mono text-cyan hover:text-cyan/80 transition-colors"
                >
                  + Add Rule
                </button>
              </div>

              {rules.length === 0 && (
                <p className="text-[10px] font-mono text-text-muted/60 italic">
                  No rules — will match all tracks in your history
                </p>
              )}

              {rules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={rule.field}
                    onChange={(e) => updateRule(i, { field: e.target.value as AutoCriteriaRule['field'] })}
                    className="px-2 py-1.5 rounded-lg border border-border bg-surface text-[11px] text-text-primary focus:outline-none focus:border-cyan/40"
                  >
                    {FIELD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>

                  <select
                    value={rule.op}
                    onChange={(e) => updateRule(i, { op: e.target.value as AutoCriteriaRule['op'] })}
                    className="px-2 py-1.5 rounded-lg border border-border bg-surface text-[11px] text-text-primary focus:outline-none focus:border-cyan/40"
                  >
                    {OP_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={rule.value}
                    onChange={(e) => updateRule(i, { value: e.target.value })}
                    placeholder="value"
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-border bg-surface text-[11px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-cyan/40"
                  />

                  <button
                    onClick={() => removeRule(i)}
                    className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-rose transition-colors flex-shrink-0"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}

              {/* Sort + Limit */}
              <div className="flex items-center gap-3 pt-2">
                <div className="flex-1">
                  <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Sort by</label>
                  <div className="flex gap-1 mt-1">
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value as AutoCriteria['sort'])}
                      className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-surface text-[11px] text-text-primary focus:outline-none focus:border-cyan/40"
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                      className="px-2 py-1.5 rounded-lg border border-border bg-surface text-[11px] text-text-primary hover:border-cyan/40 transition-all"
                      title={sortOrder === 'desc' ? 'Descending' : 'Ascending'}
                    >
                      {sortOrder === 'desc' ? '↓' : '↑'}
                    </button>
                  </div>
                </div>

                <div className="w-20">
                  <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Limit</label>
                  <input
                    type="number"
                    value={limit}
                    onChange={(e) => setLimit(Math.max(1, Math.min(500, parseInt(e.target.value) || 50)))}
                    min={1}
                    max={500}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg border border-border bg-surface text-[11px] text-text-primary focus:outline-none focus:border-cyan/40"
                  />
                </div>
              </div>

              {/* Preview button */}
              <button
                onClick={handlePreview}
                disabled={previewing}
                className="w-full px-3 py-2 rounded-xl text-[11px] font-display font-semibold border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-all disabled:opacity-50"
              >
                {previewing ? 'Loading preview…' : 'Preview Results'}
              </button>

              {/* Preview results */}
              {preview !== null && (
                <div className="rounded-xl border border-border bg-surface/50 p-3">
                  <p className="text-[10px] font-mono text-text-muted mb-2">
                    {preview.length} track{preview.length !== 1 ? 's' : ''} match
                  </p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {preview.slice(0, 20).map((track) => (
                      <div key={track.id} className="flex items-center gap-2 py-1">
                        <div className="w-6 h-6 rounded overflow-hidden flex-shrink-0 bg-surface">
                          {track.image ? (
                            <img src={proxyImage(track.image, '50x50')} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] text-text-muted">♪</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold text-text-primary truncate">{track.title}</p>
                          <p className="text-[9px] text-text-muted truncate">{track.artist}</p>
                        </div>
                        {track.playCount > 0 && (
                          <span className="text-[9px] font-mono text-text-muted flex-shrink-0">
                            {formatCount(track.playCount)}
                          </span>
                        )}
                      </div>
                    ))}
                    {preview.length > 20 && (
                      <p className="text-[9px] font-mono text-text-muted text-center pt-1">
                        …and {preview.length - 20} more
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Manual mode hint */}
          {mode === 'manual' && (
            <div className="pt-2 border-t border-border">
              <p className="text-[10px] font-mono text-text-muted/60 italic">
                After creating, you can add tracks from your download history using the search panel.
              </p>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mt-3 px-3 py-2 rounded-xl border border-rose/20 bg-rose/5 text-[11px] font-mono text-rose/80">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-[11px] font-display font-semibold text-text-muted hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="px-4 py-2 rounded-xl text-[11px] font-display font-semibold bg-cyan/15 text-cyan border border-cyan/30 hover:bg-cyan/25 transition-all disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create Playlist'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
