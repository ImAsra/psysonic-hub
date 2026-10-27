// Environment configuration. Everything is optional except HUB_TOKEN.
import fs from 'node:fs';

/** A secret from NAME, or from the file named by NAME_FILE (Docker/Kubernetes secrets). */
function secret(env, name, errors) {
  const file = env[`${name}_FILE`];
  if (!file) return env[name] || '';
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (e) {
    errors.push(`${name}_FILE could not be read: ${e.code || e.message}`);
    return '';
  }
}

/** Rough guess whether a secret was typed by a human instead of generated. */
export function looksWeak(value) {
  if (!value) return false;
  const distinct = new Set(value).size;
  const bits = value.length * Math.log2(Math.max(2, distinct)); // an upper bound on the entropy
  const guessable = /(password|passwd|token|secret|admin|changeme|test|1234|qwerty|letmein|psysonic|hub)/i.test(value);
  return bits < 100 || guessable;
}

export function loadConfig(env = process.env) {
  const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const errors = [];
  const cfg = {
    port: Number(env.PORT || 5533),
    bind: env.HUB_BIND || '0.0.0.0', // use 127.0.0.1 when only a local reverse proxy should reach the hub
    token: secret(env, 'HUB_TOKEN', errors), // used by the Psysonic apps
    maxDevices: Number(env.MAX_DEVICES || 16),
    dataDir: env.HUB_DATA_DIR || '',
    user: env.HUB_USER || '', // web UI login (optional; without it the page asks for HUB_TOKEN)
    password: secret(env, 'HUB_PASSWORD', errors),
    apiToken: secret(env, 'API_TOKEN', errors), // full control over /api
    apiTokenReadonly: secret(env, 'API_TOKEN_READONLY', errors), // read-only /api (state, devices, cover, events)
    trustProxy: env.HUB_TRUST_PROXY === '1', // behind a reverse proxy: trust X-Forwarded-* headers
    allowedOrigins: list(env.HUB_ALLOWED_ORIGINS), // extra browser origins allowed to open the WebSocket
    corsOrigins: list(env.HUB_CORS_ORIGINS), // browser origins allowed to call /api cross-origin
    serverCheck: env.HUB_SERVER_CHECK !== 'off', // refuse handoffs between different music servers/accounts
    yieldTimeoutMs: Number(env.HUB_YIELD_TIMEOUT_MS || 10000), // how long a playing device may take to save its queue
    maxConnections: Number(env.HUB_MAX_CONNECTIONS || 64),
    maxConnectionsPerIp: Number(env.HUB_MAX_CONNECTIONS_PER_IP || 16),
    publicUrl: (env.HUB_PUBLIC_URL || '').replace(/\/+$/, ''), // makes cover_url absolute in /api/state
  };
  if (cfg.token.length < 16) errors.push('HUB_TOKEN must be set and at least 16 characters.');
  if (cfg.password || cfg.user) {
    if (!cfg.user) errors.push('HUB_USER is required when HUB_PASSWORD is set.');
    if (cfg.password.length < 10) errors.push('HUB_PASSWORD must be at least 10 characters.');
  }
  if (cfg.apiToken && cfg.apiToken.length < 24) errors.push('API_TOKEN must be at least 24 characters.');
  if (cfg.apiTokenReadonly && cfg.apiTokenReadonly.length < 24) errors.push('API_TOKEN_READONLY must be at least 24 characters.');
  if (cfg.apiToken && cfg.apiToken === cfg.apiTokenReadonly) errors.push('API_TOKEN and API_TOKEN_READONLY must differ.');
  if (cfg.token && [cfg.apiToken, cfg.apiTokenReadonly, cfg.password].includes(cfg.token)) {
    errors.push('HUB_TOKEN, the API tokens and HUB_PASSWORD must all be different from each other.');
  }

  // Not fatal, but worth saying out loud: guessable secrets are the most likely way in.
  const warnings = [];
  for (const [name, value] of [['HUB_TOKEN', cfg.token], ['HUB_PASSWORD', cfg.password], ['API_TOKEN', cfg.apiToken], ['API_TOKEN_READONLY', cfg.apiTokenReadonly]]) {
    if (looksWeak(value)) warnings.push(`${name} looks guessable. Generate one with: openssl rand -hex 24`);
  }
  if (cfg.trustProxy) {
    warnings.push(`HUB_TRUST_PROXY=1: make sure only your reverse proxy can reach port ${cfg.port} (publish it as 127.0.0.1:${cfg.port}:${cfg.port} or on an internal Docker network), otherwise clients can fake their address and dodge the login lockout.`);
  }
  return { cfg, errors, warnings };
}
