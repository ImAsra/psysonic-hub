import { QrCode as QrIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { connectLink } from '../../utils/connectLink.ts';
import { QrCode } from '../common/QrCode.tsx';

/** The hub address and device token as a QR code; it holds the token, so it waits behind a button until shown. */
export function ConnectQr({ token, shown, onShow }: { token: string; shown: boolean; onShow: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="connect-qr">
      {shown ? (
        <QrCode className="qr" value={connectLink(location.origin, token)} label={t('connect.qrLabel')} />
      ) : (
        <button type="button" className="qr qr-hidden" onClick={onShow}>
          <QrIcon aria-hidden="true" />
          {t('connect.qrShow')}
        </button>
      )}
      <span className="sub">{t('connect.qrValid')}</span>
    </div>
  );
}
