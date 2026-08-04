'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { BRANDS, TODAY, useApp } from '@/lib/store';
import { fmtLong } from '@/lib/dates';
import { usePersisted } from '@/lib/use-ui';

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flex: 'none' }}
    >
      <path d={d} />
    </svg>
  );
}

interface NavItem {
  href: string;
  label: string;
  d: string;
}

/**
 * The eleven areas grouped by what the owner is doing, so the rail reads as
 * four short lists instead of one long one: make the work, handle the
 * replies, read the results, wire it up.
 */
const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Plan',
    items: [
      { href: '/', label: 'Home', d: 'M3 10.5L12 3l9 7.5M5.5 8.5V21h13V8.5' },
      { href: '/campaigns', label: 'Campaigns', d: 'M4 15V4l16 4-16 4m0 3v6m0-6l7 5' },
      { href: '/calendar', label: 'Calendar', d: 'M4 6h16v15H4zM4 10h16M8 3v4m8-4v4' },
      { href: '/post', label: 'Quick Post', d: 'M4 12l16-8-6 16-2.5-6.5L4 12z' },
      { href: '/create', label: 'Create', d: 'M12 5v14M5 12h14' },
      {
        href: '/discover',
        label: 'Discover',
        d: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2l-4.35-4.35M11 8v6m-3-3h6',
      },
    ],
  },
  {
    label: 'Engage',
    items: [
      { href: '/inbox', label: 'Inbox', d: 'M3 13l3-8h12l3 8v6H3zm0 0h5l1.5 2.5h5L16 13h5' },
      {
        href: '/contacts',
        label: 'Contacts',
        d: 'M16 19v-1.5a4 4 0 0 0-8 0V19m4-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7 8v-1a3.5 3.5 0 0 0-2.5-3.3M18 5.4a3 3 0 0 1 0 5.2',
      },
      { href: '/media', label: 'Media Library', d: 'M4 5h16v14H4zm3 9l3.5-4 3 3.5L16 11l4 5M8.5 9.5h.01' },
    ],
  },
  {
    label: 'Measure',
    items: [
      { href: '/analytics', label: 'Analytics', d: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
      { href: '/hud', label: 'Ad HUD', d: 'M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21M12 7.5a4.5 4.5 0 1 0 .01 0' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { href: '/connections', label: 'Connections', d: 'M9 7V3m6 4V3M7 7h10v5a5 5 0 0 1-10 0zm5 10v4' },
      {
        href: '/settings',
        label: 'Settings',
        d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8-3l1.8-1-1.5-3.5-2 .4a7 7 0 0 0-1.6-1l-.3-2H10l-.3 2a7 7 0 0 0-1.6 1l-2-.4L4.5 11l1.8 1-1.8 1 1.5 3.5 2-.4a7 7 0 0 0 1.6 1l.3 2h4.4l.3-2a7 7 0 0 0 1.6-1l2 .4 1.5-3.5z',
      },
    ],
  },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { state, dispatch } = useApp();
  const [railed, setRailed] = usePersisted('perception.nav.railed', false);

  const openInbox = state.conversations.filter((c) => c.status === 'open').length;
  const failures = state.variations.filter((v) => v.status === 'failed').length;

  const countFor = (href: string) =>
    href === '/inbox' ? openInbox : href === '/' ? failures : 0;

  return (
    <div className={`shell ${railed ? 'rail' : ''}`}>
      <nav className="nav" aria-label="Primary">
        <div className="nav-brand">
          <span className="logo" aria-hidden>
            P
          </span>
          <span>
            <span className="name">Perception</span>
            <span className="tag">Campaign operating system</span>
          </span>
        </div>

        <div className="nav-items">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="nav-section">
              <div className="nav-section-label">{section.label}</div>
              {section.items.map((item) => {
                const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                const count = countFor(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item ${active ? 'active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    title={railed ? item.label : undefined}
                  >
                    <Icon d={item.d} />
                    <span className="nav-label">{item.label}</span>
                    {count > 0 && (
                      <span className={`count ${item.href === '/' ? 'alert' : ''}`}>{count}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        <button
          className="nav-collapse"
          onClick={() => setRailed(!railed)}
          aria-expanded={!railed}
          title={railed ? 'Expand navigation' : 'Collapse navigation'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
          <span className="nav-label">Collapse</span>
        </button>

        <div className="nav-foot">
          Summit Local · Growth plan
          <br />
          Clickable prototype — data resets on reload
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <select
            className="select"
            aria-label="Business filter"
            value={state.activeBrandId}
            onChange={(e) => dispatch({ type: 'setBrand', brandId: e.target.value })}
          >
            <option value="all">All businesses</option>
            {BRANDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <span
            className="demo-clock"
            title="The prototype clock is pinned so live, scheduled, and failed items all have examples."
          >
            <span className="dot" aria-hidden />
            Demo clock · {fmtLong(TODAY)}
          </span>
          <span className="avatar" title="Dana Reyes · Owner">
            DR
          </span>
        </header>
        {children}
      </div>
    </div>
  );
}
