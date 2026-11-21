import { useTranslation } from 'react-i18next';

import { selectActiveDevice, useHubStore } from '../../store/useHubStore.ts';

/** Which device plays ("pick one below" when players are connected but none plays). */
export function PlayingOn() {
  const { t } = useTranslation();
  const active = useHubStore(selectActiveDevice);
  const anyPlayers = useHubStore((s) => s.devices.length > 0);

  if (active) return <div className="on-dev">{t('devices.playingOn', { name: active.name })}</div>;
  return <div className="on-dev none">{anyPlayers ? t('devices.noActive') : ''}</div>;
}
