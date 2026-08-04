'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CalendarCard } from '@/components/CalendarCard';
import { VariationEditor } from '@/components/VariationEditor';
import { fmtMoney, fmtNum, SevIcon, StatusPill } from '@/components/ui';
import { CHANNEL_META, ChannelIcon } from '@/lib/channels';
import { dateKeyOf, fmtDateTime, relativeLabel } from '@/lib/dates';
import { PERFORMANCE } from '@/lib/demo-data';
import { TODAY, useApp } from '@/lib/store';

export default function HomePage() {
  const { state, dispatch, visibleVariations, visibleCampaigns, campaignById, itemById, preflightFor } = useApp();
  const [selected, setSelected] = useState<string | null>(null);

  const failed = visibleVariations.filter((v) => v.status === 'failed');
  const inReview = visibleVariations.filter((v) => v.status === 'review');
  const reconnect = state.accounts.filter((a) => a.status === 'needs_reconnect' || a.status === 'expiring');
  const openConvos = state.conversations.filter((c) => c.status === 'open');

  const upcoming = visibleVariations
    .filter((v) => v.scheduledAt && dateKeyOf(v.scheduledAt) >= TODAY && (v.status === 'scheduled' || v.status === 'approved'))
    .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1))
    .slice(0, 6);

  const activeIds = new Set(visibleCampaigns.filter((c) => c.status === 'active' || c.status === 'scheduled').map((c) => c.id));
  const perf = PERFORMANCE.filter((p) => activeIds.has(p.campaignId));
  const thisWeek = perf.reduce((s, p) => s + (p.weeklyLeads.find((w) => w.weekOf === '2026-10-05')?.leads ?? 0), 0);
  const lastWeek = perf.reduce((s, p) => s + (p.weeklyLeads.find((w) => w.weekOf === '2026-09-28')?.leads ?? 0), 0);
  const totalLeads = perf.reduce((s, p) => s + p.byChannel.reduce((x, ch) => x + ch.leads, 0), 0);
  const revenue = perf.reduce((s, p) => s + p.byChannel.reduce((x, ch) => x + ch.revenue, 0), 0);

  const priorities = failed.length + inReview.length + reconnect.length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Good morning, Dana</h1>
          <div className="sub">
            {priorities > 0
              ? `${priorities} thing${priorities > 1 ? 's' : ''} need${priorities === 1 ? 's' : ''} your attention, then you're clear.`
              : 'Everything is on track.'}
          </div>
        </div>
        <div className="actions">
          <Link href="/create" className="btn primary">
            + New campaign
          </Link>
        </div>
      </div>

      {/* Results snapshot */}
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="card stat-tile">
          <div className="st-label">Leads this week</div>
          <div className="st-value">{fmtNum(thisWeek)}</div>
          <div className={`st-delta ${thisWeek >= lastWeek ? 'up' : 'down'}`}>
            {thisWeek >= lastWeek ? '▲' : '▼'} {Math.abs(thisWeek - lastWeek)} vs last week
          </div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Leads from active campaigns</div>
          <div className="st-value">{fmtNum(totalLeads)}</div>
          <div className="st-delta flat">across {perf.length} running campaigns</div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Revenue attributed</div>
          <div className="st-value">{fmtMoney(revenue)}</div>
          <div className="st-delta flat">from tracked links & forms</div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Conversations waiting</div>
          <div className="st-value">{fmtNum(openConvos.length)}</div>
          <div className="st-delta flat">
            <Link href="/inbox">open the inbox →</Link>
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        {/* Today's priorities */}
        <div className="card">
          <div className="card-head">
            <h3>Today’s priorities</h3>
          </div>
          <ul className="list-plain">
            {failed.map((v) => (
              <li key={v.id} className="convo">
                <SevIcon severity="block" size={16} />
                <div className="cv-body">
                  <div className="cv-top">
                    <span className="cv-from">Publish failed: {itemById(v.contentItemId)?.title}</span>
                    <StatusPill status="failed" />
                  </div>
                  <div className="cv-text">
                    {v.failure?.message} {campaignById(v.campaignId)?.name} · {CHANNEL_META[v.channel].label}.
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <Link href="/connections" className="btn sm primary">
                      Reconnect LinkedIn
                    </Link>
                    <button className="btn sm" onClick={() => dispatch({ type: 'retryFailed', variationId: v.id })}>
                      Retry now
                    </button>
                    <button className="btn sm ghost" onClick={() => setSelected(v.id)}>
                      Open
                    </button>
                  </div>
                </div>
              </li>
            ))}
            {reconnect.map((a) => (
              <li key={a.id} className="convo">
                <SevIcon severity="warn" size={16} />
                <div className="cv-body">
                  <div className="cv-top">
                    <span className="cv-from">
                      {CHANNEL_META[a.channel].label} {a.status === 'needs_reconnect' ? 'needs to be reconnected' : 'expires soon'}
                    </span>
                  </div>
                  <div className="cv-text">
                    {a.displayName}. Scheduled {CHANNEL_META[a.channel].label} posts will hold until it’s renewed.
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Link href="/connections" className="btn sm">
                      Fix in Connections
                    </Link>
                  </div>
                </div>
              </li>
            ))}
            {inReview.map((v) => (
              <li key={v.id} className="convo">
                <SevIcon severity="info" size={16} />
                <div className="cv-body">
                  <div className="cv-top">
                    <span className="cv-from">Waiting for your approval: {itemById(v.contentItemId)?.title}</span>
                    <StatusPill status="review" />
                  </div>
                  <div className="cv-text">
                    {campaignById(v.campaignId)?.name} · {CHANNEL_META[v.channel].label}
                    {v.scheduledAt ? ` · planned for ${fmtDateTime(v.scheduledAt)}` : ''}
                    {preflightFor(v).some((w) => w.severity === 'block') ? ' · has a blocking check to fix' : ''}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <button className="btn sm primary" onClick={() => setSelected(v.id)}>
                      Review & approve
                    </button>
                  </div>
                </div>
              </li>
            ))}
            {priorities === 0 && <li className="empty">Nothing needs you right now.</li>}
          </ul>
        </div>

        {/* Upcoming */}
        <div className="card">
          <div className="card-head">
            <h3>Coming up</h3>
            <div className="right">
              <Link href="/calendar" className="btn sm">
                Open calendar
              </Link>
            </div>
          </div>
          <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcoming.map((v) => (
              <div key={v.id} style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
                <span style={{ color: 'var(--muted)', fontSize: 11, width: 64, flex: 'none', fontWeight: 650 }}>
                  {relativeLabel(dateKeyOf(v.scheduledAt!), TODAY)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <CalendarCard variation={v} onOpen={setSelected} draggable={false} />
                </div>
              </div>
            ))}
            {upcoming.length === 0 && <div className="empty">Nothing scheduled yet — create a campaign.</div>}
          </div>
        </div>
      </div>

      {/* Campaign results */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>How campaigns are doing</h3>
          <div className="right">
            <Link href="/analytics" className="btn sm">
              Full analytics
            </Link>
          </div>
        </div>
        <ul className="list-plain">
          {perf.map((p) => {
            const c = campaignById(p.campaignId);
            if (!c) return null;
            return (
              <li key={p.campaignId} className="convo">
                <ChannelIcon channel={p.byChannel[0].channel} size={18} title="Top channel" />
                <div className="cv-body">
                  <div className="cv-top">
                    <Link href={`/campaigns/${c.id}`} className="cv-from" style={{ color: 'var(--ink)' }}>
                      {c.name}
                    </Link>
                    <span className="pill neutral">{c.status}</span>
                  </div>
                  <div className="cv-text">{p.headline}</div>
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
