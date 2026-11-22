import { Fragment, type ReactNode, useMemo, useRef } from 'react';

import { useActiveLetter } from '../../hooks/useActiveLetter.ts';
import { letterSections } from '../../library/letterSections.ts';
import { railLetters } from '../../library/railLetters.ts';
import { scrollToLetter } from '../../library/scrollToLetter.ts';
import { useLibraryStore } from '../../store/useLibraryStore.ts';
import type { LibraryItem } from '../../types.ts';
import { LetterRail } from './LetterRail.tsx';

const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** A list sorted by name, in letter sections, with an A–Z rail on the right to jump through it. */
export function LetterIndex({ items, render }: { items: LibraryItem[]; render: (items: LibraryItem[]) => ReactNode }) {
  const more = useLibraryStore((s) => s.more);
  const loadThrough = useLibraryStore((s) => s.loadThrough);
  const ref = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => letterSections(items, (i) => i.name), [items]);
  const letters = useMemo(
    () =>
      railLetters(
        sections.map((s) => s.letter),
        !more,
      ),
    [sections, more],
  );
  const active = useActiveLetter(ref, sections.map((s) => s.letter).join(''));

  const pick = async (letter: string) => {
    await loadThrough(letter);
    await nextPaint();
    scrollToLetter(ref.current, letter);
  };

  return (
    <div className="indexed" ref={ref}>
      <div className="indexed-main">
        {sections.map((s) => (
          <Fragment key={s.letter}>
            <div className="letter-head" data-letter={s.letter}>
              {s.letter}
            </div>
            {render(s.items)}
          </Fragment>
        ))}
      </div>
      <LetterRail
        letters={letters}
        active={active}
        onScrub={(l) => scrollToLetter(ref.current, l)}
        onPick={(l) => void pick(l)}
      />
    </div>
  );
}
