import { type RefObject, useEffect, useState } from 'react';

import { ACTIVE_LETTER_LINE } from '../constants.ts';

/** The letter of the section scrolled to in a letter index (its last head above the line). */
export function useActiveLetter(ref: RefObject<HTMLElement | null>, sectionsKey: string): string {
  const [active, setActive] = useState('');

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const heads = [...(ref.current?.querySelectorAll<HTMLElement>('.letter-head') ?? [])];
      const passed = heads.filter((h) => h.getBoundingClientRect().top <= ACTIVE_LETTER_LINE);
      setActive((passed.at(-1) ?? heads[0])?.dataset.letter ?? '');
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [ref, sectionsKey]);

  return active;
}
