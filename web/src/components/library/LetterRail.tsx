import { type PointerEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { RailLetter } from '../../library/railLetters.ts';

interface Props {
  letters: RailLetter[];
  active: string;
  /** While a finger or the mouse drags along the rail: go to a letter that is loaded. */
  onScrub: (letter: string) => void;
  /** A letter picked (tapped, or where a drag ended): go there, loading it if needed. */
  onPick: (letter: string) => void;
}

const letterAt = (e: PointerEvent) =>
  document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-letter]')?.dataset.letter;

/** The A–Z strip beside an indexed list: tap a letter, or drag along it. */
export function LetterRail({ letters, active, onScrub, onPick }: Props) {
  const { t } = useTranslation();
  const dragging = useRef(false);
  const last = useRef('');

  return (
    <nav
      className="letter-rail"
      aria-label={t('library.index')}
      onPointerDown={(e) => {
        dragging.current = true;
        last.current = '';
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const letter = dragging.current ? letterAt(e) : undefined;
        if (!letter || letter === last.current) return;
        last.current = letter;
        onScrub(letter);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        const letter = letterAt(e) ?? last.current;
        if (letter) onPick(letter);
      }}
      onPointerCancel={() => (dragging.current = false)}
    >
      {letters.map(({ letter, state }) => (
        <button
          key={letter}
          type="button"
          data-letter={letter}
          className={[state, letter === active ? 'on' : ''].join(' ').trim()}
          // Pointers pick on release (above); this is for the keyboard.
          onClick={(e) => e.detail === 0 && onPick(letter)}
        >
          {letter}
        </button>
      ))}
    </nav>
  );
}
