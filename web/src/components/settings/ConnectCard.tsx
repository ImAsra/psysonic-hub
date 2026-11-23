import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceToken } from '../../hooks/useDeviceToken.ts';
import { CopyField } from '../common/CopyField.tsx';
import { ConnectQr } from './ConnectQr.tsx';
import { RegenerateToken } from './RegenerateToken.tsx';
import { TokenField } from './TokenField.tsx';

/**
 * What to enter in a Psysonic app to connect it: the hub's address and the device token, also as a
 * QR code for phones. The code holds the token, so it stays hidden until the token is shown.
 */
export function ConnectCard() {
  const { t } = useTranslation();
  const { info, error, regenerate } = useDeviceToken();
  const [shown, setShown] = useState(false);

  return (
    <section id="connectCard" className="card">
      <h2>{t('connect.title')}</h2>
      <div className="connect-layout">
        {info && <ConnectQr token={info.token} shown={shown} onShow={() => setShown(true)} />}
        <div className="connect-fields">
          <p className="sub">{t('connect.intro')}</p>
          {info && <p className="sub">{t('connect.qrHint')}</p>}
          <CopyField id="hubAddress" label={t('connect.address')} value={location.origin} />
          {info && <TokenField token={info.token} shown={shown} onToggle={() => setShown(!shown)} />}
          {info?.source === 'env' && <p className="sub gap-top">{t('connect.fromEnv')}</p>}
          {info?.source === 'generated' && <RegenerateToken onConfirm={regenerate} />}
          <div className="msg" role="alert">
            {error && t('connect.failed')}
          </div>
        </div>
      </div>
    </section>
  );
}
