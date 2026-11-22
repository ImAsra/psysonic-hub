// The built web remote (web/dist), read once at startup. Only the files found there are served,
// by exact path: no filesystem path ever comes from a request.
import fs from 'node:fs';
import path from 'node:path';

export interface StaticFile {
  body: Buffer;
  type: string;
  cache: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** Every servable file of a built web app, by URL path (`/` is index.html). */
export function loadStaticFiles(dir: string): Map<string, StaticFile> {
  const files = new Map<string, StaticFile>();
  const walk = (sub: string) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = path.posix.join(sub, entry.name);
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      const type = TYPES[path.extname(entry.name)];
      if (!type || type.startsWith('image/svg')) continue; // SVGs are only served sandboxed (brand files)
      const route = rel === 'index.html' ? '/' : '/' + rel;
      // Built assets carry a content hash in their name, so they never change; the rest is checked every load.
      const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      files.set(route, { body: fs.readFileSync(path.join(dir, rel)), type, cache });
    }
  };
  walk('');
  return files;
}
