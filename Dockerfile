FROM node:25-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
# Shared settings survive restarts when /data is a volume (see compose.yaml)
RUN mkdir -p /data && chown node:node /data
ENV HUB_DATA_DIR=/data
USER node
EXPOSE 5533
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-5533}/health" || exit 1
CMD ["node", "server.js"]
