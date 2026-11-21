import { Monitor, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { hub } from '../../hub/HubConnection.ts';
import type { Device } from '../../types.ts';

/** A player; tapping one that is not playing moves playback there. */
export function DeviceTile({ device }: { device: Device }) {
  const { t } = useTranslation();
  const Icon = device.kind === 'phone' ? Smartphone : Monitor;

  return (
    <button
      className={device.active ? 'dev active' : 'dev'}
      type="button"
      onClick={() => !device.active && hub.transfer(device.id)}
    >
      <Icon />
      <span className="name">{device.name}</span>
      <span className="chip">{device.active ? t('devices.playing') : ''}</span>
    </button>
  );
}
