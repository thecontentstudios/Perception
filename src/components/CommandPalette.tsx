'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Jump anywhere: ⌘K, or Ctrl+K.
 *
 * Thirteen destinations across four groups is past the point where scanning a
 * list is faster than saying where you want to go. The nav is still the map —
 * this is the shortcut for people who already know the territory, which after
 * a week is everyone who uses this daily.
 *
 * Matching is subsequence-based, so "wwl" finds "What we learned" and "conn"
 * finds Connections. Exact prefix matches sort first, because typing "c" and
 * getting Campaigns rather than Connections is what someone expects.
 */

interface NavItem { href: string; label: string; d: string }
interface Section { label: string; items: NavItem[] }

interface Entry {
  href: string;
  label: string;
  group: string;
  /** Extra words that should match, beyond the label. */
  keywords: string;
}

/** Things people call these screens that aren't in the label. */
const ALIASES: Record<string, string> = {
  '/': 'dashboard today priorities overview',
  '/campaigns': 'projects promotions',
  '/calendar': 'schedule month week planner',
  '/post': 'publish now compose quick',
  '/create': 'new campaign composer wizard',
  '/discover': 'website analyze suggestions ideas',
  '/inbox': 'messages comments replies dms',
  '/contacts': 'people customers audience list',
  '/media': 'photos videos assets library uploads',
  '/analytics': 'results reports leads revenue numbers',
  '/learned': 'insights what works patterns',
  '/hud': 'advertising channels landscape where to advertise',
  '/connections': 'accounts integrations oauth social login',
  '/settings': 'preferences team roles account',
};

/**
 * Subsequence match with a score. Returns null when the query's letters do not
 * appear in order.
 *
 * Scoring rewards, in order: an exact prefix on the label, a word-start match,
 * then contiguity. Without that last one "cs" would rank a scattered match in
 * a long keyword string above "Campaigns".
 */
function score(query: string, entry: Entry): number | null {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const label = entry.label.toLowerCase();
  const haystack = `${label} ${entry.keywords}`;

  if (label.startsWith(q)) return 1000 - label.length;
  if (label.split(/\s+/).some((w) => w.startsWith(q))) return 800 - label.length;

  let i = 0;
  let points = 0;
  let lastHit = -2;
  for (let c = 0; c < haystack.length && i < q.length; c++) {
    if (haystack[c] === q[i]) {
      points += c === lastHit + 1 ? 5 : 1;
      if (c === 0 || haystack[c - 1] === ' ') points += 3;
      lastHit = c;
      i++;
    }
  }
  return i === q.length ? points : null;
}

export function CommandPalette({ sections }: { sections: Section[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = useMemo<Entry[]>(
    () =>
      sections.flatMap((s) =>
        s.items.map((i) => ({
          href: i.href,
          label: i.label,
          group: s.label,
          keywords: ALIASES[i.href] ?? '',
        }))
      ),
    [sections]
  );

  const results = useMemo(() => {
    if (!query.trim()) return entries;
    return entries
      .map((e) => ({ e, s: score(query, e) }))
      .filter((r): r is { e: Entry; s: number } => r.s !== null)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.e);
  }, [query, entries]);

  useEffect(() => setCursor(0), [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );

  // ⌘K / Ctrl+K to open, Escape to close. Registered on the window so it works
  // wherever focus is — except inside a text field, where ⌘K might mean
  // something to the field and Escape certainly does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // A bare "/" is the other convention people reach for, but only when
      // they are not already typing into something.
      if (e.key === '/' && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) {
    return (
      <button
        type="button"
        className="palette-hint"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Meta+K Control+K"
        title="Jump to any screen (⌘K)"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
        </svg>
        <span>Jump to…</span>
        <kbd>⌘K</kbd>
      </button>
    );
  }

  return (
    <div className="palette-backdrop" onMouseDown={close} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a screen"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Where do you want to go?"
          value={query}
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={results[cursor] ? `palette-${cursor}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            if (e.key === 'Enter' && results[cursor]) { e.preventDefault(); go(results[cursor].href); }
          }}
        />

        <div className="palette-results" id="palette-results" role="listbox" ref={listRef}>
          {results.length === 0 && (
            <div className="palette-empty">Nothing matches “{query}”.</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.href}
              id={`palette-${i}`}
              role="option"
              aria-selected={i === cursor}
              data-cursor={i === cursor}
              className={`palette-row ${i === cursor ? 'on' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => go(r.href)}
            >
              <span className="palette-label">{r.label}</span>
              <span className="palette-group">{r.group}</span>
            </button>
          ))}
        </div>

        <div className="palette-foot">
          <kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>↵</kbd> to open · <kbd>esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
