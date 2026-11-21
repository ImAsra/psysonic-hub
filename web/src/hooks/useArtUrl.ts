import { type RefObject, useEffect, useState } from 'react';

import { artUrl, cachedArtUrl } from '../api/artUrl.ts';

/** Library artwork for an element, loaded once it scrolls near the screen. */
export function useArtUrl(
  ref: RefObject<Element | null>,
  coverArt: string | undefined,
  size: number,
): string | undefined {
  const key = coverArt ? `${size}:${coverArt}` : '';
  // The last artwork this element loaded, with the cover it belongs to (a stale one is not shown).
  const [loaded, setLoaded] = useState<{ key: string; url: string }>();

  useEffect(() => {
    if (!coverArt || cachedArtUrl(coverArt, size)) return;
    let cancelled = false;
    const load = () =>
      void artUrl(coverArt, size).then((url) => {
        if (!cancelled && url) setLoaded({ key: `${size}:${coverArt}`, url });
      });
    const el = ref.current;

    if (!el || !('IntersectionObserver' in window)) {
      load();
      return () => void (cancelled = true);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        load();
      },
      { rootMargin: '200px' },
    );

    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [ref, coverArt, size]);

  if (!coverArt) return undefined;
  return cachedArtUrl(coverArt, size) ?? (loaded?.key === key ? loaded.url : undefined);
}
