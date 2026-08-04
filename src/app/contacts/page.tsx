'use client';

import { SEGMENTS, useApp } from '@/lib/store';
import { fmtNum } from '@/components/ui';
import type { ConsentState } from '@/lib/types';

function ConsentPill({ state, kind }: { state: ConsentState; kind: 'Email' | 'SMS' }) {
  const cls = state === 'subscribed' ? 'published' : state === 'unsubscribed' ? 'failed' : 'draft';
  return (
    <span className={`pill ${cls}`} title={`${kind}: ${state}`}>
      {kind} {state === 'subscribed' ? '✓' : state === 'unsubscribed' ? '✕' : '?'}
    </span>
  );
}

export default function ContactsPage() {
  const { state, brandById } = useApp();
  const contacts =
    state.activeBrandId === 'all' ? state.contacts : state.contacts.filter((c) => c.brandId === state.activeBrandId);
  const segments =
    state.activeBrandId === 'all' ? SEGMENTS : SEGMENTS.filter((s) => s.brandId === state.activeBrandId);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Contacts</h1>
          <div className="sub">
            Lists and segments for email and SMS. Unsubscribes are suppressed automatically at send time — you can’t
            accidentally email someone who opted out.
          </div>
        </div>
        <div className="actions">
          <button className="btn">Import CSV</button>
          <button className="btn primary">+ Add contact</button>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        {segments.map((s) => (
          <div key={s.id} className="card stat-tile">
            <div className="st-label">{s.name}</div>
            <div className="st-value">{fmtNum(s.contactCount)}</div>
            <div className="st-delta flat">{brandById(s.brandId)?.name}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>People</h3>
          <span className="card-sub">{contacts.length} shown</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Business</th>
                <th>Consent</th>
                <th>Source</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight: 650 }}>{c.name}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                      {c.email}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </div>
                  </td>
                  <td>{brandById(c.brandId)?.name}</td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 5 }}>
                      <ConsentPill state={c.emailConsent} kind="Email" />
                      <ConsentPill state={c.smsConsent} kind="SMS" />
                    </span>
                  </td>
                  <td style={{ color: 'var(--ink-2)' }}>{c.source}</td>
                  <td style={{ color: 'var(--ink-2)' }}>{c.lastActivity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
