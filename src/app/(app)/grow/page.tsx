'use client';

import { useEffect, useMemo, useState } from 'react';
import { BRANDS, useApp } from '@/lib/store';
import { reachFor } from '@/lib/audience';
import { fmtNum } from '@/components/ui';
import { ImportPanel } from './ImportPanel';
import { FormsPanel } from './FormsPanel';

/**
 * Growing the list the product says is your most valuable asset.
 *
 * `/advertise` opens with "start here: email your list" and `routes.ts` says
 * the owned audience "only grows if something else feeds it". Nothing fed it —
 * `contact.create` appeared exactly once in this codebase, in the seed. The
 * highest-leverage feature in the product was the one it did not have.
 *
 * Three ways in, in the order they are worth: a form that keeps working after
 * you set it up, the spreadsheet you already have, and the quote requests your
 * ads are already producing.
 */
export default function GrowPage() {
  const { state } = useApp();
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  const emailReach = useMemo(() => reachFor(state.contacts, 'email'), [state.contacts]);
  const smsReach = useMemo(() => reachFor(state.contacts, 'sms'), [state.contacts]);
  const pending = useMemo(
    () => state.contacts.filter((c) => c.emailConsent === 'pending').length,
    [state.contacts]
  );

  useEffect(() => setPendingCount(pending), [pending]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Grow the list</h1>
          <div className="sub">
            The cheapest way to reach anyone is to already have their address. Everything else on this page exists to
            make that list bigger — and to make sure every name on it can be defended.
          </div>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card stat-tile">
          <div className="st-label">Can be emailed</div>
          <div className="st-value">{fmtNum(emailReach.reachable)}</div>
          <div className="st-delta flat">confirmed, and not bounced</div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Waiting to confirm</div>
          <div className="st-value">{fmtNum(pendingCount ?? 0)}</div>
          <div className="st-delta flat">
            {pendingCount ? 'each one is a send away from counting' : 'nothing pending'}
          </div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Can be texted</div>
          <div className="st-value">{fmtNum(smsReach.reachable)}</div>
          <div className="st-delta flat">explicit SMS consent only</div>
        </div>
      </div>

      {/* The argument, stated once, because every control below is downstream
          of it and none of them make sense without it. */}
      <div className="card card-pad why-consent">
        <h3>Why this asks more questions than other tools</h3>
        <p>
          A contact marked <strong>subscribed</strong> is a claim that somebody agreed to hear from you. Mailbox
          providers, regulators and occasionally an annoyed customer will ask you to back that claim up, and the
          answer cannot be &ldquo;it was in a spreadsheet&rdquo;. So every route in records <em>how</em> — the
          sentence they were shown, when, and from where — and nothing becomes subscribed without one.
        </p>
        <p className="muted">
          The list that looks smaller reaches more people. Unconfirmed addresses are mostly typos and mistakes, both
          of which bounce, and bounces are the number your delivery rate is scored on.
        </p>
      </div>

      <FormsPanel />
      <ImportPanel brands={BRANDS} />

      <section className="route-group" style={{ marginTop: 18 }}>
        <div className="rg-head">
          <h3>From the work you are already doing</h3>
          <p>
            A quote request on your website now creates a contact automatically, held as pending and linked to the
            campaign that caused it. That is the loop closing: an ad produces a click, the click produces a lead, and
            the lead becomes somebody you can reach for a tenth of a cent next time instead of paying for the click
            again.
          </p>
        </div>
        <div className="card card-pad">
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>
            Already on — it works through the tracking snippet you installed on your site. Nothing is emailed on this
            basis; a form submission is not a subscription, so they wait as pending until they confirm.
          </p>
        </div>
      </section>
    </div>
  );
}
