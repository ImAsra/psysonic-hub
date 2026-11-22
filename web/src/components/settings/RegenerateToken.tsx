import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Regenerate, after a confirmation that says what it breaks. */
export function RegenerateToken({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    await onConfirm();
    setBusy(false);
    setAsking(false);
  };

  if (!asking) {
    return (
      <button type="button" className="btn ghost gap-top" onClick={() => setAsking(true)}>
        {t('connect.regenerate')}
      </button>
    );
  }

  return (
    <div className="confirm gap-top" role="alertdialog" aria-labelledby="regen-text">
      <p id="regen-text">{t('connect.regenerateConfirm')}</p>
      <div className="confirm-actions">
        <button type="button" className="btn danger" disabled={busy} onClick={() => void confirm()}>
          {t('connect.regenerateYes')}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setAsking(false)}>
          {t('connect.cancel')}
        </button>
      </div>
    </div>
  );
}
