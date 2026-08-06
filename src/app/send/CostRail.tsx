'use client';

import { money } from '@/lib/pricing';
import type { Projection } from '@/lib/projection';

/**
 * The price, pinned to the side of the screen.
 *
 * Three rules this component exists to enforce, all of which are about what
 * it refuses to do:
 *
 * 1. **It never shows one total.** Exact money and estimated money live in
 *    different blocks with different weights, because adding them produces a
 *    figure that is precise about the guess and vague about the fact.
 * 2. **It never hides a setup cost inside a per-message rate.** The $44
 *    registration is a line, at full size, above the $4.20 of messages.
 * 3. **It shows the arithmetic.** Every line carries the multiplication that
 *    produced it, so a number that looks wrong can be argued with instead of
 *    just distrusted.
 */
export function CostRail({
  projection,
  recipients,
  mode,
  blockedByQuietHours,
  onSend,
  sending,
  result,
}: {
  projection: Projection;
  recipients: number;
  mode: 'email' | 'sms';
  blockedByQuietHours: boolean;
  onSend: () => void;
  sending: boolean;
  result: { ok: boolean; message: string } | null;
}) {
  const messages = projection.items.filter((i) => i.kind === 'message');
  const fixed = projection.items.filter((i) => i.kind === 'fixed');
  const recurring = fixed.filter((i) => i.cadence === 'monthly').reduce((s, i) => s + i.cents, 0);
  const onceOnly = fixed.filter((i) => i.cadence !== 'monthly').reduce((s, i) => s + i.cents, 0);
  const messageCents = messages.filter((i) => i.certainty === 'exact').reduce((s, i) => s + i.cents, 0);
  const perPerson = recipients > 0 ? messageCents / recipients : 0;
  const blocked = projection.blockers.length > 0 || blockedByQuietHours;

  return (
    <aside className="cost-rail">
      <div className="card cost-card">
        <div className="cost-head">
          <span className="ch-label">This send costs</span>
          <span className="ch-total">{money(projection.exactCents)}</span>
          <span className="ch-basis">
            {recipients === 0
              ? 'Nobody is reachable yet.'
              : messageCents === 0 && projection.exactCents === 0
                ? `${recipients.toLocaleString('en-US')} recipients, inside the free allowance.`
                : `${recipients.toLocaleString('en-US')} recipients · ${money(Math.round(perPerson * 100) / 100)} each`}
          </span>
        </div>

        {messages.length > 0 && (
          <div className="cost-group">
            <div className="cg-label">Messages</div>
            {messages.map((i) => (
              <div key={i.id} className={`cost-line ${i.certainty}`}>
                <div className="cl-top">
                  <span className="cl-label">{i.label}</span>
                  <span className="cl-cents">
                    {i.certainty === 'estimated' && <span className="cl-approx">≈</span>}
                    {money(i.cents)}
                  </span>
                </div>
                <div className="cl-detail">{i.detail}</div>
              </div>
            ))}
          </div>
        )}

        {fixed.length > 0 && (
          <div className="cost-group">
            <div className="cg-label">
              Setup
              <span className="cg-note">
                {onceOnly > 0 && recurring > 0
                  ? `${money(onceOnly)} once, ${money(recurring)}/month`
                  : recurring > 0
                    ? `${money(recurring)}/month`
                    : `${money(onceOnly)} once`}
              </span>
            </div>
            {fixed.map((i) => (
              <div key={i.id} className="cost-line fixed">
                <div className="cl-top">
                  <span className="cl-label">
                    {i.label}
                    {i.cadence === 'monthly' && <span className="cl-cadence">monthly</span>}
                  </span>
                  <span className="cl-cents">{money(i.cents)}</span>
                </div>
                <div className="cl-detail">{i.detail}</div>
              </div>
            ))}
            {/* The projection already carries a note about setup dominating,
                complete with the break-even list size. Repeating the point
                here made the rail say the same thing three times, which reads
                as nagging rather than as information. */}
          </div>
        )}

        {projection.outcomes.length > 0 && (
          <div className="cost-group">
            <div className="cg-label">
              What it buys<span className="cg-note">estimated</span>
            </div>
            {projection.outcomes.map((o, n) => (
              <div key={n} className="cost-line estimated">
                <div className="cl-top">
                  <span className="cl-label">{o.metric === 'impressions' ? 'Impressions' : 'Clicks'}</span>
                  <span className="cl-cents">
                    {o.low.toLocaleString('en-US')}–{o.high.toLocaleString('en-US')}
                  </span>
                </div>
                <div className="cl-detail">{o.basis}</div>
              </div>
            ))}
          </div>
        )}

        {projection.blockers.length > 0 && (
          <div className="cost-group blockers">
            <div className="cg-label">Before this can send</div>
            {projection.blockers.map((b) => {
              // A blocker that corresponds to a line already shown above
              // repeats its explanation verbatim. Say it once: up there it is
              // a price, down here it is a to-do, and the to-do only needs the
              // name.
              const alreadyExplained = projection.items.some((i) => i.id === b.id);
              return (
                <div key={b.id} className={`blocker ${alreadyExplained ? 'terse' : ''}`}>
                  <div className="bl-label">{b.label}</div>
                  {!alreadyExplained && <div className="bl-fix">{b.fix}</div>}
                </div>
              );
            })}
          </div>
        )}

        {projection.notes.map((n, i) => (
          <p key={i} className="cost-note">
            {n}
          </p>
        ))}

        {/* The button carries the price. "Send" alone asks someone to confirm
            a number they have to look away to find; "Send to 308 for $61.93"
            puts the whole decision under the cursor. */}
        <button className="btn primary cost-send" disabled={blocked || recipients === 0 || sending} onClick={onSend}>
          {sending
            ? 'Sending…'
            : blocked
              ? 'Cannot send yet'
              : recipients === 0
                ? 'Nobody to send to'
                : `Send to ${recipients.toLocaleString('en-US')} for ${money(projection.exactCents)}`}
        </button>

        {result && (
          <p className={`send-result ${result.ok ? 'good' : 'bad'}`} role="status">
            {result.message}
          </p>
        )}

        <p className="cost-fine">
          {mode === 'sms'
            ? 'Charged per segment on delivery. Replies are billed too.'
            : 'Charged per send. Bounces are charged; opens are not.'}
        </p>
      </div>
    </aside>
  );
}
