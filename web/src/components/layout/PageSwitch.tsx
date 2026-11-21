import { ArrowLeft, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useHubStore } from '../../store/useHubStore.ts';

/** Switches between the remote and its Settings. */
export function PageSwitch() {
  const { t } = useTranslation();
  const page = useHubStore((s) => s.page);
  const toSettings = page === 'remote';

  return (
    <button
      type="button"
      className="link-btn icon-label"
      onClick={() => useHubStore.setState({ page: toSettings ? 'settings' : 'remote' })}
    >
      {toSettings ? <Settings aria-hidden="true" /> : <ArrowLeft aria-hidden="true" />}
      {toSettings ? t('settings.title') : t('nav.remote')}
    </button>
  );
}
