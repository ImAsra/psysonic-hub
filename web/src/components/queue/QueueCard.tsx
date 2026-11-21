import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { hub } from '../../hub/HubConnection.ts';
import { selectActiveDevice, useHubStore } from '../../store/useHubStore.ts';
import { joinMeta } from '../../utils/joinMeta.ts';
import { queueRemainder, queueRows } from '../../utils/queueRows.ts';
import { Row } from '../common/Row.tsx';

/** The playing device's queue; tapping a track plays that position. */
export function QueueCard() {
  const { t } = useTranslation();
  const active = useHubStore(selectActiveDevice);
  const queue = useHubStore((s) => (active ? s.queues[active.id] : undefined));
  const listRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);

  // Keep the current track near the top of the list.
  useLayoutEffect(() => {
    const list = listRef.current;
    const current = currentRef.current;
    if (list && current) list.scrollTop = Math.max(0, current.offsetTop - list.offsetTop - 8);
  }, [queue]);

  if (!queue?.tracks.length) return null;
  const rest = queueRemainder(queue);
  return (
    <section id="queueCard" className="card">
      <h2>{t('queue.title')}</h2>
      <div className="rows" ref={listRef}>
        {queueRows(queue).map(({ track, index, place }) => (
          <Row
            key={`${index}:${track.id}`}
            ref={place === 'current' ? currentRef : undefined}
            num={index + 1}
            l1={track.title}
            l2={joinMeta(track.artist, track.album)}
            durationSec={track.durationSec}
            className={place === 'upcoming' ? undefined : place}
            onClick={() => hub.command('playIndex', { index, trackId: track.id })}
          />
        ))}
      </div>
      <div className="sub gap-top-sm">{rest > 0 ? t('queue.more', { count: rest }) : ''}</div>
    </section>
  );
}
