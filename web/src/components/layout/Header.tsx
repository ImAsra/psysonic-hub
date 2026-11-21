import { useTranslation } from 'react-i18next';

import { signOut } from '../../hub/signOut.ts';
import { useHubStore } from '../../store/useHubStore.ts';
import { LanguagePicker } from './LanguagePicker.tsx';
import { Logo } from './Logo.tsx';
import { StatusPill } from './StatusPill.tsx';

export function Header() {
  const { t } = useTranslation();
  const canSignOut = useHubStore((s) => s.mode === 'password' && !s.login.visible && s.status !== 'notConnected');

  return (
    <header>
      <div className="brand">
        <Logo />
        <span className="tag">{t('app.remote')}</span>
      </div>
      <LanguagePicker />
      <StatusPill />
      {canSignOut && (
        <button className="link-btn" type="button" onClick={() => void signOut()}>
          {t('login.signOut')}
        </button>
      )}
    </header>
  );
}
