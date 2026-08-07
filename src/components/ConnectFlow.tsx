'use client';

import { useEffect, useState } from 'react';
import { CHANNEL_META, ChannelIcon } from '@/lib/channels';
import { connectSpecFor } from '@/lib/connect-specs';
import { BRANDS, useApp } from '@/lib/store';
import type { Channel } from '@/lib/types';

/**
 * The account-connection pipeline, made explicit.
 *
 * Four steps, because each one is a place real setups fail:
 *   1. Prerequisites — "your IG must be a professional account linked to a Page"
 *   2. Permissions   — every scope, with a plain-English reason
 *   3. Authorize     — the handoff to the platform
 *   4. Destinations  — which Pages/accounts/locations, mapped to which business
 *
 * Step 4 is the one most tools skip, and it's why cross-posting goes wrong:
 * one authorization returns several destinations belonging to different
 * businesses, and nothing can publish correctly until that mapping exists.
 */
export function ConnectFlow({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { state, dispatch, destinationsForAccount } = useApp();
  const spec = connectSpecFor(channel);
  const account = state.accounts.find((a) => a.channel === channel);

  const [step, setStep] = useState(0);
  const [optional, setOptional] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const discovered = account ? destinationsForAccount(account.id) : [];

  // Seed the selection once destinations come back from authorization.
  useEffect(() => {
    if (step !== 3 || discovered.length === 0) return;
    setChosen((prev) =>
      prev.size > 0 ? prev : new Set(discovered.filter((d) => d.issues.length === 0).map((d) => d.id))
    );
    setMapping((prev) =>
      Object.keys(prev).length > 0 ? prev : Object.fromEntries(discovered.map((d) => [d.id, d.brandId ?? '']))
    );
  }, [step, discovered]);

  if (!spec || !account) return null;

  const finish = () => {
    for (const [destId, brandId] of Object.entries(mapping)) {
      dispatch({ type: 'mapDestination', destinationId: destId, brandId: brandId || null });
    }
    dispatch({ type: 'connectAccount', accountId: account.id, destinationIds: [...chosen] });
    onClose();
  };

  const STEPS = ['Before you start', 'Permissions', 'Authorize', 'Choose destinations'];

  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden />
      <aside className="side-panel" aria-label={`Connect ${CHANNEL_META[channel].label}`} style={{ width: 'min(560px, 96vw)' }}>
        <div className="sp-head">
          <ChannelIcon channel={channel} size={22} />
          <div>
            <h3 style={{ fontSize: 14.5 }}>Connect {CHANNEL_META[channel].label}</h3>
            <div className="card-sub">
              Step {step + 1} of {STEPS.length} · {STEPS[step]}
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto' }}>
            ✕
          </button>
        </div>

        <div className="sp-body">
          {step === 0 && (
            <>
              <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
                You&apos;ll need these before {CHANNEL_META[channel].label} will let us publish:
              </p>
              <ul style={{ paddingLeft: 18, display: 'grid', gap: 7, fontSize: 12.5 }}>
                {spec.prerequisites.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {spec.caveat && (
                <div className="warning-row warn" style={{ marginTop: 12 }}>
                  <div>
                    <div style={{ fontWeight: 650 }}>Worth knowing</div>
                    <div className="fix">{spec.caveat}</div>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
                We ask for the least we can. Here is every permission and why it&apos;s needed — these
                are the same names you&apos;ll see on {CHANNEL_META[channel].label}&apos;s own consent screen.
              </p>
              <div style={{ display: 'grid', gap: 8 }}>
                {spec.scopes.map((s) => (
                  <div key={s.scope} className="card card-pad" style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <code className="mono">{s.scope}</code>
                      {s.required ? (
                        <span className="pill neutral">required</span>
                      ) : (
                        <label style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5 }}>
                          <input
                            type="checkbox"
                            checked={!optional.has(s.scope)}
                            onChange={() => {
                              const next = new Set(optional);
                              if (next.has(s.scope)) next.delete(s.scope);
                              else next.add(s.scope);
                              setOptional(next);
                            }}
                          />
                          include
                        </label>
                      )}
                    </div>
                    <div style={{ color: 'var(--ink-2)', fontSize: 12, marginTop: 4 }}>{s.why}</div>
                  </div>
                ))}
              </div>
              {optional.size > 0 && (
                <div className="notice info" style={{ marginTop: 10 }}>
                  Declining optional permissions is fine — publishing still works. You can grant them later
                  without reconnecting everything.
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="notice info" style={{ display: 'block', marginBottom: 12 }}>
                <div style={{ fontWeight: 650, marginBottom: 4 }}>What happens next</div>
                We send you to {CHANNEL_META[channel].label} to approve. You come back here with a token we
                encrypt at rest and never show to anyone — including you. {spec.afterAuth}
              </div>
              <div className="card card-pad" style={{ textAlign: 'center' }}>
                <ChannelIcon channel={channel} size={36} />
                <div style={{ fontWeight: 650, margin: '10px 0 4px' }}>
                  Continue to {CHANNEL_META[channel].label}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 11.5, marginBottom: 12 }}>
                  Requesting {spec.scopes.filter((s) => s.required || !optional.has(s.scope)).length} permissions
                </div>
                <button
                  className="btn primary"
                  onClick={() => {
                    // Simulated redirect + callback. Coming back from the
                    // platform is what reveals the destinations — this is the
                    // listDestinations() call in the connector contract.
                    dispatch({ type: 'discoverDestinations', accountId: account.id, channel });
                    setStep(3);
                  }}
                >
                  Authorize
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
                Authorized. We found {discovered.length} {discovered.length === 1 ? spec.destinationNoun : spec.destinationNounPlural}.
                Choose which to publish to, and tell us which business each belongs to.
              </p>
              <div style={{ display: 'grid', gap: 7 }}>
                {discovered.map((d) => {
                  const on = chosen.has(d.id);
                  const blocked = d.issues.length > 0;
                  return (
                    <div key={d.id} className={`dest-row ${on ? 'on' : ''} ${blocked ? 'blocked' : ''}`} style={{ cursor: 'default', flexWrap: 'wrap' }}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={blocked}
                        aria-label={`Enable ${d.name}`}
                        onChange={() => {
                          const next = new Set(chosen);
                          if (next.has(d.id)) next.delete(d.id);
                          else next.add(d.id);
                          setChosen(next);
                        }}
                      />
                      <span style={{ flex: 1, minWidth: 140 }}>
                        <span style={{ fontWeight: 600, fontSize: 12.5, display: 'block' }}>{d.name}</span>
                        <span style={{ color: 'var(--muted)', fontSize: 11 }}>{d.kind}</span>
                      </span>
                      <select
                        className="select"
                        aria-label={`Business for ${d.name}`}
                        value={mapping[d.id] ?? ''}
                        onChange={(e) => setMapping({ ...mapping, [d.id]: e.target.value })}
                      >
                        <option value="">Unassigned</option>
                        {BRANDS.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                      {blocked && (
                        <div style={{ flexBasis: '100%', color: 'var(--st-critical)', fontSize: 11.5 }}>
                          {d.issues[0]}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="notice info" style={{ marginTop: 12 }}>
                Unassigned destinations won&apos;t appear when you post for a specific business — that mapping
                is what keeps the landscaper&apos;s posts off the recording studio&apos;s Page.
              </div>
            </>
          )}
        </div>

        <div className="sp-foot">
          {step > 0 && step !== 3 && (
            <button className="btn" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < 2 && (
            <button className="btn primary" onClick={() => setStep(step + 1)}>
              Continue
            </button>
          )}
          {step === 3 && (
            <button className="btn primary" onClick={finish} disabled={chosen.size === 0}>
              Finish — enable {chosen.size} {chosen.size === 1 ? spec.destinationNoun : spec.destinationNounPlural}
            </button>
          )}
          <button className="btn ghost" onClick={onClose} style={{ marginLeft: 'auto' }}>
            Cancel
          </button>
        </div>
      </aside>
    </>
  );
}
