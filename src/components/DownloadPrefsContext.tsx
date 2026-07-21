import { createContext, useContext, useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TrackDownloadAction = 'download' | 'library' | 'queue';
export type AlbumDownloadAction = 'zip' | 'individual' | 'library' | 'queue';

interface DownloadPrefs {
  /** Default action for single-track downloads */
  trackAction: TrackDownloadAction;
  /** Default action for album batch downloads */
  albumAction: AlbumDownloadAction;
  /** Whether to embed metadata via ffmpeg */
  embedMeta: boolean;
  /** Whether Save to Library is available (server-side check) */
  libraryEnabled: boolean;
}

interface DownloadPrefsContextValue extends DownloadPrefs {
  setTrackAction: (action: TrackDownloadAction) => void;
  setAlbumAction: (action: AlbumDownloadAction) => void;
  setEmbedMeta: (embed: boolean) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const DownloadPrefsCtx = createContext<DownloadPrefsContextValue | null>(null);

export function useDownloadPrefs(): DownloadPrefsContextValue {
  const ctx = useContext(DownloadPrefsCtx);
  if (!ctx) throw new Error('useDownloadPrefs must be used within DownloadPrefsProvider');
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DownloadPrefsProvider({ children }: { children: React.ReactNode }) {
  const [trackAction, setTrackAction] = useState<TrackDownloadAction>('download');
  const [albumAction, setAlbumAction] = useState<AlbumDownloadAction>('zip');
  const [embedMeta, setEmbedMeta] = useState(true);
  const [libraryEnabled, setLibraryEnabled] = useState(false);

  // Check if library is enabled on mount
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        if (data.libraryEnabled) {
          setLibraryEnabled(true);
          // Default to library if available
          setTrackAction('library');
          setAlbumAction('library');
        }
      })
      .catch(() => {});
  }, []);

  const handleSetTrackAction = useCallback((action: TrackDownloadAction) => {
    // Don't allow setting library if not enabled
    if (action === 'library' && !libraryEnabled) return;
    setTrackAction(action);
  }, [libraryEnabled]);

  const handleSetAlbumAction = useCallback((action: AlbumDownloadAction) => {
    if (action === 'library' && !libraryEnabled) return;
    setAlbumAction(action);
  }, [libraryEnabled]);

  return (
    <DownloadPrefsCtx.Provider
      value={{
        trackAction,
        albumAction,
        embedMeta,
        libraryEnabled,
        setTrackAction: handleSetTrackAction,
        setAlbumAction: handleSetAlbumAction,
        setEmbedMeta,
      }}
    >
      {children}
    </DownloadPrefsCtx.Provider>
  );
}
