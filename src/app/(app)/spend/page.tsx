'use client';

import { useEffect, useMemo, useState } from 'react';
import { AD_RATES, EMAIL_RATES, FIXED_COSTS, SMS_RATES, amount, money, range } from '@/lib/pricing';
import { forecastMonth, projectAds, type AdPlan } from '@/lib/projection';
import { CHANNEL_META } from '@/lib/channels';
import { useApp } from '@/lib/store';
import { Collapsible, CollapseAll } from '@/components/Collapsible';
import { PriceTag } from '@/components/PriceTag';
import type { Channel } from '@/lib/types';

/**
 * The cost centre.
 *
 * This screen answers three questions in the order a business owner actually
 * asks them:
 *
 *   1. What have I spent? (fact)
 *   2. Where is the month going? (arithmetic on the fact)
 *   3. What would this new thing cost? (a plan, priced before committing)
 *
 * Most advertising dashboards answer only the first, and only per platform, so
 * the owner does the third one on paper and gets it wrong. The planner below
 * is the point of the page: change a daily budget, watch the month-end number
 * move, decide before spending rather than after.
 */

const PLANNABLE = Object.keys(AD_RATES) as Channel[];

interface FlightRow {
  id: string;
  channel: string;
  status: string;
  objective: string;
  dailyCents: number;
  days: number;
  estImpressionsLow: number;
  estImpressionsHigh: number;
  estimatedCents: number;
  exactCents: number;
  settledCents: number | null;
  results?: {
    conversions: number;
    revenueCents: number;
    costPerResultCents: number | null;
    certainty: 'exact' | 'estimated' | null;
  };
}

interface Ledger {
  chargedCents: number;
  committedCents: number;
  committedMessages: number;
  sending: { email: { ready: boolean; why: string }; sms: { ready: boolean; why: string } };
}

export default function SpendPage() {
  const { visibleCampaigns } = useApp();
  const [flightCampaignId, setFlightCampaignId] = useState<string>('');
  // Ad flights being considered. Starts with one so the planner is usable on
  // arrival rather than presenting an empty state and an "Add" button.
  const [plans, setPlans] = useState<AdPlan[]>([
    { channel: 'facebook', dailyBudgetCents: 1500, days: 14 },
  ]);
  const [capDollars, setCapDollars] = useState(500);
  const [hardStop, setHardStop] = useState(true);

  /**
   * The real ledger, rather than a slider.
   *
   * This screen used to take month-to-date spend from a number input, which
   * made it a planner wearing a report's clothes. It now reads what was
   * actually charged, what is committed, and whether anything is able to send
   * at all — because a month-to-date of zero means something very different
   * depending on that last answer.
   */
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  /**
   * Flights that exist, as opposed to plans being sketched above.
   *
   * The planner rows are arithmetic — free to add, change and delete. A
   * flight is a decision: it has a brief, a status, and money attached to it.
   * The two are kept visually and mechanically separate so the step from
   * "what would this cost" to "we are doing this" is a deliberate click.
   */
  const [flights, setFlights] = useState<FlightRow[]>([]);
  const [brief, setBrief] = useState<{ id: string; platform: { name: string; url: string }; text: string; statement: string } | null>(null);
  const [flightMsg, setFlightMsg] = useState<string | null>(null);

  const loadFlights = () =>
    fetch('/api/flights')
      .then((r) => r.json())
      .then((d) => d.ok && setFlights(d.flights))
      .catch(() => {});
  useEffect(() => {
    void loadFlights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitPlan = async (plan: AdPlan) => {
    setFlightMsg(null);
    // The destination is the one field that cannot be a placeholder: it
    // carries the UTM parameters that credit results back, and a brief with
    // a dummy URL produces a flight whose conversions belong to nobody.
    const destinationUrl = window.prompt('Where should a click land? (your page for this offer)', 'https://');
    if (!destinationUrl) return;
    const objective = window.prompt('What should this flight cause?', 'Bring in local customers') ?? 'Bring in local customers';
    const audience = window.prompt('Who should it reach?', 'People near the business, 25 and up') ?? 'People near the business, 25 and up';
    const r = await fetch('/api/flights', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channel: plan.channel,
        dailyCents: plan.dailyBudgetCents,
        days: plan.days,
        objective,
        audience,
        body: 'Draft the ad text in the composer, or write it in the ads manager — the brief carries everything else.',
        destinationUrl,
        campaignId: flightCampaignId || undefined,
      }),
    }).then((x) => x.json());
    if (!r.ok) {
      setFlightMsg(r.problems?.[0]?.message ?? r.reason ?? 'Could not plan the flight.');
      return;
    }
    setBrief({ id: r.flight.id, ...r.brief });
    void loadFlights();
  };

  const act = async (id: string, payload: Record<string, unknown>) => {
    setFlightMsg(null);
    const r = await fetch(`/api/flights/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((x) => x.json());
    if (!r.ok) setFlightMsg(r.reason ?? 'That did not work.');
    if (r.brief) setBrief({ id, ...r.brief });
    void loadFlights();
    return r;
  };

  useEffect(() => {
    let live = true;
    fetch('/api/spend')
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (d.ok) setLedger(d);
        else setLedgerError(d.reason ?? 'Could not read the ledger.');
      })
      .catch(() => live && setLedgerError('Could not reach the server.'));
    return () => {
      live = false;
    };
  }, []);

  const adProjection = useMemo(() => projectAds(plans), [plans]);

  const chargedCents = ledger?.chargedCents ?? 0;
  const queuedCents = ledger?.committedCents ?? 0;
  const queuedMessages = ledger?.committedMessages ?? 0;
  const nothingCanSend =
    ledger != null && !ledger.sending.email.ready && !ledger.sending.sms.ready;

  const now = new Date();
  const forecast = useMemo(
    () =>
      forecastMonth({
        spentCents: chargedCents,
        // Queued messages plus planned flights. Both are money promised and
        // not yet moved, which is exactly what this field means.
        committedCents: queuedCents + adProjection.exactCents,
        now,
      }),
    // `now` is stable within a render pass; the forecast only needs the date.
    [chargedCents, queuedCents, adProjection.exactCents, now]
  );

  const capCents = capDollars * 100;
  const over = forecast.projectedMonthEndCents > capCents;
  const pct = capCents > 0 ? Math.round((forecast.projectedMonthEndCents / capCents) * 100) : 0;
  /** Bar width represents this much money, so an overshoot stays legible. */
  const scale = Math.max(1, capCents, forecast.projectedMonthEndCents);

  const update = (i: number, patch: Partial<AdPlan>) =>
    setPlans((ps) => ps.map((p, n) => (n === i ? { ...p, ...patch } : p)));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Spend</h1>
          <div className="sub">
            Every cost in one place, split by whether it is a fact or a forecast. Money you have committed is exact.
            What it buys is a range, and it stays a range.
          </div>
        </div>
        <CollapseAll prefix="spend." count={4} />
      </div>

      {/* ------------------------------------------------------ the month */}
      <Collapsible
        id="spend.month"
        title="The month so far"
        defaultOpen
        summary={`${amount(chargedCents)} charged · ${queuedMessages.toLocaleString('en-US')} messages committed`}
      >
      {nothingCanSend && (
        <div className="notice warn" style={{ marginBottom: 14 }}>
          <span>
            <strong>Nothing can send yet.</strong> No email or text service is connected, so queued messages are
            being held and no message cost has been charged. The figures below are real — they are simply real
            zeroes.
          </span>
        </div>
      )}
      {ledgerError && (
        <div className="notice warn" style={{ marginBottom: 14 }}>
          <span>
            <strong>Could not read the ledger.</strong> {ledgerError} The planner below still works; the
            month-to-date figures are unavailable rather than guessed.
          </span>
        </div>
      )}

      {/* Charged, committed and projected as three tiles, never as one.
          The first is a fact, the second is a promise, and the third is
          arithmetic on both — and the original bug on this screen was that
          the first two were the same number. */}
      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="card stat-tile">
          <div className="st-label">Charged this month</div>
          <div className="st-value">{amount(chargedCents)}</div>
          <div className="st-delta flat">
            {ledger ? `day ${forecast.dayOfMonth} of ${forecast.daysInMonth} — confirmed by a provider` : 'reading…'}
          </div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Committed, not yet charged</div>
          <div className="st-value">{amount(forecast.committedCents)}</div>
          <div className="st-delta flat">
            {queuedMessages > 0
              ? `${queuedMessages.toLocaleString('en-US')} queued message${queuedMessages === 1 ? '' : 's'}, plus planned flights`
              : 'planned ad flights'}
          </div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Month ends at</div>
          <div className={`st-value ${over ? 'bad' : ''}`}>{amount(forecast.projectedMonthEndCents)}</div>
          <div className="st-delta flat">{over ? `${money(forecast.projectedMonthEndCents - capCents)} over cap` : 'inside cap'}</div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="send-section-head">
          <h3>Monthly cap</h3>
          <span className="card-sub">{forecast.basis}</span>
        </div>

        {/* The bar is scaled to whichever is larger, the cap or the
            projection — not to the cap alone.
            Scaling to the cap meant that once the projection passed it the
            fill clamped to 100% and stayed there, so $600 and $6,000 looked
            identical: the bar stopped carrying information at exactly the
            moment it mattered. Here the cap is a line you can watch the
            projection cross, and overshooting it is visible as overshoot. */}
        <div className="cap-bar" aria-hidden>
          <span className="cap-spent" style={{ width: `${(forecast.spentCents / scale) * 100}%` }} />
          <span
            className={`cap-fill ${over ? 'over' : ''}`}
            style={{ width: `${(forecast.projectedMonthEndCents / scale) * 100}%` }}
          />
          <span className="cap-line" style={{ left: `${(capCents / scale) * 100}%` }} />
        </div>
        <div className="cap-legend">
          <span>
            <b>{amount(forecast.spentCents)}</b> spent
          </span>
          <span>
            <b>{amount(forecast.projectedMonthEndCents)}</b> projected {over ? `(${pct}% of cap)` : ''}
          </span>
          <span>
            <b>{amount(capCents)}</b> cap
          </span>
        </div>

        <div className="send-toggles" style={{ marginTop: 14 }}>
          <label>
            Cap
            <input
              type="number"
              className="input"
              style={{ width: 110, marginLeft: 8 }}
              value={capDollars}
              min={0}
              step={50}
              onChange={(e) => setCapDollars(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
          <label>
            <input type="checkbox" checked={hardStop} onChange={(e) => setHardStop(e.target.checked)} />
            Stop sends at the cap
          </label>
        </div>

        <p className="cost-note" style={{ padding: '10px 0 0', border: 0 }}>
          {hardStop
            ? 'Sends are refused once the cap is reached. A budget that only warns is a budget that gets exceeded — the warning always arrives while somebody is busy pressing send.'
            : 'You will be warned at the cap but nothing is blocked. Fine when one person spends; risky when several do.'}
        </p>
      </div>

      </Collapsible>

      {/* ------------------------------------------------------- planner */}
      <Collapsible
        id="spend.planner"
        title="Plan a flight"
        defaultOpen
        summary={`${plans.length} ${plans.length === 1 ? 'plan' : 'plans'} sketched · ${amount(adProjection.exactCents)} if committed`}
      >
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="send-section-head">
          <h3>Plan an ad flight</h3>
          <span className="card-sub">
            The spend is exact — you set it. What it buys is the estimate, and the width of the range is the honest
            part.
          </span>
        </div>

        <div className="flights">
          {plans.map((p, i) => {
            const rate = AD_RATES[p.channel];
            const meta = CHANNEL_META[p.channel];
            const outcome = adProjection.outcomes[i];
            const under = rate && p.dailyBudgetCents < rate.minDailyCents;
            return (
              <div key={i} className="flight">
                <div className="fl-head">
                  <span className="fl-dot" style={{ background: meta?.color ?? 'var(--muted)' }} />
                  <select
                    className="select fl-channel"
                    value={p.channel}
                    onChange={(e) => update(i, { channel: e.target.value as Channel })}
                  >
                    {PLANNABLE.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_META[c]?.label ?? c}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => void commitPlan(p)}
                  >
                    Plan this flight
                  </button>
                  {plans.length > 1 && (
                    <button
                      type="button"
                      className="btn ghost fl-remove"
                      onClick={() => setPlans((ps) => ps.filter((_, n) => n !== i))}
                      aria-label={`Remove ${CHANNEL_META[p.channel]?.label ?? p.channel} flight`}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="fl-controls">
                  <label>
                    <span>
                      Daily budget <b>{money(p.dailyBudgetCents)}</b>
                    </span>
                    <input
                      type="range"
                      min={100}
                      max={20000}
                      step={100}
                      value={p.dailyBudgetCents}
                      onChange={(e) => update(i, { dailyBudgetCents: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    <span>
                      Run for <b>{p.days} days</b>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={60}
                      value={p.days}
                      onChange={(e) => update(i, { days: Number(e.target.value) })}
                    />
                  </label>
                </div>

                <div className="fl-result">
                  <div className="flr-cost">
                    <span className="flr-label">Costs</span>
                    <span className="flr-value">{money(p.dailyBudgetCents * p.days)}</span>
                    <span className="flr-basis">exact — you set it</span>
                  </div>
                  <div className="flr-outcome">
                    <span className="flr-label">Buys about</span>
                    <span className="flr-value estimate">
                      {outcome
                        ? `${outcome.low.toLocaleString('en-US')}–${outcome.high.toLocaleString('en-US')}`
                        : '—'}
                    </span>
                    <span className="flr-basis">{outcome ? outcome.basis : 'no rate for this channel'}</span>
                  </div>
                </div>

                {under && rate && (
                  <p className="fl-warn">
                    Below {money(rate.minDailyCents)}/day this platform cannot leave its learning phase. The money
                    still leaves your account — it just buys worse placements. Underfunding is the cheapest way to
                    waste an ad budget.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="btn"
          style={{ marginTop: 10 }}
          onClick={() => setPlans((ps) => [...ps, { channel: 'instagram', dailyBudgetCents: 1000, days: 14 }])}
        >
          + Add a channel
        </button>

        <div className="flight-total">
          <div>
            <span className="ft-label">These flights cost</span>
            <span className="ft-value">{money(adProjection.exactCents)}</span>
          </div>
          <p className="ft-note">
            That figure is not a forecast. A daily budget is a instruction to the platform, and it spends it. The
            forecast is everything underneath it — how many people saw the ad, and whether any of them cared.
          </p>
        </div>

        {adProjection.notes.map((n, i) => (
          <p key={i} className="cost-note" style={{ padding: '9px 0 0', border: 0 }}>
            {n}
          </p>
        ))}
      </div>

      </Collapsible>

      {/* ------------------------------------------------------- flights */}
      <Collapsible
        id="spend.flights"
        title="Flights"
        defaultOpen
        summary={flights.length === 0 ? 'none planned yet' : `${flights.length} ${flights.length === 1 ? 'flight' : 'flights'}`}
      >
      {(flights.length > 0 || brief || flightMsg) && (
        <div className="card card-pad" style={{ marginBottom: 14 }} data-testid="flights-panel">
          <h2 style={{ marginTop: 0 }}>Flights</h2>
          <p className="sub" style={{ maxWidth: '70ch' }}>
            Perception plans the flight and keeps the books. The buy happens in the platform&rsquo;s own ads
            manager, from the brief — we do not launch ads on your behalf. Spend you enter mid-flight is an
            estimate until the invoice settles it.
          </p>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: 'var(--ink-2)', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              New flights belong to
              <select className="select" value={flightCampaignId} onChange={(e) => setFlightCampaignId(e.target.value)}>
                <option value="">no campaign</option>
                {visibleCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          </div>
          {flightMsg && <div className="notice warn" style={{ marginBottom: 10 }}>{flightMsg}</div>}

          {flights.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Status</th>
                    <th className="num">Budget</th>
                    <th className="num">Should buy</th>
                    <th className="num">Estimated</th>
                    <th className="num">Settled</th>
                    <th className="num">Results</th>
                    <th className="num">Cost / result</th>
                    <th aria-label="actions" />
                  </tr>
                </thead>
                <tbody>
                  {flights.map((f) => (
                    <tr key={f.id}>
                      <td>{CHANNEL_META[f.channel as Channel]?.label ?? f.channel}</td>
                      <td>
                        <span className={`chip ${f.status === 'settled' ? 'good' : ''}`}>
                          {f.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="num">
                        {money(f.dailyCents)}/day × {f.days}
                      </td>
                      <td className="num">
                        {f.estImpressionsLow.toLocaleString('en-US')}–{f.estImpressionsHigh.toLocaleString('en-US')}
                      </td>
                      <td className="num" style={{ color: 'var(--muted)', fontStyle: f.estimatedCents ? 'italic' : undefined }}>
                        {f.estimatedCents ? `~${amount(f.estimatedCents)}` : '—'}
                      </td>
                      <td className="num">{f.settledCents != null ? amount(f.settledCents) : f.exactCents ? amount(f.exactCents) : '—'}</td>
                      <td className="num">
                        {f.results && f.results.conversions > 0
                          ? `${f.results.conversions}${f.results.revenueCents > 0 ? ` · ${amount(f.results.revenueCents)}` : ''}`
                          : '—'}
                      </td>
                      <td className="num">
                        {f.results?.costPerResultCents != null ? (
                          <PriceTag
                            kind={f.results.certainty === 'estimated' ? 'estimated' : 'exact'}
                            cents={f.results.costPerResultCents}
                            title={
                              f.results.certainty === 'estimated'
                                ? 'Based on dashboard-reported spend. Settles with the invoice.'
                                : 'Settled invoice divided by measured results.'
                            }
                          />
                        ) : (
                          <span title="Appears once the flight has at least one measured result.">—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button type="button" className="btn ghost" onClick={() => void act(f.id, { action: 'handoff' })}>
                            Brief
                          </button>
                          {f.status !== 'settled' && (
                            <>
                              <button
                                type="button"
                                className="btn ghost"
                                onClick={() => {
                                  const v = window.prompt('Spend the platform reports so far, in dollars:');
                                  if (v == null) return;
                                  const period = new Date().toISOString().slice(0, 10);
                                  void act(f.id, { action: 'spend', cents: Math.round(Number(v) * 100), period });
                                }}
                              >
                                Enter spend
                              </button>
                              <button
                                type="button"
                                className="btn ghost"
                                onClick={() => {
                                  const v = window.prompt('Invoice total, in dollars:');
                                  if (v == null) return;
                                  void act(f.id, { action: 'settle', invoiceCents: Math.round(Number(v) * 100) });
                                }}
                              >
                                Settle
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {brief && (
            <div className="card card-pad" style={{ marginTop: 12, background: 'var(--surface-2, var(--bg))' }} data-testid="flight-brief">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong>The brief</strong>
                {brief.platform.url && (
                  <a className="btn" href={brief.platform.url} target="_blank" rel="noreferrer">
                    Open {brief.platform.name}
                  </a>
                )}
                <button type="button" className="btn ghost" onClick={() => void navigator.clipboard.writeText(brief.text)}>
                  Copy brief
                </button>
                <button type="button" className="btn ghost" onClick={() => setBrief(null)} aria-label="Close brief">
                  ✕
                </button>
              </div>
              <p className="sub" style={{ margin: '8px 0' }}>{brief.statement}</p>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.5, margin: 0, fontFamily: 'inherit' }}>{brief.text}</pre>
            </div>
          )}
        </div>
      )}

      </Collapsible>

      {/* ------------------------------------------------------ rate card */}
      <Collapsible id="spend.ratecard" title="What each channel costs" defaultOpen={false} summary="rates for every channel — always ranges, never midpoints">
      <div className="card card-pad">
        <div className="send-section-head">
          <h3>What everything costs</h3>
          <span className="card-sub">Defaults you should replace with whatever you actually negotiated.</span>
        </div>

        <div className="rate-grid">
          <section>
            <h4>Email — per send</h4>
            <table className="table compact">
              <tbody>
                {Object.values(EMAIL_RATES).map((r) => (
                  <tr key={r.provider}>
                    <td>{r.provider}</td>
                    <td className="num">{money(r.per1000Cents)}/1,000</td>
                    <td className="muted">{r.freeMonthly.toLocaleString('en-US')} free/mo</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h4>Text — per segment</h4>
            <table className="table compact">
              <tbody>
                {Object.entries(SMS_RATES).map(([code, r]) => (
                  <tr key={code}>
                    <td>{r.country}</td>
                    <td className="num">{money(r.perSegmentCents)}</td>
                    <td className="muted">
                      {r.perInboundCents > 0 ? `${money(r.perInboundCents)} inbound` : 'inbound free'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="rate-foot">
              A segment is 160 characters — or 70 if the message contains one emoji or one curly apostrophe. The
              composer counts it for you.
            </p>
          </section>

          <section>
            <h4>Text — before the first message</h4>
            <table className="table compact">
              <tbody>
                {(FIXED_COSTS.sms ?? []).map((f) => (
                  <tr key={f.id}>
                    <td>{f.label}</td>
                    <td className="num">{money(f.cents)}</td>
                    <td className="muted">{f.cadence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="rate-foot">
              These are the costs that make &ldquo;texting is cheap&rdquo; false for a small list. On 400 contacts they
              are roughly four times the message cost.
            </p>
          </section>

          <section>
            <h4>Ads — the auction</h4>
            <table className="table compact">
              <tbody>
                {Object.values(AD_RATES).map((r) => (
                  <tr key={r.channel}>
                    <td>{CHANNEL_META[r.channel]?.label ?? r.channel}</td>
                    <td className="num">{range(r)}</td>
                    <td className="muted">{r.model === 'cpm' ? 'per 1,000 views' : 'per click'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="rate-foot">
              Ranges, never midpoints. The same ad clears at $7 and $25 in different weeks; a single number here would
              be confidently wrong for almost everybody.
            </p>
          </section>
        </div>
      </div>
      </Collapsible>
    </div>
  );
}
