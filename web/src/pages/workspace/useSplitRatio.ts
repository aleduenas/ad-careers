import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const SPLIT_KEY = 'career-ops-ws-split';

const SPLIT_MIN = 25;

const SPLIT_MAX = 75;

function readSplit() {
  try {
    const value = Number(localStorage.getItem(SPLIT_KEY));
    if (Number.isFinite(value) && value >= SPLIT_MIN && value <= SPLIT_MAX)
      return Math.round(value);
  } catch {
    /* A remembered ratio is only a convenience. */
  }
  return 50;
}

// The share of the width the report takes. Pointer drag and the arrow keys on the separator change
// it; the value is remembered in localStorage when a change ends.
export function useSplitRatio() {
  const [ratio, setRatio] = useState(readSplit);
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const latest = useRef(ratio);
  const clamp = (value: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(value)));
  const apply = (value: number) => {
    const next = clamp(value);
    latest.current = next;
    setRatio(next);
  };
  const persist = () => {
    try {
      localStorage.setItem(SPLIT_KEY, String(latest.current));
    } catch {
      /* Cosmetic preference only. */
    }
  };
  const handlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      const box = ref.current?.getBoundingClientRect();
      if (!dragging.current || !box || box.width === 0) return;
      apply(((event.clientX - box.left) / box.width) * 100);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
      persist();
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 10 : 2;
      if (event.key === 'ArrowLeft') apply(latest.current - step);
      else if (event.key === 'ArrowRight') apply(latest.current + step);
      else if (event.key === 'Home') apply(SPLIT_MIN);
      else if (event.key === 'End') apply(SPLIT_MAX);
      else return;
      event.preventDefault();
      persist();
    },
  };
  return { ratio, ref, handlers, min: SPLIT_MIN, max: SPLIT_MAX };
}
