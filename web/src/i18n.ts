import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { LANGUAGES, STORAGE } from './constants.ts';
import en from './locales/en.json';
import { storage } from './utils/storage.ts';

// English is bundled; other languages load when picked. Keys are flat ("player.next"), so no key separator.
const lazyLocales = import.meta.glob<{ default: Record<string, string> }>(['./locales/*.json', '!./locales/en.json']);
const known = new Set<string>(LANGUAGES.map(([code]) => code));

/** Loads a language (falls back to English when it is unknown or cannot load) and makes it current. */
export async function setLanguage(code: string): Promise<void> {
  const lng = known.has(code) ? code : 'en';

  if (lng !== 'en' && !i18n.hasResourceBundle(lng, 'translation')) {
    try {
      const mod = await lazyLocales[`./locales/${lng}.json`]();
      i18n.addResourceBundle(lng, 'translation', mod.default);
    } catch (e) {
      console.error('Could not load locale:', lng, e);
      return setLanguage('en');
    }
  }

  await i18n.changeLanguage(lng);
  document.documentElement.lang = lng;
  storage.set(STORAGE.locale, lng);
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false }, // React escapes text
});

export default i18n;
