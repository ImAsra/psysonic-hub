import { useState } from 'react';

import { storage } from '../utils/storage.ts';

/** An open/closed flag remembered per browser ('1' / '0'); `fallback` until it was changed. */
export function useStoredToggle(key: string, fallback: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    const saved = storage.get(key);
    return saved === '1' ? true : saved === '0' ? false : fallback;
  });

  const update = (value: boolean) => {
    setOpen(value);
    storage.set(key, value ? '1' : '0');
  };

  return [open, update];
}
