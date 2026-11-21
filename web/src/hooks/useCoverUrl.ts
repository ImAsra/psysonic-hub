import { useEffect, useState } from 'react';

import { fetchImage } from '../api/fetchImage.ts';
import { COVER_RETRIES, COVER_RETRY_MS } from '../constants.ts';

/**
 * The cover of the track that is playing. The player uploads it a moment after the track
 * starts, so a missing cover is asked for again a few times.
 */
export function useCoverUrl(trackId: string | undefined): string | undefined {
  // The last cover loaded, with the track it belongs to (another track's cover is never shown).
  const [loaded, setLoaded] = useState<{ trackId: string; url: string }>();

  useEffect(() => {
    if (!trackId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: string | null = null;

    const attempt = async (n: number) => {
      const url = await fetchImage('/api/cover?track=' + encodeURIComponent(trackId));

      if (cancelled) {
        if (url) URL.revokeObjectURL(url);
        return;
      }

      if (url) {
        current = url;
        setLoaded({ trackId, url });
      } else if (n < COVER_RETRIES) {
        timer = setTimeout(() => void attempt(n + 1), COVER_RETRY_MS);
      }
    };

    void attempt(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (current) URL.revokeObjectURL(current);
    };
  }, [trackId]);

  return trackId && loaded?.trackId === trackId ? loaded.url : undefined;
}
