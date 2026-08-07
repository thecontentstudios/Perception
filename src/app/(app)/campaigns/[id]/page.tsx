'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { VariationEditor } from '@/components/VariationEditor';
import { fmtMoney, fmtNum, StatusPill, WarnBadge } from '@/components/ui';
import { CHANNEL_META, ChannelIcon } from '@/lib/channels';
import { fmtDateTime, fmtShort } from '@/lib/dates';
import { CAMPAIGN_COLORS } from '@/lib/demo-data';
import { GOAL_LABELS } from '@/lib/types';
import { useApp } from '@/lib/store';
import { Collapsible } from '@/components/Collapsible';

function FauxQr() {
  // Decorative stand-in for the auto-generated campaign QR code.
  const cells = [
    '1111101010111110', '1000101100100010', '1011100110101110', '1011101010101110',
    '1000100110100010', '1111101010111110', '0000000110000000', '1010111011101011',
    '0110010100110100', '1011101110101110', '0000001010000010', '1111100110111010',
    '1000101010100110', '1011100100101010', '1011101110111110', '1000100010100010',
  ];
  return (
    <svg width="72" height="72" viewBox="0 0 16 16" aria-label="Campaign QR code" role="img" style={{ borderRadius: 6, background: '#fff', border: '1px solid var(--hairline)' }}>
      {cells.flatMap((row, y) =>
        row.split('').map((c, x) => (c === '1' ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#0b0b0b" /> : null))
      )}
    </svg>
  );
}

interface Rollup {
  sends: { id: string; channel: string; subject: string | null; preview: string; sentAt: string; total: number; delivered: number; opened: number }[];
  flights: { id: string; channel: string; status: string; dailyCents: number; days: number; settledCents: number | null; results: { conversions: number; revenueCents: number; costPerResultCents: number | null; certainty: string | null } }[];
  costs: { channel: string; exactCents: number; estimatedCents: number; conversions: number; revenueCents: number; costPerResultCents: number | null }[];
  totals: { exactCents: number; estimatedCents: number; conversions: number; revenueCents: number };
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const { state, campaignById, brandById, itemById, performanceFor, preflightFor } = useApp();
  const [selected, setSelected] = useState<string | null>(null);

  /**
   * What the campaign actually did — sends, flights, money, results — from
   * the rollup endpoint. The store above knows the plan; this knows the
   * outcome, and the page shows both because "what we intended" and "what
   * happened" are different sections, not different apps.
   */
  const [rollup, setRollup] = useState<Rollup | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/campaigns/${params.id}/rollup`)
      .then((r) => r.json())
      .then((d) => live && d.ok && setRollup(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [params.id]);

  const campaign = campaignById(params.id);
  if (!campaign) {
    return (
      <div className="page">
        <div className="empty">Campaign not found. <Link href="/campaigns">Back to campaigns</Link></div>
      </div>
    );
  }
  const brand = brandById(campaign.brandId);
  const color = CAMPAIGN_COLORS[campaign.colorIndex % CAMPAIGN_COLORS.length];
  const perf = performanceFor(campaign.id);
  const items = state.items.filter((i) => i.campaignId === campaign.id);
  const trackedLink = `${campaign.cta.url}?utm_campaign=${campaign.utmCode}`;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span className="campaign-dot" style={{ background: color.line, width: 12, height: 12 }} />
            <h1>{campaign.name}</h1>
            <span className="pill neutral">{campaign.status.replace('_', ' ')}</span>
          </div>
          <div className="sub">
            {brand?.name} · {fmtShort(campaign.startDate)} – {fmtShort(campaign.endDate)} · {campaign.description}
          </div>
        </div>
        <div className="actions">
          <Link href="/calendar" className="btn">
            View on calendar
          </Link>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="card card-pad" style={{ gridColumn: 'span 2' }}>
          <dl className="kv">
            <dt>Goal</dt>
            <dd>{GOAL_LABELS[campaign.goal]}</dd>
            <dt>Audience</dt>
            <dd>{campaign.audience}</dd>
            <dt>Offer</dt>
            <dd>{campaign.offer ?? '—'}</dd>
            <dt>Call to action</dt>
            <dd>
              <strong>{campaign.cta.label}</strong> → {campaign.cta.url}
            </dd>
            <dt>Tracked link</dt>
            <dd>
              <code className="mono">{trackedLink}</code>
            </dd>
          </dl>
        </div>
        <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <FauxQr />
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
            Every campaign gets a tagged link and QR code automatically, so calls, forms, and bookings trace back to it.
          </div>
        </div>
      </div>

      {perf && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 14 }}>
            {perf.outcomes.map((o) => (
              <div key={o.kind} className="card stat-tile">
                <div className="st-label">{GOAL_LABELS[o.kind]}</div>
                <div className="st-value">{fmtNum(o.count)}</div>
              </div>
            ))}
            <div className="card stat-tile">
              <div className="st-label">Revenue attributed</div>
              <div className="st-value">{fmtMoney(perf.byChannel.reduce((s, c) => s + c.revenue, 0))}</div>
            </div>
          </div>
          <div className="notice info" style={{ marginBottom: 14 }}>
            {perf.headline} <Link href="/analytics">See the full breakdown →</Link>
          </div>
        </>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Campaign content</h3>
          <span className="card-sub">The shared message, adapted per channel. Click any version to edit it.</span>
        </div>
        <ul className="list-plain">
          {items.map((item) => {
            const vars = state.variations.filter((v) => v.contentItemId === item.id);
            return (
              <li key={item.id} className="convo" style={{ alignItems: 'flex-start' }}>
                <div className="cv-body">
                  <div className="cv-top">
                    <span className="cv-from">{item.title}</span>
                    <span className="pill neutral">{item.kind}</span>
                  </div>
                  <div className="cv-text" style={{ marginBottom: 8 }}>{item.coreMessage}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {vars.map((v) => (
                      <button key={v.id} className="btn sm" onClick={() => setSelected(v.id)} style={{ gap: 6 }}>
                        <ChannelIcon channel={v.channel} size={14} />
                        {CHANNEL_META[v.channel].short}
                        {v.format !== 'post' && v.format !== 'update' && v.format !== 'email' ? ` · ${v.format.replace('_', ' ')}` : ''}
                        <StatusPill status={v.status} />
                        {v.scheduledAt && <span style={{ color: 'var(--muted)', fontSize: 10.5 }}>{fmtDateTime(v.scheduledAt)}</span>}
                        <WarnBadge warnings={preflightFor(v)} />
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ------- what the campaign did, beyond its posts (Phase 18) ------- */}
      {rollup && (rollup.sends.length > 0 || rollup.flights.length > 0 || rollup.totals.exactCents > 0 || rollup.totals.conversions > 0) && (
        <>
          <Collapsible
            id={`campaign.${params.id}.money`}
            title="Money and results"
            defaultOpen
            summary={`${fmtMoney(rollup.totals.exactCents / 100)} spent · ${rollup.totals.conversions} results${rollup.totals.revenueCents > 0 ? ` · ${fmtMoney(rollup.totals.revenueCents / 100)} back` : ''}`}
          >
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr><th>Channel</th><th className="num">Spent</th><th className="num">Estimated</th><th className="num">Results</th><th className="num">Revenue</th><th className="num">Cost / result</th></tr>
                </thead>
                <tbody>
                  {rollup.costs.map((c) => (
                    <tr key={c.channel}>
                      <td>{CHANNEL_META[c.channel as keyof typeof CHANNEL_META]?.label ?? c.channel}</td>
                      <td className="num">{c.exactCents > 0 ? fmtMoney(c.exactCents / 100) : '—'}</td>
                      <td className="num" style={{ color: 'var(--muted)', fontStyle: c.estimatedCents ? 'italic' : undefined }}>
                        {c.estimatedCents > 0 ? `~${fmtMoney(c.estimatedCents / 100)}` : '—'}
                      </td>
                      <td className="num">{c.conversions || '—'}</td>
                      <td className="num">{c.revenueCents > 0 ? fmtMoney(c.revenueCents / 100) : '—'}</td>
                      <td className="num" title="Exact spend over measured results on this channel. Channels are never averaged together.">
                        {c.costPerResultCents != null ? fmtMoney(c.costPerResultCents / 100) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Collapsible>

          {rollup.sends.length > 0 && (
            <Collapsible
              id={`campaign.${params.id}.sends`}
              title="Messages sent"
              defaultOpen={false}
              summary={`${rollup.sends.length} ${rollup.sends.length === 1 ? 'send' : 'sends'}`}
            >
              <ul className="list">
                {rollup.sends.map((b) => (
                  <li key={b.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <ChannelIcon channel={b.channel as never} size={14} />
                    <strong>{b.subject ?? b.preview}</strong>
                    <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                      {b.delivered} of {b.total} delivered{b.opened > 0 ? `, ${b.opened} opened` : ''} · {fmtShort(b.sentAt.slice(0, 10))}
                    </span>
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}

          {rollup.flights.length > 0 && (
            <Collapsible
              id={`campaign.${params.id}.flights`}
              title="Ad flights"
              defaultOpen={false}
              summary={`${rollup.flights.length} ${rollup.flights.length === 1 ? 'flight' : 'flights'}`}
            >
              <ul className="list">
                {rollup.flights.map((f) => (
                  <li key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <ChannelIcon channel={f.channel as never} size={14} />
                    <strong>{fmtMoney(f.dailyCents / 100)}/day × {f.days}</strong>
                    <span className="chip">{f.status.replace('_', ' ')}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                      {f.results.conversions > 0
                        ? `${f.results.conversions} results${f.results.costPerResultCents != null ? ` · ${f.results.certainty === 'estimated' ? '~' : ''}${fmtMoney(f.results.costPerResultCents / 100)} each` : ''}`
                        : 'no measured results yet'}
                    </span>
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}
        </>
      )}

      {selected && <VariationEditor variationId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
