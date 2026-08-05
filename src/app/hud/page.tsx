'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { fmtMoney, fmtNum } from '@/components/ui';
import { CHANNEL_META, ChannelIcon } from '@/lib/channels';
import { PERFORMANCE } from '@/lib/demo-data';
import {
  coverageFor,
  FIT_LABEL,
  fitFor,
  KIND_LABEL,
  SURFACES,
  surfaceStatus,
  type AdSurface,
  type Industry,
  type SurfaceKind,
  type SurfaceStatus,
} from '@/lib/surfaces';
import { BRANDS, useApp } from '@/lib/store';
import { GOAL_LABELS, type ChannelMetrics } from '@/lib/types';

/**
 * The Advertising & Social Understanding HUD.
 *
 * One view of the whole landscape: every surface a small business can show up
 * on — organic and paid — with per-industry fit, honest cost and API notes,
 * live connection status, and what the money and posts already out there are
 * producing. The matrix is the map; coverage and gaps are the compass.
 */

const STATUS_UI: Record<SurfaceStatus, { label: string; cls: string }> = {
  connected: { label: 'Live', cls: 'published' },
  needs_reconnect: { label: 'Reconnect', cls: 'failed' },
  available: { label: 'Available', cls: 'draft' },
  ads_only: { label: 'Ads only', cls: 'neutral' },
};

function FitDots({ fit }: { fit: 0 | 1 | 2 | 3 }) {
  return (
    <span className="fit-dots" aria-label={`Fit: ${FIT_LABEL[fit]}`}>
      <span className="dots" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={`dot ${i <= fit ? '' : 'off'}`} />
        ))}
      </span>
      <span className="fit-label">{FIT_LABEL[fit]}</span>
    </span>
  );
}

function SurfaceIcon({ surface, size = 18 }: { surface: AdSurface; size?: number }) {
  if (surface.channel) return <ChannelIcon channel={surface.channel} size={size} />;
  return (
    <span
      className="surface-badge"
      style={{ background: surface.badge!.color, width: size, height: size }}
      title={surface.name}
      aria-label={surface.name}
      role="img"
    >
      {surface.badge!.short}
    </span>
  );
}

const KIND_FILTERS: (SurfaceKind | 'all')[] = ['all', 'social', 'video', 'local', 'search', 'messaging', 'owned'];

type SortKey = 'name' | 'organic' | 'paid' | 'status' | 'fit';

/** Status sort order, most actionable first: fix it, then use it, then add it. */
const STATUS_ORDER: SurfaceStatus[] = ['needs_reconnect', 'connected', 'available', 'ads_only'];

export default function HudPage() {
  const { state, visibleCampaigns, brandById } = useApp();
  const [kind, setKind] = useState<SurfaceKind | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('fit');
  const [desc, setDesc] = useState(true);

  const activeBrand = state.activeBrandId === 'all' ? null : BRANDS.find((b) => b.id === state.activeBrandId);
  const industry: Industry | 'all' = activeBrand?.industry ?? 'all';

  const rows = useMemo(() => {
    const dir = desc ? -1 : 1;
    const value = (s: (typeof SURFACES)[number]) => {
      switch (sort) {
        case 'name':
          return s.name.toLowerCase();
        case 'organic':
          return s.organic ? 1 : 0;
        case 'paid':
          return s.paid ? 1 : 0;
        case 'status':
          return STATUS_ORDER.indexOf(surfaceStatus(s, state.accounts));
        case 'fit':
        default:
          return fitFor(s, industry);
      }
    };
    return SURFACES.filter((s) => kind === 'all' || s.kind === kind)
      .slice()
      .sort((a, b) => {
        const av = value(a);
        const bv = value(b);
        if (av < bv) return dir;
        if (av > bv) return -dir;
        return a.name.localeCompare(b.name); // stable tiebreak
      });
  }, [kind, industry, sort, desc, state.accounts]);

  /** Clicking a header sorts by it; clicking the active header flips direction. */
  const sortBy = (key: SortKey) => {
    if (key === sort) setDesc(!desc);
    else {
      setSort(key);
      setDesc(key !== 'name');
    }
  };

  const connectedCount = SURFACES.filter((s) => surfaceStatus(s, state.accounts) === 'connected').length;
  const liveOrganic = state.variations.filter((v) => v.status === 'published').length;

  // Spend + results across the campaigns visible under the brand filter.
  const byChannel = useMemo(() => {
    const visible = new Set(visibleCampaigns.map((c) => c.id));
    const map = new Map<string, ChannelMetrics>();
    for (const p of PERFORMANCE.filter((p) => visible.has(p.campaignId))) {
      for (const ch of p.byChannel) {
        const cur = map.get(ch.channel);
        if (!cur) map.set(ch.channel, { ...ch });
        else {
          // Null propagates through a sum: an unmeasured metric plus a known
          // one is still unmeasured, not the known one.
          cur.impressions =
            cur.impressions === null || ch.impressions === null ? null : cur.impressions + ch.impressions;
          cur.spend = cur.spend === null || ch.spend === null ? null : cur.spend + ch.spend;
          cur.clicks += ch.clicks;
          cur.leads += ch.leads;
          cur.conversions += ch.conversions;
          cur.revenue += ch.revenue;
        }
      }
    }
    return [...map.values()].sort((a, b) => b.leads - a.leads);
  }, [visibleCampaigns]);

  // Spend is only knowable once an ad account is connected, so a total is
  // only meaningful when every channel reported one.
  const totalSpend = byChannel.some((c) => c.spend === null)
    ? null
    : byChannel.reduce((s, c) => s + (c.spend ?? 0), 0);
  const totalLeads = byChannel.reduce((s, c) => s + c.leads, 0);
  const maxLeads = Math.max(...byChannel.map((c) => c.leads), 1);
  const topChannel = byChannel[0]?.channel;

  const coverageBrands = activeBrand ? [activeBrand] : BRANDS;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Advertising HUD</h1>
          <div className="sub">
            Every surface where your customers can find you — organic and paid, connected and missing — in one view.
            Fit is scored for {activeBrand ? activeBrand.name : 'each of your businesses'}, not a generic checklist.
          </div>
        </div>
        <div className="actions">
          <Link href="/connections" className="btn">
            Manage connections
          </Link>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="card stat-tile">
          <div className="st-label">Surfaces mapped</div>
          <div className="st-value">{SURFACES.length}</div>
          <div className="st-delta flat">{SURFACES.filter((s) => s.organic).length} organic · {SURFACES.filter((s) => s.paid).length} with a paid product</div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Live now</div>
          <div className="st-value">{connectedCount}</div>
          <div className="st-delta flat">
            <Link href="/connections">connected surfaces →</Link>
          </div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Organic posts live</div>
          <div className="st-value">{fmtNum(liveOrganic)}</div>
          <div className="st-delta flat">published across the workspace</div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Paid spend tracked</div>
          {/* Showing $0 would claim these results were free. Until an ad
              account is connected the truthful answer is that we don't know. */}
          <div className="st-value">
            {totalSpend === null
              ? <span style={{ color: 'var(--muted)' }}>Not measured</span>
              : fmtMoney(totalSpend)}
          </div>
          <div className="st-delta flat">
            {totalSpend === null
              ? 'connect an ad account to track spend'
              : totalSpend > 0 && totalLeads > 0
                ? `$${(totalSpend / totalLeads).toFixed(2)} blended cost per lead`
                : 'no paid promotion yet'}
          </div>
        </div>
      </div>

      {/* Coverage + gaps per business */}
      <div className={`grid ${coverageBrands.length > 1 ? 'cols-2' : ''}`} style={{ marginBottom: 14 }}>
        {coverageBrands.map((brand) => {
          const cov = coverageFor(brand.industry, state.accounts);
          return (
            <div key={brand.id} className="card card-pad">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <h3>{brand.name}</h3>
                <span style={{ color: 'var(--muted)', fontSize: 11.5, textTransform: 'capitalize' }}>
                  {brand.industry.replace('_', ' ')}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 650 }}>
                  {cov.essentialCovered} of {cov.essential.length} essential surfaces live
                </span>
              </div>
              <div className="meter" style={{ margin: '8px 0 12px' }} role="img" aria-label={`Coverage ${cov.pct}%`}>
                <div className="meter-fill" style={{ width: `${cov.pct}%` }} />
              </div>
              {cov.gaps.length === 0 ? (
                <div className="notice success">✓ Every strong-fit surface is live. Rare air.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {cov.gaps.slice(0, 3).map((gap) => (
                    <div key={gap.surface.id} className="gap-chip">
                      <SurfaceIcon surface={gap.surface} />
                      <div className="gc-body">
                        <span className="gc-name">
                          {gap.surface.name} <FitDots fit={gap.fit} />
                        </span>
                        <div className="gc-why">{gap.reason}</div>
                      </div>
                    </div>
                  ))}
                  {cov.gaps.length > 3 && (
                    <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                      + {cov.gaps.length - 3} more in the matrix below
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* The landscape matrix */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h3>The landscape</h3>
          <span className="card-sub">
            {rows.length} surfaces, ranked by fit{activeBrand ? ` for ${activeBrand.name}` : ' (best across your businesses)'}
          </span>
          <div className="right">
            <div className="seg" role="tablist" aria-label="Surface type">
              {KIND_FILTERS.map((k) => (
                <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                  {k === 'all' ? 'All' : KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="table-scroll">
          <table className="table matrix">
            <thead>
              <tr>
                {(
                  [
                    ['Surface', 'name'],
                    ['Organic', 'organic'],
                    ['Paid', 'paid'],
                    ['Best for', null],
                    ['Fit', 'fit'],
                    ['Status', 'status'],
                    ['Reality check', null],
                  ] as [string, SortKey | null][]
                ).map(([label, key]) =>
                  key ? (
                    <th
                      key={label}
                      aria-sort={sort === key ? (desc ? 'descending' : 'ascending') : 'none'}
                    >
                      <button className="th-sort" onClick={() => sortBy(key)}>
                        {label}
                        <span className={`sort-caret ${sort === key ? 'on' : ''}`} aria-hidden>
                          {sort === key ? (desc ? '▼' : '▲') : '▾'}
                        </span>
                      </button>
                    </th>
                  ) : (
                    <th key={label}>{label}</th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const status = surfaceStatus(s, state.accounts);
                const ui = STATUS_UI[status];
                return (
                  <tr key={s.id}>
                    <td>
                      <span className="cell-name">
                        <SurfaceIcon surface={s} />
                        <span>
                          {s.name}
                          <span className="kind">{KIND_LABEL[s.kind]}</span>
                        </span>
                      </span>
                    </td>
                    <td>{s.organic ? '✓ posts' : '—'}</td>
                    <td style={{ maxWidth: 240 }}>
                      {s.paid ? (
                        <>
                          <div style={{ fontWeight: 650 }}>
                            {s.paid.product} <span className="goal-chip">{s.paid.costModel}</span>
                          </div>
                          <div style={{ color: 'var(--muted)', fontSize: 11 }}>{s.paid.note}</div>
                        </>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>no ads product</span>
                      )}
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                        {s.bestFor.slice(0, 2).map((g) => (
                          <span key={g} className="goal-chip">
                            {GOAL_LABELS[g]}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>
                      <FitDots fit={fitFor(s, industry)} />
                    </td>
                    <td>
                      <span className={`pill ${ui.cls}`}>{ui.label}</span>
                    </td>
                    <td style={{ color: 'var(--ink-2)', maxWidth: 260, fontSize: 11.5 }}>{s.apiNote}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid cols-2">
        {/* Spend & results by surface */}
        <div className="card card-pad">
          <h3>What the surfaces are producing</h3>
          <div className="card-sub" style={{ marginBottom: 10 }}>
            Leads by surface{activeBrand ? ` — ${activeBrand.name}` : ''} · standout in blue
          </div>
          {byChannel.length === 0 ? (
            <div className="empty">No results yet — connect surfaces and run a campaign.</div>
          ) : (
            <div>
              {byChannel.map((r) => (
                <div key={r.channel} className="hbar-row" title={`${CHANNEL_META[r.channel].label}: ${r.leads} leads`}>
                  <span className="hb-label">
                    <ChannelIcon channel={r.channel} size={15} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {CHANNEL_META[r.channel].label}
                    </span>
                  </span>
                  <span className="hbar-track">
                    <span
                      className="hbar-fill"
                      style={{ width: `${(r.leads / maxLeads) * 100}%`, background: r.channel === topChannel ? 'var(--series-1)' : 'var(--deemph)' }}
                    />
                  </span>
                  <span className="hb-val">
                    {r.leads}
                    {r.spend !== null && r.spend > 0 && (
                      <span style={{ display: 'block', fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>
                        {fmtMoney(r.spend)} spent
                      </span>
                    )}
                  </span>
                </div>
              ))}
              <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 8 }}>
                Full breakdown, conversion rates, and the table view live in{' '}
                <Link href="/analytics">Analytics</Link>.
              </div>
            </div>
          )}
        </div>

        {/* How the surfaces compose */}
        <div className="card card-pad">
          <h3>How the surfaces compose</h3>
          <div className="card-sub" style={{ marginBottom: 10 }}>
            The playbook the HUD is built around
          </div>
          <dl className="kv" style={{ gridTemplateColumns: '150px 1fr', rowGap: 10 }}>
            <dt>Create demand</dt>
            <dd>
              Social and video (Facebook, Instagram, TikTok, Pinterest, X) put you in front of people who weren’t
              looking yet. Organic proves the message; paid scales the posts that already work.
            </dd>
            <dt>Capture demand</dt>
            <dd>
              Search and local (Google Ads, Local Services Ads, Google Business, Nextdoor, Yelp) catch people at the
              moment they’re choosing. Highest intent, first budget dollar.
            </dd>
            <dt>Convert & keep</dt>
            <dd>
              Owned and messaging (website, email, SMS, WhatsApp) close the loop and bring customers back — the only
              audience an algorithm can’t take away.
            </dd>
          </dl>
          <div className="notice info" style={{ marginTop: 12 }}>
            Every campaign in Perception can span all three layers — one message, adapted per surface, approved once.
          </div>
        </div>
      </div>
    </div>
  );
}
