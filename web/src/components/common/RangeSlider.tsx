import { useLayoutEffect, useRef } from 'react';

import { sliderFill } from '../../utils/sliderFill.ts';

interface Props {
  value: number;
  min?: number;
  max: number;
  step: number;
  label: string;
  id?: string;
  onInput: (value: number) => void;
  onCommit: (value: number) => void;
}

/** A range input whose filled part follows the value (`onCommit` fires on release). */
export function RangeSlider({ value, min = 0, max, step, label, id, onInput, onCommit }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  // Set through the CSSOM: the page's CSP allows no inline style attributes.
  useLayoutEffect(() => {
    ref.current?.style.setProperty('--fill', sliderFill(value, min, max));
  }, [value, min, max]);

  return (
    <input
      ref={ref}
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onChange={(e) => onInput(Number(e.target.value))}
      onPointerUp={(e) => onCommit(Number(e.currentTarget.value))}
      onKeyUp={(e) => onCommit(Number(e.currentTarget.value))}
    />
  );
}
