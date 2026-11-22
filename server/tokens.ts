// The device token (what Psysonic apps sign in with). Set by HUB_TOKEN, or generated on the first
// start and kept in the data dir, where it can be regenerated from the web page's Settings.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type TokenSource = 'env' | 'generated';

export interface DeviceToken {
  readonly source: TokenSource;
  /** True when this start created the token (nothing was stored yet). */
  readonly fresh: boolean;
  get(): string;
  /** A new random token, saved; the old one stops working. Not possible when HUB_TOKEN sets it. */
  regenerate(): string;
}

const TOKEN_FILE = 'hub-token';
const MIN_LENGTH = 16;
const newToken = () => crypto.randomBytes(24).toString('hex');

export function createDeviceToken({ envToken, dataDir }: { envToken: string; dataDir: string }): DeviceToken {
  if (envToken) {
    return {
      source: 'env',
      fresh: false,
      get: () => envToken,
      regenerate: () => {
        throw new Error('token_from_env');
      },
    };
  }

  const file = dataDir ? path.join(dataDir, TOKEN_FILE) : '';
  const save = (token: string) => {
    if (!file) return;
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, token + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  };

  let stored = '';
  try {
    stored = file ? fs.readFileSync(file, 'utf8').trim() : '';
  } catch {
    /* first start */
  }
  const fresh = stored.length < MIN_LENGTH;
  let token = fresh ? newToken() : stored;
  if (fresh) save(token);

  return {
    source: 'generated',
    fresh,
    get: () => token,
    regenerate() {
      token = newToken();
      save(token);
      return token;
    },
  };
}
