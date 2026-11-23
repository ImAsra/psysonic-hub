import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { useState } from 'react';

import { dropTarget } from '../utils/queueMove.ts';

/** A drag in progress: the track's position and the gap it would drop into. */
export interface QueueDrag {
  from: number;
  gap: number;
}

/** How close to the list's top or bottom edge a drag scrolls it, and by how much per move. */
const EDGE_PX = 36;
const SCROLL_STEP = 10;

/**
 * Drag to reorder by a row's grip, with mouse or finger (pointer events, so touch works too).
 * Rows carry their absolute queue position in `data-qi`. Arrow keys on a grip move by one.
 */
export function useQueueDrag(
  listRef: RefObject<HTMLDivElement | null>,
  move: (from: number, to: number) => void,
  last: number,
) {
  const [drag, setDrag] = useState<QueueDrag | null>(null);

  const gapAt = (y: number): number | null => {
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-qi]');
    if (!rows?.length) return null;

    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (y < r.top + r.height / 2) return Number(row.dataset.qi);
    }

    return Number(rows[rows.length - 1].dataset.qi) + 1;
  };

  const grip = (index: number) => ({
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ from: index, gap: index });
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (!drag) return;
      const list = listRef.current;

      if (list) {
        const r = list.getBoundingClientRect();
        if (e.clientY < r.top + EDGE_PX) list.scrollTop -= SCROLL_STEP;
        else if (e.clientY > r.bottom - EDGE_PX) list.scrollTop += SCROLL_STEP;
      }

      const gap = gapAt(e.clientY);
      if (gap !== null && gap !== drag.gap) setDrag({ ...drag, gap });
    },
    onPointerUp() {
      if (!drag) return;
      const to = dropTarget(drag.from, drag.gap);
      setDrag(null);
      if (to !== drag.from) move(drag.from, to);
    },
    onPointerCancel() {
      setDrag(null);
    },
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      if (e.key === 'ArrowUp' && index > 0) move(index, index - 1);
      else if (e.key === 'ArrowDown' && index < last) move(index, index + 1);
      else return;
      e.preventDefault();
    },
  });

  /** The drop line goes above the row at the gap; no line where the track would stay put. */
  const lineBefore = (index: number) => !!drag && drag.gap === index && dropTarget(drag.from, index) !== drag.from;
  const lineAfterLast = (index: number) =>
    !!drag && index === last && drag.gap === last + 1 && dropTarget(drag.from, last + 1) !== drag.from;

  return { drag, grip, lineBefore, lineAfterLast };
}
