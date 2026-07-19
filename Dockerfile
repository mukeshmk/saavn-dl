# ── Build stage (full image has python3, make, g++ for native addons) ───────────
FROM node:20-bookworm AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Prune to production deps (reuses already-compiled native modules)
RUN rm -rf node_modules && npm ci --omit=dev

# ── Production stage (slim, no build tools) ────────────────────────────────────
FROM node:20-bookworm-slim

WORKDIR /app

# Copy built frontend, server, and production node_modules (with native addon)
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Ensure default DB directory exists (in case no volume is mounted)
RUN mkdir -p /data

# Environment variables (optional, set at runtime)
# docker run -e SAAVN_LIBRARY_PATH=/ssd -e SAAVN_MUSIC_PATH=/nas -e SAAVN_DB_PATH=/data/saavn-dl.db ...
ENV SAAVN_LIBRARY_PATH=""
ENV SAAVN_MUSIC_PATH=""
ENV SAAVN_DB_PATH="/data/saavn-dl.db"
ENV STATIC_DIR="./dist"
ENV PORT=80

EXPOSE 80

CMD ["node", "server/index.js"]
