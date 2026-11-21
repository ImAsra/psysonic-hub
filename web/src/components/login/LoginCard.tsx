import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { STORAGE } from '../../constants.ts';
import { signIn } from '../../hub/signIn.ts';
import { useHubStore } from '../../store/useHubStore.ts';
import { storage } from '../../utils/storage.ts';

export function LoginCard() {
  const { t } = useTranslation();
  const mode = useHubStore((s) => s.mode);
  const message = useHubStore((s) => s.login.message);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(() => storage.get(STORAGE.token) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const msg = await signIn(user, password, token);
    setBusy(false);
    setError(msg);
    if (!msg) setPassword('');
  };

  return (
    <section id="login" className="card">
      <form onSubmit={(e) => void submit(e)} autoComplete="on">
        {mode === 'password' && (
          <div>
            <label className="field" htmlFor="user">
              {t('login.username')}
            </label>
            <input
              id="user"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
            <label className="field gap-top" htmlFor="pass">
              {t('login.password')}
            </label>
            <input
              id="pass"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}
        {mode === 'token' && (
          <div>
            <label className="field" htmlFor="token">
              {t('login.hubToken')}
            </label>
            <input
              id="token"
              type="password"
              autoComplete="off"
              placeholder="HUB_TOKEN"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
        )}
        <div className="msg" role="alert">
          {error || message}
        </div>
        {mode && (
          <button className="btn block" type="submit" disabled={busy}>
            {t('login.signIn')}
          </button>
        )}
      </form>
    </section>
  );
}
