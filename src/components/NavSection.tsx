'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { usePersisted } from '@/lib/use-ui';

/**
 * One collapsible group in the primary navigation.
 *
 * The rail already collapses the whole nav to icons, which is the right answer
 * when you want the screen back. It is the wrong answer when you want *most*
 * of the nav — an owner who never touches Setup still needs Plan open, and
 * icon-only mode costs them the labels for everything.
 *
 * So groups fold independently. Two rules make that safe rather than annoying:
 *
 * - **The group containing the current page never collapses.** Hiding the item
 *   you are looking at is disorienting, and re-expanding to find yourself is
 *   busywork the app can spare you.
 * - **Counts roll up.** A collapsed Engage group still shows that seven
 *   messages are waiting, so folding a group never hides a reason to open it.
 */
export function NavSection({
  label,
  containsActive,
  rolledUpCount,
  railed,
  children,
}: {
  label: string;
  /** True when the current page lives in this group. */
  containsActive: boolean;
  /** Sum of the badges inside, shown when collapsed. */
  rolledUpCount: number;
  railed: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = usePersisted(`perception.nav.section.${label}`, true);

  // A group holding the current page is always shown, whatever was stored.
  // Storage is left alone so folding it again works once you navigate away.
  const expanded = open || containsActive;

  useEffect(() => {
    const onBulk = (e: Event) => {
      const { prefix, open: next } = (e as CustomEvent<{ prefix: string; open: boolean }>).detail;
      if (`nav.section.${label}`.startsWith(prefix) || prefix === 'nav.') setOpen(next);
    };
    window.addEventListener('perception:collapse-set', onBulk);
    return () => window.removeEventListener('perception:collapse-set', onBulk);
  }, [label, setOpen]);

  // In rail mode the labels are gone, so there is no header to click and
  // nothing to fold — the icons *are* the compact form.
  if (railed) {
    return <div className="nav-section">{children}</div>;
  }

  return (
    <div className={`nav-section ${expanded ? 'open' : 'closed'}`}>
      <button
        type="button"
        className="nav-section-label"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
        // Explains why the control appears stuck rather than leaving someone
        // clicking a button that does nothing.
        title={containsActive ? `${label} holds the page you're on` : expanded ? `Hide ${label}` : `Show ${label}`}
      >
        <svg
          className="nav-caret"
          width="9" height="9" viewBox="0 0 10 10" aria-hidden
          style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
        >
          <path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{label}</span>
        {!expanded && rolledUpCount > 0 && <span className="count">{rolledUpCount}</span>}
      </button>
      <div className="nav-section-body" inert={!expanded ? true : undefined}>
        <div>{children}</div>
      </div>
    </div>
  );
}

/** Collapse or expand every navigation group at once. */
export function NavCollapseAll() {
  const [allOpen, setAllOpen] = useState(true);
  return (
    <button
      type="button"
      className="nav-foldall"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent('perception:collapse-set', { detail: { prefix: 'nav.', open: !allOpen } })
        );
        setAllOpen(!allOpen);
      }}
    >
      {allOpen ? 'Fold all groups' : 'Unfold all groups'}
    </button>
  );
}

export { Link };
