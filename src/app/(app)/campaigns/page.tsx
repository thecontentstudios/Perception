'use client';

import Link from 'next/link';
import { CAMPAIGN_COLORS, PERFORMANCE } from '@/lib/demo-data';
import { fmtShort } from '@/lib/dates';
import { ChannelIcon } from '@/lib/channels';
import { GOAL_LABELS, type Channel } from '@/lib/types';
import { TEMPLATES, useApp } from '@/lib/store';
import { fmtNum } from '@/components/ui';

export default function CampaignsPage() {
  const { state, visibleCampaigns, brandById } = useApp();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Campaigns</h1>
          <div className="sub">One campaign, adapted to every channel. Social, email, website, and promotions managed as a single thing.</div>
        </div>
        <div className="actions">
          <Link href="/create" className="btn primary">
            + New campaign
          </Link>
        </div>
      </div>

      <div className="grid cols-2">
        {visibleCampaigns.map((c) => {
          const color = CAMPAIGN_COLORS[c.colorIndex % CAMPAIGN_COLORS.length];
          const vars = state.variations.filter((v) => v.campaignId === c.id);
          const published = vars.filter((v) => v.status === 'published').length;
          const channels = [...new Set(vars.map((v) => v.channel))] as Channel[];
          const perf = PERFORMANCE.find((p) => p.campaignId === c.id);
          const leads = perf?.byChannel.reduce((s, ch) => s + ch.leads, 0) ?? 0;
          return (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="card card-pad" style={{ color: 'inherit', display: 'block', borderTop: `3px solid ${color.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <h3 style={{ fontSize: 14.5 }}>{c.name}</h3>
                <span className="pill neutral" style={{ marginLeft: 'auto' }}>
                  {c.status.replace('_', ' ')}
                </span>
              </div>
              <div style={{ color: 'var(--ink-2)', fontSize: 12.5 }}>
                {brandById(c.brandId)?.name} · {fmtShort(c.startDate)} – {fmtShort(c.endDate)} · Goal: {GOAL_LABELS[c.goal]}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '10px 0 0' }}>
                <span className="icon-row">
                  {channels.slice(0, 6).map((ch) => (
                    <ChannelIcon key={ch} channel={ch} size={17} />
                  ))}
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                  {published}/{vars.length} published
                </span>
                <span style={{ marginLeft: 'auto', fontWeight: 650, fontSize: 12.5 }}>
                  {leads > 0 ? `${fmtNum(leads)} ${GOAL_LABELS[c.goal].toLowerCase()}` : '—'}
                </span>
              </div>
              {perf && <div style={{ color: 'var(--ink-2)', fontSize: 12, marginTop: 8, borderTop: '1px solid var(--hairline)', paddingTop: 8 }}>{perf.headline}</div>}
            </Link>
          );
        })}
      </div>

      <div className="section-label">Start from an industry template</div>
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Template</th>
                <th>For</th>
                <th>Channels</th>
                <th>Cadence</th>
                <th>Measured by</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {TEMPLATES.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 650 }}>{t.name}</td>
                  <td style={{ textTransform: 'capitalize' }}>{t.industry.replace('_', ' ')}</td>
                  <td>
                    <span className="icon-row">
                      {t.recommendedChannels.slice(0, 5).map((ch) => (
                        <ChannelIcon key={ch} channel={ch} size={16} />
                      ))}
                    </span>
                  </td>
                  <td style={{ color: 'var(--ink-2)' }}>{t.cadence}</td>
                  <td style={{ color: 'var(--ink-2)' }}>{t.measuredBy}</td>
                  <td>
                    <Link href="/create" className="btn sm">
                      Use
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
