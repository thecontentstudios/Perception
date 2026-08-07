import type { Mutation } from './mutations';

/**
 * Client half of the write path.
 *
 * Two things matter here and neither is obvious.
 *
 * **Order.** Dragging a card twice in a second issues two writes for the same
 * row. Fired in parallel they can land in either order, and the loser wins —
 * the card snaps back to where it was two drags ago on reload. So writes go
 * through one promise chain: strictly sequential, in dispatch order.
 *
 * **Honesty.** A failed write must not be silent. The screen already shows the
 * optimistic result, so a swallowed error means the user sees their change,
 * believes it, and loses it on reload. `onError` drives a visible banner.
 */

let chain: Promise<unknown> = Promise.resolve();
let listener: ((message: string | null) => void) | null = null;
/** Writes issued but not yet acknowledged — drives the "saving" indicator. */
let pending = 0;
let pendingListener: ((n: number) => void) | null = null;

export function onSyncError(fn: (message: string | null) => void) {
  listener = fn;
}

export function onPendingChange(fn: (n: number) => void) {
  pendingListener = fn;
}

const bump = (delta: number) => {
  pending += delta;
  pendingListener?.(pending);
};

/**
 * Queue a durable change. Returns nothing on purpose — callers should not
 * await it, or the optimistic path stops being optimistic.
 */
export function persist(mutation: Mutation): void {
  bump(1);
  chain = chain
    .then(async () => {
      const res = await fetch('/api/mutate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mutation }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ reason: res.statusText }));
        throw new Error(detail.reason || `write failed (${res.status})`);
      }
      listener?.(null);
    })
    .catch((e: Error) => {
      // Report and keep going: one failed write must not wedge the queue for
      // every change after it.
      listener?.(`Could not save: ${e.message}. Reload to see what was stored.`);
    })
    .finally(() => bump(-1));
}

/** Test hook — resolves once every queued write has settled. */
export function flushWrites(): Promise<unknown> {
  return chain;
}
