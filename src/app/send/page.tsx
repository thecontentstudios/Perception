'use client';

import { useMemo, useState } from 'react';
import { BRANDS, SEGMENTS, useApp } from '@/lib/store';
import { reachFor, reachSummary } from '@/lib/audience';
import { previewSms, proposeDowngrade, previewRange, checkQuietHours } from '@/lib/sms';
import { projectEmail, projectSms, type Projection } from '@/lib/projection';
import { EMAIL_RATES, SMS_RATES, money } from '@/lib/pricing';
import { CostRail } from './CostRail';

/**
 * Send an email or a text campaign.
 *
 * The whole interface is built around one decision: **the price is on screen
 * the entire time, and it changes as you type.**
 *
 * Every tool in this category puts cost on a final review step, which is the
 * one place it cannot influence anything — by then the audience is picked, the
 * message is written, and the only options left are "send" and "throw away the
 * last twenty minutes". Putting the number next to the textarea means the
 * emoji that triples the bill gets caught while the sentence is still being
 * written, and the audience that costs $60 gets narrowed while narrowing it is
 * still a small decision.
 *
 * So: no wizard. One page, three sections, and a cost rail that never leaves.
 */

type Mode = 'email' | 'sms';

const DEFAULT_EMAIL =
  'Hi {{name}},\n\nWe have a few slots left this month and wanted to offer them to regulars first.\n\nBook here: {{link}}';
const DEFAULT_SMS = '{{business}}: 3 slots left this month. Book here {{link}}';

export default function SendPage() {
  const { state } = useApp();
  const [mode, setMode] = useState<Mode>('email');
  const [brandId, setBrandId] = useState<string>('all');
  const [segmentId, setSegmentId] = useState<string>('all');
  const [subject, setSubject] = useState('A few slots left this month');
  const [emailBody, setEmailBody] = useState(DEFAULT_EMAIL);
  const [smsBody, setSmsBody] = useState(DEFAULT_SMS);
  const [provider, setProvider] = useState<string>('resend');
  const [country, setCountry] = useState<string>('US');
  const [sentThisMonth, setSentThisMonth] = useState(0);
  const [setupPaid, setSetupPaid] = useState(false);
  const [domainVerified, setDomainVerified] = useState(true);
  const [hour, setHour] = useState(10);

  const body = mode === 'email' ? emailBody : smsBody;
  const setBody = mode === 'email' ? setEmailBody : setSmsBody;

  // ---- audience -----------------------------------------------------------

  const pool = useMemo(() => {
    let cs = state.contacts;
    if (brandId !== 'all') cs = cs.filter((c) => c.brandId === brandId);
    if (segmentId !== 'all') cs = cs.filter((c) => c.segmentIds.includes(segmentId));
    return cs;
  }, [state.contacts, brandId, segmentId]);

  const reach = useMemo(() => reachFor(pool, mode), [pool, mode]);

  // ---- cost ---------------------------------------------------------------

  const smsPreview = useMemo(() => (mode === 'sms' ? previewSms(smsBody) : null), [mode, smsBody]);
  const downgrade = useMemo(
    () => (mode === 'sms' && smsPreview?.encoding === 'UCS-2' ? proposeDowngrade(smsBody) : null),
    [mode, smsBody, smsPreview]
  );
  const brandName = brandId === 'all' ? 'our business' : (BRANDS.find((b) => b.id === brandId)?.name ?? 'our business');
  const smsRange = useMemo(
    () =>
      mode === 'sms'
        ? previewRange(smsBody, { names: reach.contacts.map((c) => c.name), business: brandName })
        : null,
    [mode, smsBody, reach.contacts, brandName]
  );

  const projection: Projection = useMemo(() => {
    if (mode === 'email') {
      return projectEmail({ provider, recipients: reach.reachable, sentThisMonth, domainVerified });
    }
    return projectSms({
      body: smsBody,
      recipients: reach.reachable,
      country,
      paidFixedCostIds: setupPaid ? ['sms.10dlc.brand', 'sms.10dlc.campaign', 'sms.number'] : [],
      expectedReplyRate: 0.03,
    });
  }, [mode, provider, reach.reachable, sentThisMonth, domainVerified, smsBody, country, setupPaid]);

  // A send is only ever attempted at a real hour, so the quiet-hours answer
  // is computed for the hour actually chosen rather than for "now".
  const quiet = useMemo(() => {
    if (mode !== 'sms') return null;
    const at = new Date(Date.UTC(2026, 0, 1, hour, 0, 0));
    return checkQuietHours(at, 0);
  }, [mode, hour]);

  const applyDowngrade = () => {
    if (downgrade) setSmsBody(downgrade.text);
  };

  // ---- sending ------------------------------------------------------------

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  /**
   * Send, and take the server's answer over the browser's.
   *
   * The rail's figure is computed client-side so it can react as you type, but
   * the server recomputes it from its own view of the audience and the ledger
   * before charging anything. When the two disagree the server is right, and
   * saying so is the honest outcome — an interface that reports its own
   * optimistic number after the fact has just told a lie with a green tick.
   */
  const send = async (acknowledgeOverBudget = false) => {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: mode,
          body,
          subject,
          contactIds: reach.contacts.map((c) => c.id),
          brandId: brandId === 'all' ? undefined : brandId,
          acknowledgeOverBudget,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        // What this says used to be "Queued for 1,110 people — free charged",
        // which was wrong twice over: nothing had been queued anywhere but our
        // own table, and nothing had been charged because nothing had been
        // sent. The message now distinguishes accepted from sent, and names
        // the reason when the two differ.
        const n = Number(data.queued).toLocaleString('en-US');
        const people = data.queued === 1 ? 'person' : 'people';
        const committed = money(data.committedCents ?? projection.exactCents);
        setResult({
          ok: true,
          message: data.sending?.ready
            ? `Queued for ${n} ${people}. ${committed} will be charged as ${data.sending.provider} confirms each one.`
            : `Held for ${n} ${people} — ${committed} committed, nothing charged. ${data.sending?.why ?? ''} They will go out as soon as one is connected.`,
        });
      } else if (data.needsAcknowledgement) {
        setResult({ ok: false, message: `${data.reason} Press send again to go ahead anyway.` });
      } else {
        setResult({ ok: false, message: data.reason ?? 'That did not go through.' });
      }
    } catch {
      setResult({ ok: false, message: 'Could not reach the server. Nothing was sent or charged.' });
    } finally {
      setSending(false);
    }
  };

  // A second press after an over-budget warning is the acknowledgement.
  const overBudgetPending = result !== null && !result.ok && result.message.includes('Press send again');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Send</h1>
          <div className="sub">
            Email and text campaigns, priced as you write them. The number on the right is what this send costs —
            not an estimate, and not a surprise at the end.
          </div>
        </div>
        <div className="actions">
          <div className="seg" role="tablist" aria-label="Channel">
            <button
              role="tab"
              aria-selected={mode === 'email'}
              className={mode === 'email' ? 'on' : ''}
              onClick={() => setMode('email')}
            >
              Email
            </button>
            <button
              role="tab"
              aria-selected={mode === 'sms'}
              className={mode === 'sms' ? 'on' : ''}
              onClick={() => setMode('sms')}
            >
              Text
            </button>
          </div>
        </div>
      </div>

      <div className="send-layout">
        <div className="send-main">
          {/* ---------------------------------------------------- audience */}
          <div className="card card-pad">
            <div className="send-section-head">
              <h3>1 · Who gets it</h3>
              <span className={`pill ${reach.reachable === reach.total ? 'approved' : 'review'}`}>
                {reach.reachable.toLocaleString('en-US')} reachable
              </span>
            </div>

            <div className="send-filters">
              <label className="field" style={{ marginBottom: 0, flex: 1, minWidth: 160 }}>
                <span>Business</span>
                <select className="select" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                  <option value="all">All businesses</option>
                  {BRANDS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ marginBottom: 0, flex: 1, minWidth: 160 }}>
                <span>List</span>
                <select className="select" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
                  <option value="all">Everyone</option>
                  {SEGMENTS.filter((s) => brandId === 'all' || s.brandId === brandId).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="send-reach">{reachSummary(reach)}</p>

            {reach.exclusions.length > 0 && (
              <ul className="exclusions">
                {reach.exclusions.map((x) => (
                  <li key={x.reason}>
                    <span className="ex-count">{x.count.toLocaleString('en-US')}</span>
                    <span className="ex-reason">{x.reason}</span>
                    {x.fix && <span className="ex-fix">{x.fix}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---------------------------------------------------- message */}
          <div className="card card-pad">
            <div className="send-section-head">
              <h3>2 · What it says</h3>
              {mode === 'sms' && smsPreview && (
                <span className={`pill ${smsPreview.encoding === 'GSM-7' ? 'approved' : 'review'}`}>
                  {smsPreview.segments} {smsPreview.segments === 1 ? 'segment' : 'segments'} · {smsPreview.encoding}
                </span>
              )}
            </div>

            {mode === 'email' && (
              <div className="field">
                <label htmlFor="subject">Subject</label>
                <input
                  id="subject"
                  className="input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What lands in the inbox line"
                />
              </div>
            )}

            <div className="field" style={{ marginBottom: 6 }}>
              <label htmlFor="body">Message</label>
              <textarea
                id="body"
                className="textarea"
                rows={mode === 'email' ? 9 : 4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>

            {mode === 'sms' && smsPreview && (
              <SegmentMeter
                preview={smsPreview}
                downgrade={downgrade}
                onApply={applyDowngrade}
                perRecipientCents={smsPreview.segments * (SMS_RATES[country]?.perSegmentCents ?? 0)}
                recipients={reach.reachable}
                varies={smsRange?.varies ?? false}
                minSegments={smsRange?.min.segments ?? smsPreview.segments}
                maxSegments={smsRange?.max.segments ?? smsPreview.segments}
              />
            )}

            <div className="merge-hints">
              {['{{name}}', '{{business}}', '{{link}}'].map((t) => (
                <button
                  key={t}
                  type="button"
                  className="chip-btn"
                  onClick={() => setBody(body + (body.endsWith(' ') || !body ? '' : ' ') + t)}
                >
                  {t}
                </button>
              ))}
              <span className="hint">
                Personalisation is filled per recipient. On a text it changes the length, so the cost is shown as a
                range when it does.
              </span>
            </div>
          </div>

          {/* ---------------------------------------------------- service */}
          <div className="card card-pad">
            <div className="send-section-head">
              <h3>3 · Which service sends it</h3>
              <span className="card-sub">Rates differ by more than 10×. This is where that shows up.</span>
            </div>

            {mode === 'email' ? (
              <>
                <div className="provider-grid">
                  {Object.entries(EMAIL_RATES).map(([key, r]) => {
                    const cost = projectEmail({
                      provider: key,
                      recipients: reach.reachable,
                      sentThisMonth,
                      domainVerified: true,
                    }).exactCents;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`provider-card ${provider === key ? 'on' : ''}`}
                        onClick={() => setProvider(key)}
                        aria-pressed={provider === key}
                      >
                        <span className="pv-name">{r.provider}</span>
                        <span className="pv-cost">{money(cost)}</span>
                        <span className="pv-rate">
                          {money(r.per1000Cents)}/1,000 · {r.freeMonthly.toLocaleString('en-US')} free
                        </span>
                        <span className="pv-note">{r.note}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="send-toggles">
                  <label>
                    <input
                      type="checkbox"
                      checked={domainVerified}
                      onChange={(e) => setDomainVerified(e.target.checked)}
                    />
                    Sending domain verified (SPF, DKIM, DMARC)
                  </label>
                  <label>
                    Sent already this month
                    <input
                      type="number"
                      className="input"
                      style={{ width: 96, marginLeft: 8 }}
                      value={sentThisMonth}
                      min={0}
                      onChange={(e) => setSentThisMonth(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className="provider-grid">
                  {Object.entries(SMS_RATES).map(([key, r]) => (
                    <button
                      key={key}
                      type="button"
                      className={`provider-card ${country === key ? 'on' : ''}`}
                      onClick={() => setCountry(key)}
                      aria-pressed={country === key}
                    >
                      <span className="pv-name">{r.country}</span>
                      <span className="pv-cost">{money(r.perSegmentCents)}</span>
                      <span className="pv-rate">per segment, carrier fees in</span>
                      <span className="pv-note">{r.note}</span>
                    </button>
                  ))}
                </div>
                <div className="send-toggles">
                  <label>
                    <input type="checkbox" checked={setupPaid} onChange={(e) => setSetupPaid(e.target.checked)} />
                    Registration and number already paid for
                  </label>
                  <label>
                    Send at
                    <select
                      className="select"
                      style={{ width: 110, marginLeft: 8 }}
                      value={hour}
                      onChange={(e) => setHour(Number(e.target.value))}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {quiet && !quiet.allowed && (
                  <div className="notice warn" style={{ marginTop: 10 }}>
                    <strong>Outside sending hours.</strong> {quiet.reason} Marketing texts are restricted to 8am–9pm in
                    the recipient&rsquo;s time zone, and the penalty runs $500–$1,500 per message. This send is blocked
                    until the window opens.
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <CostRail
          projection={projection}
          recipients={reach.reachable}
          mode={mode}
          blockedByQuietHours={Boolean(quiet && !quiet.allowed)}
          onSend={() => void send(overBudgetPending)}
          sending={sending}
          result={result}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The segment meter
// ---------------------------------------------------------------------------

/**
 * The character counter, rebuilt to show the thing that actually costs money.
 *
 * A normal SMS composer shows "142/160". That counter is wrong the moment
 * someone types a curly apostrophe, because the denominator silently becomes
 * 70 — and the counter keeps counting up to 160 as if nothing happened.
 *
 * This one shows the denominator it is actually using, names the character
 * that set it, and puts the money next to it. "142/70 · 3 segments · $13.20"
 * is a sentence someone can act on.
 */
function SegmentMeter({
  preview,
  downgrade,
  onApply,
  perRecipientCents,
  recipients,
  varies,
  minSegments,
  maxSegments,
}: {
  preview: ReturnType<typeof previewSms>;
  downgrade: ReturnType<typeof proposeDowngrade> | null;
  onApply: () => void;
  perRecipientCents: number;
  recipients: number;
  varies: boolean;
  minSegments: number;
  maxSegments: number;
}) {
  const pct = Math.min(100, (preview.units / (preview.segments * preview.perSegment || 1)) * 100);
  // What one more segment costs across the whole audience — the number the
  // writer is actually trading against when they add a sentence.
  const nextSegmentCents = (perRecipientCents / Math.max(1, preview.segments)) * recipients;
  const saving =
    downgrade && downgrade.segmentsSaved > 0
      ? Math.round((downgrade.segmentsSaved / Math.max(1, preview.segments)) * perRecipientCents * recipients)
      : 0;

  return (
    <div className="seg-meter">
      <div className="sm-bar" aria-hidden>
        {Array.from({ length: Math.max(1, preview.segments) }, (_, i) => (
          <span key={i} className="sm-seg" />
        ))}
        <span className="sm-fill" style={{ width: `${pct}%` }} />
      </div>

      {/* "99/67" was the first version of this line and it read as an
          overflow — the denominator is the *per segment* capacity, not the
          budget for the message. What a writer needs is how many characters
          are left before the next segment is charged, and what that segment
          would cost. So that is what it says. */}
      <div className="sm-row">
        <span className="sm-count">
          <strong>{preview.units}</strong> characters · {preview.perSegment} per segment
        </span>
        <span className={`sm-enc ${preview.encoding === 'GSM-7' ? 'good' : 'bad'}`}>{preview.encoding}</span>
        <span className="sm-cost">
          {varies && minSegments !== maxSegments
            ? `${minSegments}–${maxSegments} segments each`
            : `${preview.segments} ${preview.segments === 1 ? 'segment' : 'segments'} each`}
          {' · '}
          {money(perRecipientCents * recipients)} total
        </span>
        {preview.units > 0 && (
          <span className={preview.remainingInSegment <= 20 ? 'sm-warn' : 'sm-room'}>
            {preview.remainingInSegment} more character{preview.remainingInSegment === 1 ? '' : 's'} before segment{' '}
            {preview.segments + 1} — another {money(nextSegmentCents)}
          </span>
        )}
      </div>

      {preview.optOutAdded && (
        <p className="sm-note">
          &ldquo;Reply STOP to opt out.&rdquo; is appended automatically and counted above. It is required on
          promotional texts, and it is 23 characters you did not budget for.
        </p>
      )}

      {preview.encoding === 'UCS-2' && (
        <div className="sm-culprits">
          <p>
            <strong>This message holds 70 characters per segment instead of 160</strong> because of{' '}
            {preview.culprits.length === 1 ? 'one character' : `${preview.culprits.length} characters`} outside the
            standard text alphabet:
          </p>
          <ul>
            {preview.culprits.slice(0, 6).map((c) => (
              <li key={c.codePoint}>
                <code className="mono">{c.char === '​' ? '␣' : c.char}</code>
                <span className="cul-name">
                  {c.name} <span className="cul-cp">{c.codePoint}</span>
                </span>
                <span className="cul-count">×{c.count}</span>
                {c.replacement !== null && (
                  <span className="cul-fix">
                    → <code className="mono">{c.replacement === '' ? 'remove' : c.replacement}</code>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {downgrade && downgrade.changed.length > 0 && (
            <button type="button" className="btn primary sm-fix" onClick={onApply}>
              Swap {downgrade.changed.reduce((n, c) => n + c.count, 0)} character
              {downgrade.changed.reduce((n, c) => n + c.count, 0) === 1 ? '' : 's'} for plain equivalents
              {downgrade.after.encoding === 'GSM-7' && saving > 0 ? ` — saves ${money(saving)}` : ''}
            </button>
          )}
          {downgrade && downgrade.changed.length === 0 && (
            <p className="sm-note">
              Nothing here can be swapped automatically — emoji and symbols are choices, not typos. Removing them by
              hand takes this back to 160 characters a segment.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
