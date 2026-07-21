# saavn-dl

A browser-based JioSaavn downloader with ffmpeg-powered metadata embedding.  
Search by song, album, or artist — browse discographies and download entire albums with full metadata and cover art.

Built with React 18, Vite, TypeScript, and TailwindCSS.

---

## Features

- **Search & browse** — paste a JioSaavn URL or search by song, album, artist, or playlist name
- **Artist discographies** — browse an artist's albums, singles, and latest releases
- **Playlist support** — search JioSaavn curated playlists, view track lists, download entire playlists
- **Discover tab** — personalized suggestions with trending, new releases, curated playlists, and related albums
- **Audio preview** — listen before you download
- **Quality selector** — up to 320 kbps M4A
- **Metadata editor** — edit title, artist, album, year per-track before downloading
- **Navidrome compatibility** — auto-detects multi-artist albums and offers a unified Album Artist tag
- **Background download queue** — queue multiple songs/albums/playlists with pause, cancel, reorder, and retry
- **Save to Library** — save tracks directly to a server-side directory (Artist/Album/Track structure)
- **Library Sync** — stage downloads on a fast SSD and sync to NAS on a cron schedule
- **Download History** — SQLite-backed history with "already downloaded" badges on search results
- **VPN proxy** — all CDN fetches routed server-side, compatible with Gluetun/WireGuard

---

## Stack

| Layer | Technology |
|-------|-----------|
| UI | React 18, TailwindCSS, Framer Motion |
| Build | Vite 5, TypeScript 5 |
| Audio | ffmpeg.wasm (in-browser), CryptoJS (DES decryption) |
| Server | Node 20 (raw `node:http`), better-sqlite3, node-cron |
| Packaging | Docker (multi-stage Bookworm build) |

---

## Quick Start

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

---

## Docker

```bash
docker build -t saavn-dl .
docker run -p 8080:80 saavn-dl
```

The app will be available at `http://localhost:8080`.

The image uses a multi-stage build (Node 20 Bookworm → Bookworm-slim) with pre-compiled native modules for better-sqlite3. It sets the COOP/COEP headers required by ffmpeg.wasm and creates a `/data` directory for the SQLite database.

### With Library Sync + persistent database

```bash
docker run -p 8080:80 \
  -e SAAVN_LIBRARY_PATH=/ssd \
  -e SAAVN_MUSIC_PATH=/nas \
  -e SAAVN_DB_PATH=/data/saavn-dl.db \
  -v /mnt/fast-ssd:/ssd \
  -v /mnt/nas-share:/nas \
  -v /path/to/db:/data \
  saavn-dl
```

### Running behind a VPN (Gluetun)

When self-hosted, all audio and cover art fetches are routed through `/api/proxy`. Running behind [Gluetun](https://github.com/qdm12/gluetun) means all download traffic goes through the VPN tunnel while the browser only talks to your server.

A ready-to-use `docker-compose.yml` is included in the repository with Gluetun (Surfshark/WireGuard) + saavn-dl configured with VPN routing, Library Sync, and persistent SQLite storage. See [`docker-compose.yml`](./docker-compose.yml) for the full setup.

> **Note:** Search and metadata API calls (`rtmx.vercel.app`, `sda.rhythmax.workers.dev`) are made directly by the browser — only actual media downloads are proxied through the VPN.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SAAVN_LIBRARY_PATH` | _(empty)_ | Fast SSD staging directory. Empty = Save to Library disabled. |
| `SAAVN_MUSIC_PATH` | _(empty)_ | Permanent NAS directory. Empty = Library Sync disabled. |
| `SAAVN_DB_PATH` | `./data/saavn-dl.db` | Path to SQLite database file (Docker default: `/data/saavn-dl.db`). |
| `PORT` | `80` | Server listen port. |
| `STATIC_DIR` | `./dist` | Path to built frontend assets. |

---

## Save to Library

Set `SAAVN_LIBRARY_PATH` to enable a "Save to Library" button in the album download modal. Tracks are saved as:

```
/library/<Artist>/<Album Name> (Year)/01 - Song Title - Artist.m4a
```

### Without Docker

```bash
npm run build
SAAVN_LIBRARY_PATH=/path/to/music PORT=8080 STATIC_DIR=./dist node server/index.js
```

### Development (with Vite proxy)

```bash
# Terminal 1 — API server
SAAVN_LIBRARY_PATH=/tmp/my-music PORT=3001 STATIC_DIR=./dist node server/index.js

# Terminal 2 — Vite dev server (proxies /api → port 3001)
npm run dev
```

---

## Library Sync (SSD → NAS)

When both `SAAVN_LIBRARY_PATH` and `SAAVN_MUSIC_PATH` are set, a **Library** tab appears in the footer:

- **File browser** — view staged albums/tracks, expand folders
- **Sync Now** — manually move all pending files to NAS, preserving folder structure
- **Scheduled sync** — automatic sync on a cron schedule (hourly, 6h, 12h, daily at 3 AM, or custom)
- **Retry logic** — failed moves retry up to a configurable limit; exceeded files are flagged "needs attention"
- **Sync history** — last 20 sync runs stored in SQLite

Files are **moved** (not copied) from the staging SSD to the NAS. Cross-device mounts fall back to copy + delete. Empty source directories are cleaned up after sync.

---

## Background Download Queue

Queue multiple songs and albums, then keep browsing while they download sequentially in the background.

- Click `+` next to any track's download button to queue it
- Click "Queue It" in the album download modal
- A floating indicator (top-right) shows active progress and queue count
- Full management panel: cancel, pause/resume, reorder, retry, expand for details
- Navidrome multi-artist fix applied automatically to queued albums
- All downloads route through `/api/proxy` (VPN) when self-hosted

---

## Download History

A clock icon in the footer opens the History page. All completed downloads are tracked with metadata and timestamps.

- **SQLite persistence** — stored at `SAAVN_DB_PATH` (falls back to localStorage on static deployments)
- **Per-track album data** — individual track metadata stored for album downloads
- **"Already downloaded" badges** — green checkmark on search results
- **Filter & manage** — filter by tracks/albums, remove individual entries, clear all
- **Deduplication** — re-downloading updates the timestamp instead of creating duplicates

---

## Playlist Downloads

Search for JioSaavn's curated and editorial playlists from the "Playlists" tab in search. View the full track list with audio previews and per-track metadata editing.

- Download entire playlists as individual files, ZIP, or save to library
- Each track keeps its own album/artist metadata — the playlist is just a selection mechanism
- Files land in the standard `Artist/Album (Year)/Track.m4a` structure regardless of playlist
- Queue entire playlists for background download

---

## Discover (Suggestions)

The **Discover** tab shows personalized music suggestions based on your download history:

- **Trending** — popular playlists and charts from JioSaavn's home feed
- **New Releases** — latest albums filtered by your preferred languages
- **More Like Your Last Download** — related albums from JioSaavn's recommendation engine
- **Editorial Picks** — curated playlists by JioSaavn editors

Works without any history (defaults to English trending content). As you download more, suggestions become language-aware and show related content.

---

## Download Modes

| Mode | Description |
|------|-------------|
| ⚡ Fast | Direct download without metadata embedding |
| ✨ Enhanced | Download + embed metadata via ffmpeg.wasm |
| 💿 Individual Files | Album tracks as individual M4A files |
| 📁 ZIP Archive | All album tracks bundled into a ZIP |
| 📚 Save to Library | Tracks saved to server-side directory |
| 🔄 Library Sync | Staged files moved from SSD to NAS |

---

## Navidrome Compatibility

Music servers like [Navidrome](https://www.navidrome.org/) split albums into separate entries when each track has a different Album Artist tag.

saavn-dl detects this automatically:

1. Album has tracks by different artists → prompt appears
2. Suggests the album's primary artist (or "Various Artists") as unified Album Artist
3. You can edit the value or skip
4. Applied to every track in the batch across all download modes

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Server capabilities (library, sync, history flags) |
| `GET` | `/api/proxy?url=` | Proxy external fetches through server (VPN) |
| `GET` | `/api/library/browse?path=` | List directory contents |
| `POST` | `/api/library/sync` | Trigger immediate sync |
| `GET` | `/api/library/sync/status` | Sync status + scheduler state |
| `GET` | `/api/library/sync/config` | Current sync config |
| `POST` | `/api/library/sync/config` | Update sync config |
| `POST` | `/api/library/sync/reset-retries` | Reset retry counts |
| `GET` | `/api/history` | List history entries (`?type=track\|album`) |
| `GET` | `/api/history/ids` | Downloaded IDs for badge lookups |
| `GET` | `/api/history/albums/:id/tracks` | Per-track data for an album |
| `POST` | `/api/history` | Record a download |
| `DELETE` | `/api/history` | Clear all history |
| `DELETE` | `/api/history/:id` | Remove a specific entry |

---

## Disclaimer

This project is for educational and personal use only.

All music content, trademarks, and album art belong to their respective owners. This project does not host, store, or distribute copyrighted media. Users are responsible for complying with their local copyright laws.

---

## License

[Mozilla Public License 2.0 (MPL-2.0)](./LICENSE)
