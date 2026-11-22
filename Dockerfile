# Build the web remote.
FROM node:26-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY shared ./shared
COPY web ./web
RUN npm run build

# Run the hub: TypeScript run directly by Node, plus the built page.
FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY --from=web /app/web/dist ./web/dist
# Shared settings survive restarts when /data is a volume (see compose.yaml)
RUN mkdir -p /data && chown node:node /data
ENV HUB_DATA_DIR=/data
USER node
EXPOSE 5533
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-5533}/health" || exit 1
CMD ["node", "server/index.ts"]
