'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared UI-state hooks: layout preferences that persist across reloads, and
 * pointer-driven resizing for the stretchable panels.
 *
 * Persistence reads happen after mount rather than during render — reading
 * localStorage while rendering would desync the server and client HTML.
 */

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function write<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — preferences just don't persist */
  }
}

/** State backed by localStorage. Falls back to `initial` until hydrated. */
export function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    const sync = () => {
      const stored = read<T>(key);
      if (stored !== null) setValue(stored);
    };
    sync();
    // 'storage' only fires in *other* tabs, so a same-tab custom event is
    // needed for bulk operations (collapse all) to reach mounted components.
    window.addEventListener('perception:collapse-sync', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('perception:collapse-sync', sync);
      window.removeEventListener('storage', sync);
    };
  }, [key]);

  const set = useCallback(
    (v: T) => {
      setValue(v);
      write(key, v);
    },
    [key]
  );

  return [value, set];
}

export interface ResizeOptions {
  key: string;
  initial: number;
  min: number;
  max: number;
  /**
   * 'left' — handle sits on the panel's left edge and the panel grows leftward
   * (right-docked panels). 'right' — handle on the right edge, grows rightward.
   */
  edge: 'left' | 'right';
}

/**
 * Pointer-driven panel resizing with clamping and persistence. Pointer capture
 * keeps the drag alive when the cursor outruns the handle, and the keyboard
 * handler gives the same control without a mouse.
 */
export function useResizable({ key, initial, min, max, edge }: ResizeOptions) {
  const [size, setSize] = usePersisted<number>(key, initial);
  const [dragging, setDragging] = useState(false);
  const frame = useRef<number | null>(null);

  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, Math.round(n))), [min, max]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      setDragging(true);

      const startX = e.clientX;
      const startSize = size;

      const move = (ev: PointerEvent) => {
        const delta = edge === 'left' ? startX - ev.clientX : ev.clientX - startX;
        // Coalesce to one update per frame — resize fires far faster than paint.
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => setSize(clamp(startSize + delta)));
      };

      const up = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        setDragging(false);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    },
    [size, edge, clamp, setSize]
  );

  /** Arrow keys resize in 24px steps; Home/End jump to the clamps. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const step = e.shiftKey ? 96 : 24;
      const grow = edge === 'left' ? 'ArrowLeft' : 'ArrowRight';
      const shrink = edge === 'left' ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === grow) {
        e.preventDefault();
        setSize(clamp(size + step));
      } else if (e.key === shrink) {
        e.preventDefault();
        setSize(clamp(size - step));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setSize(min);
      } else if (e.key === 'End') {
        e.preventDefault();
        setSize(max);
      }
    },
    [size, edge, clamp, setSize, min, max]
  );

  const handleProps = {
    onPointerDown,
    onKeyDown,
    role: 'separator' as const,
    tabIndex: 0,
    'aria-orientation': 'vertical' as const,
    'aria-valuenow': size,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-label': 'Resize panel',
  };

  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  return { size, setSize: (n: number) => setSize(clamp(n)), dragging, handleProps };
}

/**
 * Polite screen-reader announcements for actions with no visible focus change
 * — dropping a card on a new day, collapsing a rail. Returns a setter and the
 * text to render inside an aria-live region.
 */
export function useAnnouncer(): [string, (msg: string) => void] {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((msg: string) => {
    setMessage(msg);
    if (timer.current) clearTimeout(timer.current);
    // Clear so an identical repeat announcement is still read out.
    timer.current = setTimeout(() => setMessage(''), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return [message, announce];
}
