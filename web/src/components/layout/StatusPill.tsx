import { useTranslation } from 'react-i18next';

import { useHubStore } from '../../store/useHubStore.ts';
import type { ConnectionStatus } from '../../types.ts';

const TONE: Partial<Record<ConnectionStatus, string>> = {
  connected: 'on',
  reconnecting: 'bad',
  lockedOut: 'bad',
  tooManyConnections: 'bad',
  signedOut: 'bad',
  wrongToken: 'bad',
};

export function StatusPill() {
  const { t } = useTranslation();
  const status = useHubStore((s) => s.status);
  const tone = TONE[status];

  return (
    <span className={tone ? `pill ${tone}` : 'pill'}>
      <span className="dot" />
      <span>{t(`status.${status}`)}</span>
    </span>
  );
}
