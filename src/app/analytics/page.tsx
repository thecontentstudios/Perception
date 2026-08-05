'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { fmtMoney, fmtNum } from '@/components/ui';
import { CHANNEL_META, ChannelIcon } from '@/lib/channels';
import { addDays, fmtShort } from '@/lib/dates';
import { PERFORMANCE } from '@/lib/demo-data';
import { GOAL_LABELS } from '@/lib/types';
import { useApp } from '@/lib/store';
import type { CampaignPerformance, ChannelMetrics } from '@/lib/types';

/**
 * Analytics leads with business outcomes — quote requests, bookings, revenue —
 * not impressions. Charts follow the validated dataviz method: a single
 * sequential hue for magnitude, the emphasis form (one hue + de-emphasis
 * gray) for "which channel matters," visible row labels + a full table twin
 * as contrast relief for the gray, hairline solid grid, thin rounded-top
 * bars, and hover/focus tooltips that enhance rather than gate.
 */

const BLUE = '#2a78d6';
const DEEMPH = '#c3c2b7';

function roundedTopBar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M ${x} ${y + h} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h} Z`;
}

function WeeklyLeadsChart({ data }: { data: { weekOf: string; leads: number }[] }) {
  const [tip, setTip] = useState<{ i: number; leftPct: number; topPct: number } | null>(null);

  const W = 560;
  const H = 190;
  const pad = { l: 30, r: 8, t: 14, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = Math.max(...data.map((d) => d.leads), 1);
  const niceMax = Math.max(5, Math.ceil(max / 5) * 5);
  const ticks = [0, niceMax / 2, niceMax];
  const band = plotW / data.length;
  const barW = Math.min(24, band * 0.5);
  const maxIdx = data.reduce((mi, d, i) => (d.leads > data[mi].leads ? i : mi), 0);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Leads by week">
        {ticks.map((t) => {
          const y = pad.t + plotH - (t / niceMax) * plotH;
          return (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--grid)" strokeWidth={1} />
              <text x={pad.l - 6} y={y + 3.5} textAnchor="end" className="axis-text">
                {t}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.leads / niceMax) * plotH;
          const x = pad.l + band * i + (band - barW) / 2;
          const y = pad.t + plotH - h;
          return (
            <g
              key={d.weekOf}
              tabIndex={0}
              role="img"
              aria-label={`Week of ${fmtShort(d.weekOf)}: ${d.leads} leads`}
              onMouseEnter={() => setTip({ i, leftPct: ((pad.l + band * i + band / 2) / W) * 100, topPct: (y / H) * 100 })}
              onMouseLeave={() => setTip(null)}
              onFocus={() => setTip({ i, leftPct: ((pad.l + band * i + band / 2) / W) * 100, topPct: (y / H) * 100 })}
              onBlur={() => setTip(null)}
              style={{ outline: 'none', cursor: 'default' }}
            >
              {/* generous hit target, wider than the mark */}
              <rect x={pad.l + band * i} y={pad.t} width={band} height={plotH} fill="transparent" />
              {d.leads > 0 && <path d={roundedTopBar(x, y, barW, h)} fill={BLUE} />}
              {i === maxIdx && (
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" style={{ fill: 'var(--ink-2)', fontSize: 11, fontWeight: 650 }}>
                  {d.leads}
                </text>
              )}
              <text x={pad.l + band * i + band / 2} y={H - 8} textAnchor="middle" className="axis-text">
                {fmtShort(d.weekOf)}
              </text>
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={pad.t + plotH} y2={pad.t + plotH} stroke="var(--axis)" strokeWidth={1} />
      </svg>
      {tip && (
        <div className="chart-tip" style={{ left: `${tip.leftPct}%`, top: `${tip.topPct}%` }}>
          <div className="t-label">Week of {fmtShort(data[tip.i].weekOf)}</div>
          {data[tip.i].leads} leads
        </div>
      )}
    </div>
  );
}

function ChannelBars({ rows }: { rows: ChannelMetrics[] }) {
  const max = Math.max(...rows.map((r) => r.leads), 1);
  const top = rows.reduce((m, r) => (r.leads > m.leads ? r : m), rows[0]);
  return (
    <div>
      {rows.map((r) => (
        <div key={r.channel} className="hbar-row" title={`${CHANNEL_META[r.channel].label}: ${r.leads} leads`}>
          <span className="hb-label">
            <ChannelIcon channel={r.channel} size={15} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{CHANNEL_META[r.channel].label}</span>
          </span>
          <span className="hbar-track">
            <span
              className="hbar-fill"
              style={{ width: `${(r.leads / max) * 100}%`, background: r.channel === top.channel ? BLUE : DEEMPH }}
            />
          </span>
          <span className="hb-val">{r.leads}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Add two metrics that may be unmeasured. Null propagates: adding a known
 * number to an unknown one does not produce a known total.
 */
function addMaybe(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a + b;
}

/** Render a metric, or say plainly that we do not have it. */
function measured(n: number | null, fmt: (n: number) => string) {
  if (n === null) return <span style={{ color: 'var(--muted)' }} title="Needs a platform metrics connection">not measured</span>;
  return fmt(n);
}

export default function AnalyticsPage() {
  const { visibleCampaigns, campaignById } = useApp();
  const [sel, setSel] = useState('all');

  /**
   * Real performance when there are rows to compute it from, fixtures
   * otherwise. Both go through the same shape, so nothing below this line has
   * to care which it got — but the banner tells the reader, because acting on
   * illustrative numbers is exactly the mistake this screen exists to prevent.
   */
  const [computed, setComputed] = useState<CampaignPerformance[] | null>(null);
  const [meta, setMeta] = useState<{ attributedConversions: number; totalConversions: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/analytics')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || d.source !== 'computed') return;
        setComputed(d.performance);
        setMeta(d.meta);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const perf = useMemo(() => {
    const visible = new Set(visibleCampaigns.map((c) => c.id));
    const source = computed ?? PERFORMANCE;
    return source.filter((p) => visible.has(p.campaignId)).filter((p) => sel === 'all' || p.campaignId === sel);
  }, [visibleCampaigns, sel, computed]);

  const byChannel = useMemo(() => {
    const map = new Map<string, ChannelMetrics>();
    for (const p of perf) {
      for (const ch of p.byChannel) {
        const cur = map.get(ch.channel);
        if (!cur) map.set(ch.channel, { ...ch });
        else {
          // Unmeasured metrics stay unmeasured through a sum. Treating null as
          // zero here would quietly turn "we don't know" into "none".
          cur.impressions = addMaybe(cur.impressions, ch.impressions);
          cur.engagements = addMaybe(cur.engagements, ch.engagements);
          cur.spend = addMaybe(cur.spend, ch.spend);
          cur.clicks += ch.clicks;
          cur.leads += ch.leads;
          cur.conversions += ch.conversions;
          cur.revenue += ch.revenue;
        }
      }
    }
    return [...map.values()].sort((a, b) => b.leads - a.leads);
  }, [perf]);

  const weekly = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of perf) {
      for (const w of p.weeklyLeads) map.set(w.weekOf, (map.get(w.weekOf) ?? 0) + w.leads);
    }
    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([weekOf, leads]) => ({ weekOf, leads }));
  }, [perf]);

  const totals = byChannel.reduce(
    (t, ch) => ({
      leads: t.leads + ch.leads,
      conversions: t.conversions + ch.conversions,
      revenue: t.revenue + ch.revenue,
      spend: addMaybe(t.spend, ch.spend),
    }),
    { leads: 0, conversions: 0, revenue: 0, spend: null as number | null }
  );

  const bestConv = byChannel
    .filter((c) => c.clicks > 0 && c.leads > 0)
    .reduce<ChannelMetrics | null>((best, c) => {
      const rate = c.leads / c.clicks;
      return !best || rate > best.leads / best.clicks ? c : best;
    }, null);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <div className="sub">Results in the language of the business: leads, bookings, and revenue first — impressions second.</div>
        </div>
      </div>

      {/* Where these numbers come from. A reader deciding what to do next
          needs to know whether they are looking at their own results or an
          illustration, and how much of it we could actually trace. */}
      <div className="card card-pad" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="demo-clock">
          <span
            className="dot"
            style={{ background: computed ? 'var(--st-good)' : 'var(--st-warning)' }}
            aria-hidden
          />
          {computed ? 'Computed from your rows' : 'Illustrative sample data'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
          {computed
            ? meta && meta.totalConversions > 0
              ? `${meta.attributedConversions} of ${meta.totalConversions} results traced to a specific post. Clicks, leads and revenue are measured; impressions, engagement and ad spend need a platform connection.`
              : 'Clicks, leads and revenue are measured from tracked links and form events. Impressions, engagement and ad spend need a platform connection.'
            : 'Connect a database and publish a tracked post to see your own numbers here.'}
        </span>
      </div>

      {/* One filter row scoping everything below it */}
      <div className="cal-toolbar">
        <select className="select" aria-label="Campaign" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="all">All campaigns</option>
          {visibleCampaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {weekly.length > 0 && (
          <span className="pill neutral">
            {fmtShort(weekly[0].weekOf)} – {fmtShort(addDays(weekly[weekly.length - 1].weekOf, 6))}, 2026
          </span>
        )}
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="card stat-tile">
          <div className="st-label">Leads generated</div>
          <div className="st-value">{fmtNum(totals.leads)}</div>
          <div className="st-delta flat">quote requests, tours, registrations</div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Became customers</div>
          <div className="st-value">{fmtNum(totals.conversions)}</div>
          <div className="st-delta flat">booked, signed, or purchased</div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Revenue attributed</div>
          <div className="st-value">{fmtMoney(totals.revenue)}</div>
          <div className="st-delta flat">via tagged links & forms</div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Cost per lead</div>
          {/* "$0" here would read as "these leads were free", which is a
              claim we cannot make without ad-account data. Not measured is
              the truthful answer until Perception reads spend. */}
          <div className="st-value">
            {totals.spend === null
              ? <span style={{ color: 'var(--muted)' }}>Not measured</span>
              : totals.spend > 0
                ? `$${(totals.spend / Math.max(totals.leads, 1)).toFixed(2)}`
                : '$0'}
          </div>
          <div className="st-delta flat">
            {totals.spend === null
              ? 'needs an ad account connected'
              : totals.spend > 0
                ? `${fmtMoney(totals.spend)} promoted spend`
                : 'no paid promotion'}
          </div>
        </div>
      </div>

      {/* Plain-language reports */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h3>What happened, in plain language</h3>
        </div>
        <ul className="list-plain">
          {perf.map((p) => (
            <li key={p.campaignId} className="convo">
              <div className="cv-body">
                <div className="cv-top">
                  <Link href={`/campaigns/${p.campaignId}`} className="cv-from" style={{ color: 'var(--ink)' }}>
                    {campaignById(p.campaignId)?.name}
                  </Link>
                  {p.outcomes.map((o) => (
                    <span key={o.kind} className="pill neutral">
                      {fmtNum(o.count)} {GOAL_LABELS[o.kind].toLowerCase()}
                    </span>
                  ))}
                </div>
                <div className="cv-text">{p.headline}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        <div className="card card-pad">
          <h3>Leads by week</h3>
          <div className="card-sub" style={{ marginBottom: 10 }}>
            All lead types, attributed by tracked links
          </div>
          {weekly.length > 0 ? <WeeklyLeadsChart data={weekly} /> : <div className="empty">No data yet.</div>}
        </div>
        <div className="card card-pad">
          <h3>Which channel is doing the work</h3>
          <div className="card-sub" style={{ marginBottom: 10 }}>
            Leads by channel — the standout in blue
          </div>
          {byChannel.length > 0 ? <ChannelBars rows={byChannel} /> : <div className="empty">No data yet.</div>}
          {bestConv && (
            <div className="notice info" style={{ marginTop: 12 }}>
              {CHANNEL_META[bestConv.channel].label} converts clicks to leads at{' '}
              {Math.round((bestConv.leads / bestConv.clicks) * 100)}% — the best rate of any channel.
            </div>
          )}
        </div>
      </div>

      {/* Table twin: every charted value, plus the details */}
      <div className="card">
        <div className="card-head">
          <h3>Channel detail</h3>
          <span className="card-sub">The full numbers behind the charts</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Channel</th>
                <th className="num">Impressions</th>
                <th className="num">Clicks</th>
                <th className="num">Leads</th>
                <th className="num">Conversions</th>
                <th className="num">Click → lead</th>
                <th className="num">Revenue</th>
                <th className="num">Spend</th>
              </tr>
            </thead>
            <tbody>
              {byChannel.map((ch) => (
                <tr key={ch.channel}>
                  <td>
                    <span className="channel-chip">
                      <ChannelIcon channel={ch.channel} size={15} /> {CHANNEL_META[ch.channel].label}
                    </span>
                  </td>
                  <td className="num">{measured(ch.impressions, (n) => n.toLocaleString('en-US'))}</td>
                  <td className="num">{ch.clicks.toLocaleString('en-US')}</td>
                  <td className="num" style={{ fontWeight: 650 }}>
                    {ch.leads}
                  </td>
                  <td className="num">{ch.conversions}</td>
                  <td className="num">{ch.clicks > 0 ? `${Math.round((ch.leads / ch.clicks) * 100)}%` : '—'}</td>
                  <td className="num">{ch.revenue > 0 ? fmtMoney(ch.revenue) : '—'}</td>
                  <td className="num">{measured(ch.spend, fmtMoney)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
