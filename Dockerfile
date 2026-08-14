# ── Build stage (full image has python3, make, g++ for native addons) ───────────
FROM node:20-bookworm AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Prune to production deps (reuses already-compiled native modules)
RUN rm -rf node_modules && npm ci --omit=dev

# Fetch the standalone yt-dlp Linux binary (PyInstaller build — bundles its own
# Python, so it runs on bookworm-slim with no extra packages). Used by the
# self-hosted YouTube-import feature; carried into the prod stage below.
# TARGETARCH is provided automatically by buildx so the right arch binary is
# fetched (x86_64 on amd64, aarch64 on arm64 / Apple Silicon).
ARG TARGETARCH
RUN case "${TARGETARCH}" in \
      arm64) YTDLP_ASSET=yt-dlp_linux_aarch64 ;; \
      *)     YTDLP_ASSET=yt-dlp_linux ;; \
    esac \
    && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}" \
      -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

# ── Production stage (slim, no build tools) ────────────────────────────────────
FROM node:20-bookworm-slim

WORKDIR /app

# Copy built frontend, server, and production node_modules (with native addon)
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# yt-dlp standalone binary for the YouTube-import feature (statically bundled;
# verified to run on bookworm-slim with no apt packages). If a future build's
# probe/extraction fails on TLS, add: RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates
COPY --from=build /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp

# Ensure default DB directory exists (in case no volume is mounted)
RUN mkdir -p /data

# Environment variables (optional, set at runtime)
# docker run -e SAAVN_LIBRARY_PATH=/ssd -e SAAVN_MUSIC_PATH=/nas -e SAAVN_DB_PATH=/data/saavn-dl.db ...
ENV SAAVN_LIBRARY_PATH=""
ENV SAAVN_MUSIC_PATH=""
ENV SAAVN_DB_PATH="/data/saavn-dl.db"
ENV SAAVN_YTDLP_PATH="/usr/local/bin/yt-dlp"
ENV STATIC_DIR="./dist"
ENV PORT=80

EXPOSE 80

CMD ["node", "server/index.js"]
