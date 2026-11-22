import { Speaker } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useHubStore } from '../../store/useHubStore.ts';

/** Shown instead of the player while no player is connected: says so and leads to connecting one. */
export function NoPlayersCard() {
  const { t } = useTranslation();

  return (
    <section id="emptyCard" className="card empty-state">
      <div className="empty-icon">
        <Speaker aria-hidden="true" />
      </div>
      <h1 className="empty-title">{t('empty.title')}</h1>
      <p className="sub">{t('empty.text')}</p>
      <button type="button" className="btn" onClick={() => useHubStore.setState({ page: 'settings' })}>
        {t('empty.connect')}
      </button>
    </section>
  );
}
