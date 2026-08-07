'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { VariationEditor } from '@/components/VariationEditor';
import { fmtMoney, fmtNum, StatusPill, WarnBadge } from '@/components/ui';
import { CHANNEL_META, ChannelIcon } from '@/lib/channels';
import { fmtDateTime, fmtShort } from '@/lib/dates';
import { CAMPAIGN_COLORS } from '@/lib/demo-data';
import { GOAL_LABELS } from '@/lib/types';
import { useApp } from '@/lib/store';

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

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const { state, campaignById, brandById, itemById, performanceFor, preflightFor } = useApp();
  const [selected, setSelected] = useState<string | null>(null);

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

      {selected && <VariationEditor variationId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
