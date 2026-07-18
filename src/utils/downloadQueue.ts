import type { SaavnSong, AlbumDetail, Quality } from '../types/saavn';
import type { TrackMetadata } from '../types/metadata';
import { downloadWithMetadata } from './download';
import { downloadAlbumIndividual, downloadAlbumZip, downloadAlbumLibrary, detectMultiArtist } from './albumDownload';
import type { AlbumDownloadMode, AlbumDownloadProgress } from './albumDownload';
import { recordDownload } from './history';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueItemType = 'track' | 'album';
export type QueueItemStatus = 'queued' | 'downloading' | 'done' | 'failed' | 'cancelled';

export interface QueueTrackItem {
  id: string;
  type: 'track';
  title: string;
  artist: string;
  image: string;
  status: QueueItemStatus;
  progress: number;
  stage: string;
  error?: string;
  addedAt: number;
  song: SaavnSong;
  quality: Quality;
  overrideMeta?: TrackMetadata;
  overrideFilename?: string;
}

export interface QueueAlbumItem {
  id: string;
  type: 'album';
  title: string;
  artist: string;
  image: string;
  status: QueueItemStatus;
  progress: number;
  stage: string;
  error?: string;
  addedAt: number;
  album: AlbumDetail;
  quality: Quality;
  mode: AlbumDownloadMode;
  albumArtistOverride?: string;
  trackProgress?: AlbumDownloadProgress;
}

export type QueueItem = QueueTrackItem | QueueAlbumItem;

export interface QueueState {
  items: QueueItem[];
  isProcessing: boolean;
  isPaused: boolean;
}

export type QueueListener = (state: QueueState) => void;

// ─── Queue Manager (singleton) ────────────────────────────────────────────────

class DownloadQueueManager {
  private items: QueueItem[] = [];
  private isProcessing = false;
  private isPaused = false;
  private listeners: Set<QueueListener> = new Set();
  private abortController: AbortController | null = null;
  private cancelled = false;

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState(): QueueState {
    return { items: [...this.items], isProcessing: this.isProcessing, isPaused: this.isPaused };
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  // ── Add items ─────────────────────────────────────────────────────────────

  addTrack(
    song: SaavnSong,
    quality: Quality,
    overrideMeta?: TrackMetadata,
    overrideFilename?: string,
  ): void {
    const artist =
      song.subtitle?.split(' - ')[0]?.trim() ||
      song.more_info.artists?.primary?.[0]?.name ||
      'Unknown Artist';

    const item: QueueTrackItem = {
      id: `track-${song.id}-${Date.now()}`,
      type: 'track',
      title: song.title,
      artist,
      image: song.image,
      status: 'queued',
      progress: 0,
      stage: 'Queued',
      addedAt: Date.now(),
      song,
      quality,
      overrideMeta,
      overrideFilename,
    };

    this.items.push(item);
    this.emit();
    this.processNext();
  }

  addAlbum(
    album: AlbumDetail,
    quality: Quality,
    mode: AlbumDownloadMode,
    albumArtistOverride?: string,
  ): void {
    const artist =
      album.artists?.primary?.map((a) => a.name).join(', ') || album.subtitle || 'Unknown Artist';

    const item: QueueAlbumItem = {
      id: `album-${album.id}-${Date.now()}`,
      type: 'album',
      title: album.title,
      artist,
      image: album.image,
      status: 'queued',
      progress: 0,
      stage: 'Queued',
      addedAt: Date.now(),
      album,
      quality,
      mode,
      albumArtistOverride,
    };

    this.items.push(item);
    this.emit();
    this.processNext();
  }

  // ── Remove / Cancel ───────────────────────────────────────────────────────

  removeItem(id: string): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const item = this.items[idx];
    if (item.status === 'downloading') {
      // Cancel active download
      this.cancelCurrent();
    } else {
      this.items.splice(idx, 1);
    }
    this.emit();
  }

  cancelCurrent(): void {
    if (!this.isProcessing) return;
    this.cancelled = true;
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  // ── Retry ─────────────────────────────────────────────────────────────────

  retryItem(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (!item || (item.status !== 'failed' && item.status !== 'cancelled')) return;
    item.status = 'queued';
    item.progress = 0;
    item.stage = 'Queued (retry)';
    item.error = undefined;
    this.emit();
    this.processNext();
  }

  // ── Clear ─────────────────────────────────────────────────────────────────

  clearCompleted(): void {
    this.items = this.items.filter((i) => i.status !== 'done' && i.status !== 'failed' && i.status !== 'cancelled');
    this.emit();
  }

  clearAll(): void {
    // Cancel active download if any
    if (this.isProcessing) {
      this.cancelCurrent();
    }
    // Remove all non-active items
    this.items = this.items.filter((i) => i.status === 'downloading');
    this.emit();
  }

  // ── Pause / Resume ────────────────────────────────────────────────────────

  pause(): void {
    this.isPaused = true;
    this.emit();
  }

  resume(): void {
    this.isPaused = false;
    this.emit();
    this.processNext();
  }

  // ── Reorder ───────────────────────────────────────────────────────────────

  moveUp(id: string): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx <= 0) return;
    const item = this.items[idx];
    if (item.status !== 'queued') return;
    // Find the previous queued item to swap with
    let prevIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (this.items[i].status === 'queued') { prevIdx = i; break; }
    }
    if (prevIdx === -1) return;
    [this.items[prevIdx], this.items[idx]] = [this.items[idx], this.items[prevIdx]];
    this.emit();
  }

  moveDown(id: string): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1 || idx >= this.items.length - 1) return;
    const item = this.items[idx];
    if (item.status !== 'queued') return;
    // Find the next queued item to swap with
    const nextIdx = this.items.slice(idx + 1).findIndex((i) => i.status === 'queued');
    if (nextIdx === -1) return;
    const actualNextIdx = idx + 1 + nextIdx;
    [this.items[idx], this.items[actualNextIdx]] = [this.items[actualNextIdx], this.items[idx]];
    this.emit();
  }

  // ── Processing ────────────────────────────────────────────────────────────

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.isPaused) return;

    const next = this.items.find((i) => i.status === 'queued');
    if (!next) return;

    this.isProcessing = true;
    this.cancelled = false;
    this.abortController = new AbortController();
    next.status = 'downloading';
    next.stage = 'Starting…';
    this.emit();

    try {
      if (next.type === 'track') {
        await this.processTrack(next);
      } else {
        await this.processAlbum(next);
      }

      if (this.cancelled) {
        next.status = 'cancelled';
        next.stage = 'Cancelled';
      } else {
        next.status = 'done';
        next.progress = 100;
        next.stage = 'Done!';

        // Record to download history
        this.recordToHistory(next).catch(() => { /* best-effort */ });
      }
    } catch (err) {
      if (this.cancelled) {
        next.status = 'cancelled';
        next.stage = 'Cancelled';
      } else {
        next.status = 'failed';
        next.error = err instanceof Error ? err.message : 'Download failed';
        next.stage = 'Failed';
      }
    }

    this.isProcessing = false;
    this.abortController = null;
    this.emit();

    // Process next in queue
    if (!this.isPaused) {
      this.processNext();
    }
  }

  private async processTrack(item: QueueTrackItem): Promise<void> {
    await downloadWithMetadata({
      song: item.song,
      quality: item.quality,
      onProgress: (stage, percent) => {
        if (this.cancelled) return;
        item.stage = stage;
        item.progress = percent;
        this.emit();
      },
      overrideMeta: item.overrideMeta,
      overrideFilename: item.overrideFilename,
    });
  }

  private async processAlbum(item: QueueAlbumItem): Promise<void> {
    const onProgress = (p: AlbumDownloadProgress) => {
      if (this.cancelled) return;
      item.trackProgress = p;
      item.progress = p.percent;
      item.stage = p.zipStage
        ? p.zipStage === 'compressing'
          ? 'Creating ZIP…'
          : p.zipStage === 'preparing'
            ? 'Preparing…'
            : 'Done'
        : `Track ${p.current}/${p.total}: ${p.stage}`;
      this.emit();
    };

    // Auto-skip failures in background mode (no interactive prompt)
    const onFailure = async (): Promise<'skip' | 'retry'> => 'retry';

    // Navidrome fix: if no override was provided, auto-detect multi-artist albums
    // and apply a unified Album Artist tag so they don't get split
    let albumArtist = item.albumArtistOverride;
    if (!albumArtist) {
      const multiArtistInfo = detectMultiArtist(item.album);
      if (multiArtistInfo.isMultiArtist) {
        albumArtist = multiArtistInfo.suggestedAlbumArtist;
      }
    }

    if (item.mode === 'zip') {
      await downloadAlbumZip(item.album, item.quality, onProgress, onFailure, albumArtist);
    } else if (item.mode === 'library') {
      await downloadAlbumLibrary(item.album, item.quality, onProgress, onFailure, albumArtist);
    } else {
      await downloadAlbumIndividual(item.album, item.quality, onProgress, onFailure, albumArtist);
    }
  }

  // ── History recording ─────────────────────────────────────────────────────

  private async recordToHistory(item: QueueItem): Promise<void> {
    if (item.type === 'track') {
      await recordDownload({
        saavnId: item.song.id,
        type: 'track',
        title: item.title,
        artist: item.artist,
        album: item.song.more_info?.album || '',
        image: item.song.image || '',
        quality: item.quality,
        mode: '',
        songCount: 0,
      });
    } else {
      await recordDownload({
        saavnId: item.album.id,
        type: 'album',
        title: item.title,
        artist: item.artist,
        album: item.title,
        image: item.album.image || '',
        quality: item.quality,
        mode: item.mode,
        songCount: item.album.songs?.length || 0,
      });
    }
  }
}

// Singleton instance
export const downloadQueue = new DownloadQueueManager();
