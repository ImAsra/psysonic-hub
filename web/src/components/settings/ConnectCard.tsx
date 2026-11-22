import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceToken } from '../../hooks/useDeviceToken.ts';
import { CopyField } from '../common/CopyField.tsx';
import { RegenerateToken } from './RegenerateToken.tsx';

/** What to enter in a Psysonic app to connect it: the hub's address and the device token. */
export function ConnectCard() {
  const { t } = useTranslation();
  const { info, error, regenerate } = useDeviceToken();
  const [shown, setShown] = useState(false);

  return (
    <section id="connectCard" className="card">
      <h2>{t('connect.title')}</h2>
      <p className="sub">{t('connect.intro')}</p>
      <CopyField id="hubAddress" label={t('connect.address')} value={location.origin} />
      {info && (
        <CopyField id="hubToken" label={t('connect.token')} value={info.token} secret={!shown}>
          <button
            type="button"
            className="icon-btn small"
            aria-label={shown ? t('connect.hide') : t('connect.show')}
            onClick={() => setShown(!shown)}
          >
            {shown ? <EyeOff /> : <Eye />}
          </button>
        </CopyField>
      )}
      {info?.source === 'env' && <p className="sub gap-top">{t('connect.fromEnv')}</p>}
      {info?.source === 'generated' && <RegenerateToken onConfirm={regenerate} />}
      <div className="msg" role="alert">
        {error && t('connect.failed')}
      </div>
    </section>
  );
}
