import { useTranslation } from 'react-i18next';

import { useHubStore } from '../../store/useHubStore.ts';
import { DeviceTile } from './DeviceTile.tsx';

export function DevicesCard() {
  const { t } = useTranslation();
  const devices = useHubStore((s) => s.devices);

  return (
    <section id="devicesCard" className="card">
      <h2>{t('devices.playOn')}</h2>
      <div id="devices">
        {devices.map((d) => (
          <DeviceTile key={d.id} device={d} />
        ))}
      </div>
      <div className="sub gap-top-sm">{devices.length ? '' : t('devices.none')}</div>
    </section>
  );
}
