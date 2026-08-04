'use client';

import { useEffect, useId, type ReactNode } from 'react';
import { usePersisted } from '@/lib/use-ui';

/**
 * A collapsible section.
 *
 * The rule that makes collapsing useful rather than annoying: **a collapsed
 * section must still answer the question its contents answer.** So every
 * collapsible takes a `summary` — "6 connected · 2 need attention" — which is
 * shown when closed. Collapsing then *summarizes* rather than hides, and
 * nobody has to expand three sections to find out where the problem is.
 *
 * Open state persists per `id`, because a layout the user arranged should
 * survive a reload.
 *
 * The animation uses the `grid-template-rows: 0fr → 1fr` technique so height
 * animates without JavaScript measurement, which keeps it correct when the
 * content reflows (a filter changes the row count mid-transition).
 */
export function Collapsible({
  id,
  title,
  summary,
  badge,
  defaultOpen = true,
  actions,
  className = '',
  children,
}: {
  /** Storage key suffix; must be stable across renders. */
  id: string;
  title: ReactNode;
  /** Shown when collapsed. Keep it factual — counts and states, not prose. */
  summary?: ReactNode;
  /** Always visible, open or closed — use for counts and warning pills. */
  badge?: ReactNode;
  defaultOpen?: boolean;
  /** Controls that belong to the section, not the toggle. */
  actions?: ReactNode;
  /** 'plain' sheds the card chrome for nesting inside an existing card. */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = usePersisted(`perception.collapse.${id}`, defaultOpen);
  const regionId = useId();

  // Bulk collapse/expand is delivered as an event carrying the target prefix,
  // not by rewriting localStorage keys. A section the user has never toggled
  // has no key yet, so a key-rewriting approach silently skips exactly the
  // sections that are still at their default — which is most of them.
  useEffect(() => {
    const onBulk = (e: Event) => {
      const { prefix, open: next } = (e as CustomEvent<{ prefix: string; open: boolean }>).detail;
      if (id.startsWith(prefix)) setOpen(next);
    };
    window.addEventListener('perception:collapse-set', onBulk);
    return () => window.removeEventListener('perception:collapse-set', onBulk);
  }, [id, setOpen]);

  return (
    <section className={`collapsible ${className} ${open ? 'open' : 'closed'}`}>
      <div className="collapsible-head">
        <button
          type="button"
          className="collapsible-toggle"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen(!open)}
        >
          <svg
            className="collapsible-caret"
            width="11"
            height="11"
            viewBox="0 0 12 12"
            aria-hidden
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 2l4 4-4 4" />
          </svg>
          <span className="collapsible-title">{title}</span>
          {badge}
          {!open && summary && <span className="collapsible-summary">{summary}</span>}
        </button>
        {actions && <div className="collapsible-actions">{actions}</div>}
      </div>

      {/* Closed content is hidden from AT and removed from the focus order. */}
      <div
        id={regionId}
        className="collapsible-region"
        aria-hidden={!open}
        // Without this, Tab still walks into a collapsed section and focus
        // lands on controls nobody can see.
        inert={!open}
      >
        <div className="collapsible-inner">{children}</div>
      </div>
    </section>
  );
}

/** Expand or collapse every `Collapsible` whose id starts with `prefix`. */
export function CollapseAll({ prefix, count }: { prefix: string; count: number }) {
  const setAll = (open: boolean) => {
    window.dispatchEvent(
      new CustomEvent('perception:collapse-set', { detail: { prefix, open } })
    );
  };

  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button className="btn sm" onClick={() => setAll(false)} title={`Collapse all ${count} sections`}>
        Collapse all
      </button>
      <button className="btn sm" onClick={() => setAll(true)} title={`Expand all ${count} sections`}>
        Expand all
      </button>
    </span>
  );
}
