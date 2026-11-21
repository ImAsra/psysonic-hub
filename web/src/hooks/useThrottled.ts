import { useCallback, useEffect, useRef } from 'react';

/**
 * Calls `fn` with the latest value at most once per `ms` (the last value always goes out).
 * `flush` sends a pending value right away.
 */
export function useThrottled<T>(
  fn: (value: T) => void,
  ms: number,
): { push: (value: T) => void; flush: (value: T) => void } {
  const fnRef = useRef(fn);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentAt = useRef(0);
  const latest = useRef<T | undefined>(undefined);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const flush = useCallback((value: T) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    sentAt.current = Date.now();
    fnRef.current(value);
  }, []);

  const push = useCallback(
    (value: T) => {
      latest.current = value;
      if (timer.current) return;
      timer.current = setTimeout(() => flush(latest.current as T), Math.max(0, ms - (Date.now() - sentAt.current)));
    },
    [flush, ms],
  );

  return { push, flush };
}
