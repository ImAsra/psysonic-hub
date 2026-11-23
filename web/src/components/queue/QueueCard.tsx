import { GripVertical, ListMusic } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useQueueDrag } from '../../hooks/useQueueDrag.ts';
import { hub } from '../../hub/HubConnection.ts';
import { selectActiveDevice, useHubStore } from '../../store/useHubStore.ts';
import { joinMeta } from '../../utils/joinMeta.ts';
import { moveInWindow } from '../../utils/queueMove.ts';
import { queueRemainder, queueRows } from '../../utils/queueRows.ts';
import { Row } from '../common/Row.tsx';

/** The playing device's queue; tapping a track plays that position, dragging its grip moves it. */
export function QueueCard() {
  const { t } = useTranslation();
  const active = useHubStore(selectActiveDevice);
  const queue = useHubStore((s) => (active ? s.queues[active.id] : undefined));
  const listRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);
  const currentId = queue?.tracks[queue.index - queue.offset]?.id;

  // Keep the current track near the top of the list (when it changes, not after every reorder).
  useLayoutEffect(() => {
    const list = listRef.current;
    const current = currentRef.current;
    if (list && current) list.scrollTop = Math.max(0, current.offsetTop - list.offsetTop - 8);
  }, [active?.id, currentId]);

  /** Moves a track: shown at once, then corrected by the queue the player reports. */
  const move = (from: number, to: number) => {
    const q = active && useHubStore.getState().queues[active.id];
    const track = q?.tracks[from - q.offset];
    if (!q || !track) return;
    useHubStore.setState((s) => ({ queues: { ...s.queues, [active.id]: moveInWindow(q, from, to) } }));
    hub.command('moveQueue', { from, to, trackId: track.id });
  };

  const last = queue ? queue.offset + queue.tracks.length - 1 : -1;
  const { drag, grip, lineBefore, lineAfterLast } = useQueueDrag(listRef, move, last);

  if (!queue?.tracks.length) {
    return (
      <section id="queueCard" className="card">
        <h2>{t('queue.title')}</h2>
        <div className="queue-empty">
          <ListMusic aria-hidden="true" />
          <div className="empty-title small">{t('queue.empty')}</div>
          <p className="sub">{t('queue.emptyHint')}</p>
        </div>
      </section>
    );
  }

  const rest = queueRemainder(queue);
  return (
    <section id="queueCard" className="card">
      <h2>{t('queue.title')}</h2>
      <div className={drag ? 'rows dragging' : 'rows'} ref={listRef}>
        {queueRows(queue).map(({ track, index, place }) => {
          const cls = ['qrow'];
          if (drag?.from === index) cls.push('moving');
          if (lineBefore(index)) cls.push('drop-before');
          if (lineAfterLast(index)) cls.push('drop-after');
          return (
            <div key={`${index}:${track.id}`} className={cls.join(' ')} data-qi={index}>
              <button
                type="button"
                className="grip"
                aria-label={t('queue.move')}
                title={t('queue.move')}
                {...grip(index)}
              >
                <GripVertical size={16} aria-hidden="true" />
              </button>
              <Row
                ref={place === 'current' ? currentRef : undefined}
                num={index + 1}
                l1={track.title}
                l2={joinMeta(track.artist, track.album)}
                durationSec={track.durationSec}
                className={place === 'upcoming' ? undefined : place}
                onClick={() => hub.command('playIndex', { index, trackId: track.id })}
              />
            </div>
          );
        })}
      </div>
      <div className="sub gap-top-sm">{rest > 0 ? t('queue.more', { count: rest }) : ''}</div>
    </section>
  );
}
