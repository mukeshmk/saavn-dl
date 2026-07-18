import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SyncControls from './SyncControls';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  type: 'file';
  size: number;
  modifiedDate: string;
}

interface DirEntry {
  name: string;
  type: 'directory';
  fileCount: number;
  modifiedDate: string;
}

type Entry = FileEntry | DirEntry;

interface BrowseResult {
  path: string;
  entries: Entry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Component ────────────────────────────────────────────────────────────────

interface LibraryPageProps {
  onBack: () => void;
}

export default function LibraryPage({ onBack }: LibraryPageProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Record<string, Entry[]>>({});
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  const fetchBrowse = useCallback(async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`/api/library/browse?path=${encodeURIComponent(path)}`);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      const data: BrowseResult = await resp.json();
      setEntries(data.entries);
      setCurrentPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrowse('');
  }, [fetchBrowse]);

  const toggleDir = async (dirName: string) => {
    const fullPath = currentPath ? `${currentPath}/${dirName}` : dirName;

    if (expandedDirs[fullPath]) {
      // Collapse
      const updated = { ...expandedDirs };
      delete updated[fullPath];
      setExpandedDirs(updated);
      return;
    }

    // Expand — fetch contents
    setLoadingDirs((prev) => new Set(prev).add(fullPath));
    try {
      const resp = await fetch(`/api/library/browse?path=${encodeURIComponent(fullPath)}`);
      if (!resp.ok) throw new Error('Failed to load');
      const data: BrowseResult = await resp.json();
      setExpandedDirs((prev) => ({ ...prev, [fullPath]: data.entries }));
    } catch {
      // Silently fail for now
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.delete(fullPath);
        return next;
      });
    }
  };

  const navigateUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = parts.join('/');
    setExpandedDirs({});
    fetchBrowse(parentPath);
  };

  const navigateInto = (dirName: string) => {
    const fullPath = currentPath ? `${currentPath}/${dirName}` : dirName;
    setExpandedDirs({});
    fetchBrowse(fullPath);
  };

  // ── Breadcrumbs ───────────────────────────────────────────────────────────

  const pathParts = currentPath ? currentPath.split('/') : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Back button */}
      <motion.button
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-[12px] font-mono text-text-muted hover:text-cyan transition-colors group"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className="group-hover:-translate-x-0.5 transition-transform"><polyline points="15 18 9 12 15 6"/></svg>
        Back to home
      </motion.button>

      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-cyan/10 border border-cyan/20 flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-display font-bold text-text-primary">Library</h2>
          <p className="text-[11px] font-mono text-text-muted">Staged files ready to sync to NAS</p>
        </div>
      </div>

      {/* Sync Controls */}
      <SyncControls onSyncComplete={() => fetchBrowse(currentPath)} />

      {/* Breadcrumb nav */}
      {currentPath && (
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          <button
            onClick={() => { setExpandedDirs({}); fetchBrowse(''); }}
            className="text-[11px] font-mono text-cyan hover:text-cyan-dim transition-colors"
          >
            root
          </button>
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-[11px] text-text-muted">/</span>
              <button
                onClick={() => {
                  const target = pathParts.slice(0, i + 1).join('/');
                  setExpandedDirs({});
                  fetchBrowse(target);
                }}
                className={`text-[11px] font-mono transition-colors ${
                  i === pathParts.length - 1 ? 'text-text-primary' : 'text-cyan hover:text-cyan-dim'
                }`}
              >
                {part}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Content area */}
      <div className="rounded-2xl border border-border bg-glass/50 overflow-hidden">
        {loading ? (
          <div className="p-6 flex items-center justify-center">
            <span className="w-4 h-4 border-2 border-cyan border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-[12px] font-mono text-text-muted">Loading...</span>
          </div>
        ) : error ? (
          <div className="p-5 flex items-start gap-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff6b8a" strokeWidth="2" className="flex-shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div>
              <p className="text-sm font-display font-semibold text-rose">Failed to load</p>
              <p className="text-xs font-mono text-rose/70 mt-0.5">{error}</p>
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-3xl mb-3">📂</p>
            <p className="text-sm font-display font-semibold text-text-secondary">
              {currentPath ? 'Empty folder' : 'Library is empty'}
            </p>
            <p className="text-xs font-mono text-text-muted mt-1.5">
              {currentPath ? 'No files in this directory' : 'Download songs to see them here'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Up navigation */}
            {currentPath && (
              <button
                onClick={navigateUp}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors text-left"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
                <span className="text-[12px] font-mono text-text-muted">..</span>
              </button>
            )}

            {/* Entries */}
            {entries.map((entry) => (
              <EntryRow
                key={entry.name}
                entry={entry}
                basePath={currentPath}
                expandedDirs={expandedDirs}
                loadingDirs={loadingDirs}
                onToggle={toggleDir}
                onNavigate={navigateInto}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Entry row ────────────────────────────────────────────────────────────────

function EntryRow({
  entry,
  basePath,
  expandedDirs,
  loadingDirs,
  onToggle,
  onNavigate,
  depth = 0,
}: {
  entry: Entry;
  basePath: string;
  expandedDirs: Record<string, Entry[]>;
  loadingDirs: Set<string>;
  onToggle: (name: string) => void;
  onNavigate: (name: string) => void;
  depth?: number;
}) {
  const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;
  const isExpanded = !!expandedDirs[fullPath];
  const isLoading = loadingDirs.has(fullPath);
  const childEntries = expandedDirs[fullPath] || [];

  if (entry.type === 'directory') {
    return (
      <>
        <div
          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors cursor-pointer"
          style={{ paddingLeft: `${16 + depth * 20}px` }}
        >
          {/* Expand/collapse chevron */}
          <button
            onClick={() => onToggle(entry.name)}
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center"
          >
            {isLoading ? (
              <span className="w-3 h-3 border border-cyan border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                className={`text-text-muted transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
              >
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            )}
          </button>

          {/* Folder icon + name (clickable to navigate into) */}
          <button
            onClick={() => onNavigate(entry.name)}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className={isExpanded ? 'text-cyan' : 'text-text-muted'}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="text-[12px] font-mono text-text-primary truncate">{entry.name}</span>
          </button>

          {/* Metadata */}
          <span className="text-[10px] font-mono text-text-muted flex-shrink-0">
            {entry.fileCount} {entry.fileCount === 1 ? 'file' : 'files'}
          </span>
          <span className="text-[10px] font-mono text-text-muted/60 flex-shrink-0 w-16 text-right">
            {formatDate(entry.modifiedDate)}
          </span>
        </div>

        {/* Expanded children */}
        <AnimatePresence>
          {isExpanded && childEntries.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {childEntries.map((child) => (
                <EntryRow
                  key={child.name}
                  entry={child}
                  basePath={fullPath}
                  expandedDirs={expandedDirs}
                  loadingDirs={loadingDirs}
                  onToggle={(name) => onToggle(`${entry.name}/${name}`)}
                  onNavigate={(name) => onNavigate(`${entry.name}/${name}`)}
                  depth={depth + 1}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  // File row
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5"
      style={{ paddingLeft: `${16 + depth * 20 + 24}px` }}
    >
      {/* File icon */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted/60 flex-shrink-0">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>

      {/* Name */}
      <span className="text-[12px] font-mono text-text-secondary truncate flex-1">{entry.name}</span>

      {/* Size */}
      <span className="text-[10px] font-mono text-text-muted flex-shrink-0">
        {formatBytes((entry as FileEntry).size)}
      </span>

      {/* Date */}
      <span className="text-[10px] font-mono text-text-muted/60 flex-shrink-0 w-16 text-right">
        {formatDate(entry.modifiedDate)}
      </span>
    </div>
  );
}
