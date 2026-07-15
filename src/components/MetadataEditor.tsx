import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TrackMetadata } from '../types/metadata';
import { sanitizeFilenameField } from '../types/metadata';

interface MetadataEditorProps {
  original: TrackMetadata;
  current:  TrackMetadata;
  onUpdate: (meta: TrackMetadata) => void;
  onReset:  () => void;
  onClose:  () => void;
}

// ─── Field config ─────────────────────────────────────────────────────────────

interface FieldDef {
  key:         keyof Omit<TrackMetadata, 'filename'>;
  label:       string;
  placeholder: string;
  hint?:       string;
}

const FIELDS: FieldDef[] = [
  { key: 'title',       label: 'Track Title',   placeholder: 'Track title' },
  { key: 'artist',      label: 'Artist',         placeholder: 'Artist name' },
  { key: 'albumArtist', label: 'Album Artist',   placeholder: 'Album artist' },
  { key: 'album',       label: 'Album',          placeholder: 'Album name' },
  { key: 'genre',       label: 'Genre',          placeholder: 'e.g. Pop, Hip-Hop' },
  { key: 'year',        label: 'Release Year',   placeholder: 'YYYY' },
  { key: 'trackNumber', label: 'Track Number',   placeholder: 'e.g. 3 or 3/10' },
  { key: 'discNumber',  label: 'Disc Number',    placeholder: 'e.g. 1 or 1/2' },
  { key: 'composer',    label: 'Composer',       placeholder: 'Composer name' },
  { key: 'copyright',   label: 'Copyright',      placeholder: '© Year Label' },
];

const LOCKED_FIELDS = [
  { label: 'Album Art',   value: 'Embedded automatically from JioSaavn' },
  { label: 'Comment',  value: 'Downloaded via saavn-dl / Rhythmax' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function MetadataEditor({
  original,
  current,
  onUpdate,
  onReset,
  onClose,
}: MetadataEditorProps) {
  const [draft, setDraft] = useState<TrackMetadata>({ ...current });
  const overlayRef = useRef<HTMLDivElement>(null);

  // Sync if caller resets externally
  useEffect(() => { setDraft({ ...current }); }, [current]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const set = <K extends keyof TrackMetadata>(key: K, value: TrackMetadata[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handleFilenameBlur = () => {
    const sanitized = sanitizeFilenameField(draft.filename);
    const fallback  = sanitizeFilenameField(`${draft.title} - ${draft.artist}`);
    set('filename', sanitized || fallback);
  };

  const handleUpdate = () => {
    const sanitized = sanitizeFilenameField(draft.filename);
    const fallback  = sanitizeFilenameField(`${draft.title} - ${draft.artist}`);
    onUpdate({ ...draft, filename: sanitized || fallback });
  };

  const handleReset = () => {
    setDraft({ ...original });
    onReset();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-md"
      onClick={handleOverlayClick}
    >
      <motion.div
        initial={{ opacity: 0, y: 48, scale: 0.97 }}
        animate={{ opacity: 1, y: 0,  scale: 1 }}
        exit={{   opacity: 0, y: 24, scale: 0.97 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="
          w-full sm:max-w-lg
          rounded-t-3xl sm:rounded-2xl
          border border-border
          bg-[#0e0e12]
          shadow-2xl
          flex flex-col
          max-h-[92dvh] sm:max-h-[88vh]
          overflow-hidden
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-base font-display font-bold text-text-primary">Edit Metadata</h2>
            <p className="text-[11px] font-mono text-white/60 mt-0.5">
              Changes apply to FFmpeg download only
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-white/5 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6"  x2="6"  y2="18"/>
              <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 overscroll-contain">

          {/* Filename field */}
          <div>
            <label className="block text-[11px] font-mono text-white/60 uppercase tracking-wider mb-1.5">
              Filename
            </label>
            <div className="flex items-center gap-0 rounded-xl border border-border bg-glass overflow-hidden focus-within:border-cyan/40 transition-colors">
              <input
                type="text"
                value={draft.filename}
                onChange={(e) => set('filename', e.target.value)}
                onBlur={handleFilenameBlur}
                placeholder="filename"
                className="flex-1 bg-transparent px-3.5 py-2.5 text-sm font-mono text-text-primary placeholder:text-text-muted outline-none min-w-0"
              />
              <span className="flex-shrink-0 pr-3.5 text-[12px] font-mono text-cyan/70 select-none">.m4a</span>
            </div>
            <p className="mt-1 text-[10px] font-mono text-white/60">
              Invalid characters (\ / : * ? &quot; &lt; &gt; |) are removed on download
            </p>
          </div>

          <div className="h-px bg-border" />

          {/* Editable tag fields */}
          <div className="space-y-3">
            <p className="text-[11px] font-mono text-white/60 uppercase tracking-wider">Tags</p>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="block text-[11px] font-mono text-white/60 mb-1">
                  {f.label}
                </label>
                <input
                  type="text"
                  value={draft[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="
                    w-full bg-glass border border-border rounded-xl
                    px-3.5 py-2.5 text-sm font-body text-text-primary
                    placeholder:text-text-muted/50 outline-none
                    focus:border-cyan/40
                    transition-colors duration-150
                  "
                />
                {f.hint && (
                  <p className="mt-0.5 text-[10px] font-mono text-text-muted/60">{f.hint}</p>
                )}
              </div>
            ))}
          </div>

          <div className="h-px bg-border" />

          {/* Locked fields */}
          <div className="space-y-2">
            <p className="text-[11px] font-mono text-white/40 uppercase tracking-wider">
              Auto-managed (locked)
            </p>
            {LOCKED_FIELDS.map((f) => (
              <div key={f.label} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-border/50 bg-surface">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-mono text-white/40">{f.label}</p>
                  <p className="text-xs font-body text-white/40 truncate mt-0.5">{f.value}</p>
                </div>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#44445a" strokeWidth="2" className="flex-shrink-0">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
            ))}
          </div>

          {/* Bottom padding so sticky footer doesn't overlap last field */}
          <div className="h-4" />
        </div>

        {/* ── Sticky footer ────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-border px-5 py-4 flex gap-2 bg-[#0e0e12]">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleReset}
            className="
              flex-1 py-2.5 rounded-xl
              border border-border
              text-sm font-display font-medium text-text-secondary
              hover:text-text-primary hover:border-white/20
              transition-all duration-150
            "
          >
            Reset
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleUpdate}
            className="
              flex-1 py-2.5 rounded-xl
              bg-cyan text-void
              text-sm font-display font-semibold
              hover:bg-cyan-dim shadow-glow
              transition-all duration-150
            "
          >
            Update
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
