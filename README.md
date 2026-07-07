# saavn-dl

A modern JioSaavn songs & albums downloader and with ffmpeg powered metadata embedding.

Built with React, Vite and TypeScript.  
Designed with a premium glassmorphism-inspired UI.

---
## Preview

### Home
![saavn-dl Home](./assets/home.png)
### Track

![saavn-dl Track view](./assets/track.png)

### Search
![saavn-dl Track search](./assets/search.png)

### Album search
![saavn-dl Album search](./assets/albumSearch.png)

### Album
![saavn-dl Album view](./assets/album.png)

### Download Menu
![saavn-dl Download menu](./assets/downloadMenu.png)
---

## Features

- 🔗 Paste any JioSaavn song/album URL or just search by track/album name
- 🎵 Built-in audio preview player
- 🎚️ Quality selector upto 320 kbps
- ⬇️ Download tracks & albums with embedded metadata
- ⚡ Direct download fallback if ffmpeg fails

---

## Stack

- React 18
- Vite
- TypeScript
- TailwindCSS
- Framer Motion
- CryptoJS
- ffmpeg.wasm

---

## Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

---

## Download Modes

| Mode | Description |
|------|-------------|
| ⚡ Fast | Direct download without metadata embedding |
| ✨ Enhanced | Downloads audio and embeds metadata using ffmpeg.wasm |
| 💿 Individual Files (Album) | Downloads all track as individual files |
| 📁 Zip File (Album) | Downloads all track and stores them in a zip folder |


---
## Host your own JioSaavn API

- To host your own JioSaavn API, check out https://github.com/ODSkyler/jiosaavn-api
- To host your own saavn-dl API, check out https://github.com/ODSkyler/saavn-dl-api

---

## Disclaimer

This project is intended for educational and personal use only.

All music content, trademarks, album arts and related assets belong to their respective owners.

This project:
- does not host music
- does not store copyrighted content
- does not distribute media files

Users are responsible for complying with their local copyright laws.

---

## License

This project is licensed under the Mozilla Public License 2.0 (MPL-2.0).

---

## Author

Made with ❤️ by OD Skyler