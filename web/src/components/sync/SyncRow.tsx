import { useTranslation } from 'react-i18next';

import { hub } from '../../hub/HubConnection.ts';

/** One settings category with its on/off switch (applies to every device). */
export function SyncRow({ id, enabled }: { id: string; enabled: boolean }) {
  const { t } = useTranslation();

  return (
    <label className="sync-row">
      <span className="t">
        <span className="n">{t(`sync.${id}.label`)}</span>
        <div className="d">{t(`sync.${id}.desc`)}</div>
      </span>
      <input type="checkbox" className="switch" checked={enabled} onChange={(e) => hub.setSync(id, e.target.checked)} />
    </label>
  );
}
