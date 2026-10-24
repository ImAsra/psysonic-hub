// Small HTTP helpers shared by the server and the API.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export const baseHeaders = () => ({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': CSP,
});

/** Read a small JSON body. Rejects with Error('too_large') or Error('bad_json'). */
export const readJson = (req, limit = 8 * 1024) => new Promise((resolve, reject) => {
  let size = 0;
  let tooLarge = false;
  const chunks = [];
  req.on('data', (c) => {
    if (tooLarge) return; // discard the rest; the reply closes the connection
    size += c.length;
    if (size > limit) { tooLarge = true; chunks.length = 0; reject(new Error('too_large')); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (tooLarge) return;
    if (!chunks.length) return resolve({});
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('bad_json')); }
  });
  req.on('error', reject);
});

export const sendJson = (res, status, body, extra = {}) => {
  res.writeHead(status, {
    ...baseHeaders(), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra,
  });
  res.end(JSON.stringify(body));
};
