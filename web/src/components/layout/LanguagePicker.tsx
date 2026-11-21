import { useTranslation } from 'react-i18next';

import { LANGUAGES } from '../../constants.ts';
import { setLanguage } from '../../i18n.ts';

export function LanguagePicker() {
  const { t, i18n } = useTranslation();

  return (
    <label className="language-picker">
      <span className="sr-only">{t('language.label')}</span>
      <select value={i18n.language} onChange={(e) => void setLanguage(e.target.value)}>
        {LANGUAGES.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
