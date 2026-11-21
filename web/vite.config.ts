import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// `npm run dev:web` serves the page with hot reload and forwards everything else to a hub on :5533.
const HUB = process.env.HUB_DEV_URL || 'http://127.0.0.1:5533';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
  server: {
    proxy: {
      '/ws': { target: HUB, ws: true },
      '/api': HUB,
      '/auth': HUB,
      '/manifest.webmanifest': HUB,
      '/logo.svg': HUB,
      '/icon.png': HUB,
      '/icon-maskable.png': HUB,
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
