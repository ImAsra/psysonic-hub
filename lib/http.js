// Small HTTP helpers shared by the server and the API.
// No inline script or style anywhere (the page loads /app.js and /app.css), so an injected
// <script> or event handler would not run even if some text were ever rendered unescaped.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/** For files you drop into ./public (logo.svg ...): an SVG must never be able to run script. */
export const BRAND_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

let secureCheck = () => false;
/** Registers how to tell whether a request arrived over HTTPS (also behind a trusted proxy). */
export const setSecureCheck = (fn) => { secureCheck = fn; };

export const baseHeaders = (req) => ({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': CSP,
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  ...(req && secureCheck(req) ? { 'strict-transport-security': 'max-age=31536000' } : {}),
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
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(new Error('bad_json'));
      resolve(body);
    } catch { reject(new Error('bad_json')); }
  });
  req.on('error', reject);
});

export const sendJson = (res, status, body, extra = {}) => {
  res.writeHead(status, {
    ...baseHeaders(res.req), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra,
  });
  res.end(JSON.stringify(body));
};
