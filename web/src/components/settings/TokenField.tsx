import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CopyField } from '../common/CopyField.tsx';

/** The device token with Copy and a show/hide button (hidden as dots until shown). */
export function TokenField({ token, shown, onToggle }: { token: string; shown: boolean; onToggle: () => void }) {
  const { t } = useTranslation();

  return (
    <CopyField id="hubToken" label={t('connect.token')} value={token} secret={!shown}>
      <button
        type="button"
        className="icon-btn small"
        aria-label={shown ? t('connect.hide') : t('connect.show')}
        onClick={onToggle}
      >
        {shown ? <EyeOff /> : <Eye />}
      </button>
    </CopyField>
  );
}
