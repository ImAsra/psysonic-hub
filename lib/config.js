// Environment configuration. Everything is optional except HUB_TOKEN.
export function loadConfig(env = process.env) {
  const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const cfg = {
    port: Number(env.PORT || 5533),
    token: env.HUB_TOKEN || '', // used by the Psysonic apps
    maxDevices: Number(env.MAX_DEVICES || 16),
    dataDir: env.HUB_DATA_DIR || '',
    user: env.HUB_USER || '', // web UI login (optional; without it the page asks for HUB_TOKEN)
    password: env.HUB_PASSWORD || '',
    apiToken: env.API_TOKEN || '', // full control over /api
    apiTokenReadonly: env.API_TOKEN_READONLY || '', // read-only /api (state, devices, cover, events)
    trustProxy: env.HUB_TRUST_PROXY === '1', // behind a reverse proxy: trust X-Forwarded-* headers
    allowedOrigins: list(env.HUB_ALLOWED_ORIGINS), // extra browser origins allowed to open the WebSocket
    corsOrigins: list(env.HUB_CORS_ORIGINS), // browser origins allowed to call /api cross-origin
    serverCheck: env.HUB_SERVER_CHECK !== 'off', // refuse handoffs between different music servers/accounts
    yieldTimeoutMs: Number(env.HUB_YIELD_TIMEOUT_MS || 10000), // how long a playing device may take to save its queue
    publicUrl: (env.HUB_PUBLIC_URL || '').replace(/\/+$/, ''), // makes cover_url absolute in /api/state
  };
  const errors = [];
  if (cfg.token.length < 16) errors.push('HUB_TOKEN must be set and at least 16 characters.');
  if (cfg.password || cfg.user) {
    if (!cfg.user) errors.push('HUB_USER is required when HUB_PASSWORD is set.');
    if (cfg.password.length < 10) errors.push('HUB_PASSWORD must be at least 10 characters.');
  }
  if (cfg.apiToken && cfg.apiToken.length < 24) errors.push('API_TOKEN must be at least 24 characters.');
  if (cfg.apiTokenReadonly && cfg.apiTokenReadonly.length < 24) errors.push('API_TOKEN_READONLY must be at least 24 characters.');
  if (cfg.apiToken && cfg.apiToken === cfg.apiTokenReadonly) errors.push('API_TOKEN and API_TOKEN_READONLY must differ.');
  return { cfg, errors };
}
