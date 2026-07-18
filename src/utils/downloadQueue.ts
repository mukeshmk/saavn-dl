import type { SaavnSong, AlbumDetail, Quality } from '../types/saavn';
import type { TrackMetadata } from '../types/metadata';
import { downloadWithMetadata } from './download';
import { downloadAlbumIndividual, downloadAlbumZip, downloadAlbumLibrary } from './albumDownload';
import type { AlbumDownloadMode, AlbumDownloadProgress } from './albumDownload';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueItemType = 'track' | 'album';
export type QueueItemStatus = 'queued' | 'downloading' | 'done' | 'failed';

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
}

export type QueueListener = (state: QueueState) => void;

// ─── Queue Manager (singleton) ────────────────────────────────────────────────

class DownloadQueueManager {
  private items: QueueItem[] = [];
  private isProcessing = false;
  private listeners: Set<QueueListener> = new Set();

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState(): QueueState {
    return { items: [...this.items], isProcessing: this.isProcessing };
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

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
      album,
      quality,
      mode,
      albumArtistOverride,
    };

    this.items.push(item);
    this.emit();
    this.processNext();
  }

  removeItem(id: string): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const item = this.items[idx];
    // Only remove if not currently downloading
    if (item.status !== 'downloading') {
      this.items.splice(idx, 1);
      this.emit();
    }
  }

  clearCompleted(): void {
    this.items = this.items.filter((i) => i.status !== 'done' && i.status !== 'failed');
    this.emit();
  }

  retryItem(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (!item || item.status !== 'failed') return;
    item.status = 'queued';
    item.progress = 0;
    item.stage = 'Queued (retry)';
    item.error = undefined;
    this.emit();
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) return;

    const next = this.items.find((i) => i.status === 'queued');
    if (!next) return;

    this.isProcessing = true;
    next.status = 'downloading';
    next.stage = 'Starting…';
    this.emit();

    try {
      if (next.type === 'track') {
        await this.processTrack(next);
      } else {
        await this.processAlbum(next);
      }
      next.status = 'done';
      next.progress = 100;
      next.stage = 'Done!';
    } catch (err) {
      next.status = 'failed';
      next.error = err instanceof Error ? err.message : 'Download failed';
      next.stage = 'Failed';
    }

    this.isProcessing = false;
    this.emit();

    // Process next in queue
    this.processNext();
  }

  private async processTrack(item: QueueTrackItem): Promise<void> {
    await downloadWithMetadata({
      song: item.song,
      quality: item.quality,
      onProgress: (stage, percent) => {
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

    if (item.mode === 'zip') {
      await downloadAlbumZip(item.album, item.quality, onProgress, onFailure, item.albumArtistOverride);
    } else if (item.mode === 'library') {
      await downloadAlbumLibrary(item.album, item.quality, onProgress, onFailure, item.albumArtistOverride);
    } else {
      await downloadAlbumIndividual(item.album, item.quality, onProgress, onFailure, item.albumArtistOverride);
    }
  }
}

// Singleton instance
export const downloadQueue = new DownloadQueueManager();
