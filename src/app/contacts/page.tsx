'use client';

import { useMemo, useState } from 'react';
import { SEGMENTS, useApp } from '@/lib/store';
import { fmtNum } from '@/components/ui';
import { reachFor } from '@/lib/audience';
import type { ConsentState } from '@/lib/types';

function ConsentPill({ state, kind }: { state: ConsentState; kind: 'Email' | 'SMS' }) {
  const cls = state === 'subscribed' ? 'published' : state === 'unsubscribed' ? 'failed' : 'draft';
  return (
    <span className={`pill ${cls}`} title={`${kind}: ${state}`}>
      {kind} {state === 'subscribed' ? '✓' : state === 'unsubscribed' ? '✕' : '?'}
    </span>
  );
}

/** A real list is thousands of rows; the browser renders a window of them. */
const PAGE = 100;

type Filter = 'all' | 'emailable' | 'textable' | 'no-phone' | 'unsubscribed';

export default function ContactsPage() {
  const { state, brandById } = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);

  const inBrand = useMemo(
    () =>
      state.activeBrandId === 'all'
        ? state.contacts
        : state.contacts.filter((c) => c.brandId === state.activeBrandId),
    [state.contacts, state.activeBrandId]
  );

  const segments =
    state.activeBrandId === 'all' ? SEGMENTS : SEGMENTS.filter((s) => s.brandId === state.activeBrandId);

  // The two numbers that matter before any send, computed from the same code
  // the composer uses — so the count here and the count there cannot disagree.
  const emailReach = useMemo(() => reachFor(inBrand, 'email'), [inBrand]);
  const smsReach = useMemo(() => reachFor(inBrand, 'sms'), [inBrand]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inBrand.filter((c) => {
      if (q && !`${c.name} ${c.email} ${c.phone ?? ''} ${c.source}`.toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'emailable':
          return c.email.trim() !== '' && c.emailConsent === 'subscribed';
        case 'textable':
          return c.phone !== null && c.smsConsent === 'subscribed';
        case 'no-phone':
          return c.phone === null;
        case 'unsubscribed':
          return c.emailConsent === 'unsubscribed' || c.smsConsent === 'unsubscribed';
        default:
          return true;
      }
    });
  }, [inBrand, query, filter]);

  const visible = filtered.slice(0, shown);

  const chip = (id: Filter, label: string, count: number) => (
    <button
      key={id}
      type="button"
      className={`filter-chip ${filter === id ? 'on' : ''}`}
      aria-pressed={filter === id}
      onClick={() => {
        setFilter(id);
        setShown(PAGE);
      }}
    >
      {label}
      <span className="fc-count">{fmtNum(count)}</span>
    </button>
  );

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

      {/* The headline is reachability, not headcount. A contact you may not
          legally text is not an audience, and leading with the total is how a
          business budgets for a campaign four times the size of the one it can
          actually send. */}
      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="card stat-tile">
          <div className="st-label">On the list</div>
          <div className="st-value">{fmtNum(inBrand.length)}</div>
          <div className="st-delta flat">across {segments.length || 1} lists</div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Can be emailed</div>
          <div className="st-value">{fmtNum(emailReach.reachable)}</div>
          <div className="st-delta flat">
            {inBrand.length - emailReach.reachable > 0
              ? `${fmtNum(inBrand.length - emailReach.reachable)} excluded`
              : 'everyone'}
          </div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Can be texted</div>
          <div className="st-value">{fmtNum(smsReach.reachable)}</div>
          <div className="st-delta flat">
            {smsReach.exclusions[0]
              ? `${fmtNum(smsReach.exclusions[0].count)} ${smsReach.exclusions[0].reason.toLowerCase()}`
              : 'everyone'}
          </div>
        </div>
      </div>

      {segments.length > 0 && (
        <div className="grid cols-4" style={{ marginBottom: 14 }}>
          {segments.map((s) => (
            <div key={s.id} className="card stat-tile">
              <div className="st-label">{s.name}</div>
              <div className="st-value">{fmtNum(s.contactCount)}</div>
              <div className="st-delta flat">{brandById(s.brandId)?.name}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>People</h3>
          <span className="card-sub">
            {filtered.length === inBrand.length
              ? `${fmtNum(inBrand.length)} contacts`
              : `${fmtNum(filtered.length)} of ${fmtNum(inBrand.length)}`}
          </span>
        </div>

        <div className="contact-controls">
          <input
            className="input"
            type="search"
            placeholder="Search name, email, phone, source…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            aria-label="Search contacts"
          />
          <div className="filter-chips">
            {chip('all', 'Everyone', inBrand.length)}
            {chip('emailable', 'Emailable', emailReach.reachable)}
            {chip('textable', 'Textable', smsReach.reachable)}
            {chip('no-phone', 'No phone', inBrand.filter((c) => c.phone === null).length)}
            {chip(
              'unsubscribed',
              'Opted out',
              inBrand.filter((c) => c.emailConsent === 'unsubscribed' || c.smsConsent === 'unsubscribed').length
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="empty" style={{ margin: '18px 15px' }}>
            Nothing matches that.
          </p>
        ) : (
          <div className="table-scroll" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Business</th>
                  <th>Consent</th>
                  <th>Source</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
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
                    <td style={{ color: 'var(--ink-2)' }}>{c.addedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {shown < filtered.length && (
          <div className="contact-more">
            <button className="btn" onClick={() => setShown((n) => n + PAGE * 5)}>
              Show more
            </button>
            <span>
              {fmtNum(visible.length)} of {fmtNum(filtered.length)} shown
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
