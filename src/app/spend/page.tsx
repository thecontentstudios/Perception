'use client';

import { useMemo, useState } from 'react';
import { AD_RATES, EMAIL_RATES, FIXED_COSTS, SMS_RATES, money, range } from '@/lib/pricing';
import { forecastMonth, projectAds, type AdPlan } from '@/lib/projection';
import { CHANNEL_META } from '@/lib/channels';
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

export default function SpendPage() {
  // Ad flights being considered. Starts with one so the planner is usable on
  // arrival rather than presenting an empty state and an "Add" button.
  const [plans, setPlans] = useState<AdPlan[]>([
    { channel: 'facebook', dailyBudgetCents: 1500, days: 14 },
  ]);
  const [capDollars, setCapDollars] = useState(500);
  const [hardStop, setHardStop] = useState(true);
  const [spentDollars, setSpentDollars] = useState(212);

  const adProjection = useMemo(() => projectAds(plans), [plans]);

  const now = new Date();
  const forecast = useMemo(
    () =>
      forecastMonth({
        spentCents: spentDollars * 100,
        committedCents: adProjection.exactCents,
        now,
      }),
    // `now` is stable within a render pass; the forecast only needs the date.
    [spentDollars, adProjection.exactCents, now]
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
      </div>

      {/* ------------------------------------------------------ the month */}
      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="card stat-tile">
          <div className="st-label">Spent this month</div>
          <div className="st-value">{money(forecast.spentCents)}</div>
          <div className="st-delta flat">
            day {forecast.dayOfMonth} of {forecast.daysInMonth}
          </div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Committed, not yet charged</div>
          <div className="st-value">{money(forecast.committedCents)}</div>
          <div className="st-delta flat">scheduled sends and planned ad flights</div>
        </div>
        <div className="card stat-tile">
          <div className="st-label">Month ends at</div>
          <div className={`st-value ${over ? 'bad' : ''}`}>{money(forecast.projectedMonthEndCents)}</div>
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
            <b>{money(forecast.spentCents)}</b> spent
          </span>
          <span>
            <b>{money(forecast.projectedMonthEndCents)}</b> projected {over ? `(${pct}% of cap)` : ''}
          </span>
          <span>
            <b>{money(capCents)}</b> cap
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
            Spent so far
            <input
              type="number"
              className="input"
              style={{ width: 110, marginLeft: 8 }}
              value={spentDollars}
              min={0}
              onChange={(e) => setSpentDollars(Math.max(0, Number(e.target.value) || 0))}
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

      {/* ------------------------------------------------------- planner */}
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

      {/* ------------------------------------------------------ rate card */}
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
    </div>
  );
}
