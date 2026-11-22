import type { KeyboardEvent, Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { ART_THUMB } from '../../constants.ts';
import { formatTime } from '../../utils/formatTime.ts';
import { ArtImage } from './ArtImage.tsx';

interface Props {
  l1?: string;
  l2?: string;
  num?: number;
  durationSec?: number;
  /** Shows a thumbnail (an empty one when there is no artwork). */
  thumb?: boolean;
  coverArt?: string;
  className?: string;
  onClick: () => void;
  /** Shows a "+" button (add to queue). */
  onAdd?: () => void;
  ref?: Ref<HTMLDivElement>;
}

/** A list row: optional number or thumbnail, two lines of text, duration, and an add button. */
export function Row({ l1, l2, num, durationSec, thumb, coverArt, className, onClick, onAdd, ref }: Props) {
  const { t } = useTranslation();

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return; // a key on the + button belongs to that button
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onClick();
  };

  return (
    <div
      ref={ref}
      className={className ? `row ${className}` : 'row'}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {num !== undefined && <span className="num">{num}</span>}
      {thumb && <ArtImage className="thumb" coverArt={coverArt} size={ART_THUMB} />}
      <span className="txt">
        <div className="l1">{l1 || '—'}</div>
        {l2 && <div className="l2">{l2}</div>}
      </span>
      {!!durationSec && <span className="dur">{formatTime(durationSec)}</span>}
      {onAdd && (
        <button
          type="button"
          className="add"
          aria-label={t('library.addToQueue')}
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          +
        </button>
      )}
    </div>
  );
}
