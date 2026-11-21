import './styles/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { STORAGE } from './constants.ts';
import { setLanguage } from './i18n.ts';
import { storage } from './utils/storage.ts';

void setLanguage(storage.get(STORAGE.locale) || 'en');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Installed web app: keeps the page available while the hub is unreachable (needs https or localhost).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
