# ── Build stage ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Production stage ───────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy the built frontend and the server modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/sync-manager.js ./sync-manager.js
COPY --from=build /app/sync-scheduler.js ./sync-scheduler.js
COPY --from=build /app/api-library.js ./api-library.js
COPY --from=build /app/api-proxy.js ./api-proxy.js
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json

# Install production dependencies (node-cron)
RUN npm ci --omit=dev

# Environment variables (optional, set at runtime)
# docker run -e SAAVN_LIBRARY_PATH=/ssd -e SAAVN_MUSIC_PATH=/nas -v /mnt/ssd:/ssd -v /mnt/nas:/nas ...
ENV SAAVN_LIBRARY_PATH=""
ENV SAAVN_MUSIC_PATH=""
ENV STATIC_DIR="./dist"
ENV PORT=80

EXPOSE 80

CMD ["node", "server.js"]
