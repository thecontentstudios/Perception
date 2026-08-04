'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlatformPreview } from '@/components/PlatformPreview';
import { StatusPill, MediaThumb, WarningsList } from '@/components/ui';
import { ALL_CHANNELS, CHANNEL_META, ChannelIcon } from '@/lib/channels';
import { addDays, fmtDateTime, fmtShort } from '@/lib/dates';
import { generateCampaign, type ComposerInput, type GeneratedCampaign } from '@/lib/generate';
import { preflight } from '@/lib/preflight';
import { BRANDS, TEMPLATES, TODAY, useApp } from '@/lib/store';
import { adapterFor } from '@/lib/connectors/registry';
import type { Channel, ChannelVariation } from '@/lib/types';

const STEPS = ['Define the outcome', 'Add source material', 'Generate', 'Review visually', 'Approve & schedule'];

/** Overrides survive regeneration by keying on what the slot is, not its generated id. */
function slotKey(v: ChannelVariation, itemTitle: string): string {
  return `${v.channel}|${v.format}|${itemTitle}`;
}

export default function CreatePage() {
  const { state, dispatch, itemById } = useApp();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<string | null>(null);

  // Step 1 — outcome
  const [brandId, setBrandId] = useState('b-green');
  const [templateId, setTemplateId] = useState<string | null>('t-land-seasonal');
  const [name, setName] = useState('Fall Cleanup Promotion — Round 2');
  const [promoting, setPromoting] = useState('Late-season fall cleanups: leaf removal, gutter clearing, and bed winterization before the first hard freeze.');
  const [action, setAction] = useState('Request a Quote');
  const [actionUrl, setActionUrl] = useState('https://greenscapenj.com/fall-cleanup');
  const [audience, setAudience] = useState('Homeowners within 25 miles of Maplewood');
  const [startDate, setStartDate] = useState(addDays(TODAY, 4));
  const [endDate, setEndDate] = useState(addDays(TODAY, 32));
  const [offer, setOffer] = useState('Free estimate');
  const [hasDeadline, setHasDeadline] = useState(true);

  // Step 2 — source material
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceNotes, setSourceNotes] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<Set<string>>(new Set());

  // Step 3 — channels + generation
  const [channels, setChannels] = useState<Set<Channel>>(new Set(['facebook', 'instagram', 'google_business', 'email', 'website']));
  const [generated, setGenerated] = useState<GeneratedCampaign | null>(null);
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());

  // Step 5 — plan choice
  const [plan, setPlan] = useState<'recommended' | 'manual' | 'template' | null>(null);

  const brand = BRANDS.find((b) => b.id === brandId)!;
  const brandTemplates = TEMPLATES.filter((t) => t.industry === brand.industry);
  const brandMedia = state.media.filter((m) => m.brandId === brandId);

  const input: ComposerInput = {
    brandId, templateId, name, promoting, action, actionUrl, audience,
    startDate, endDate, offer, hasDeadline,
    sourceNotes: [sourceUrl, sourceNotes].filter(Boolean),
    channels: [...channels],
    colorIndex: 4,
  };

  function runGenerate(nextInput: ComposerInput, keepOverrides: Map<string, string>) {
    const g = generateCampaign(nextInput);
    // Attach the media the owner picked in step 2, round-robin across slots.
    const picked = [...selectedMedia];
    if (picked.length > 0) {
      let i = 0;
      for (const v of g.variations) {
        if (v.format === 'landing_page' || v.format === 'banner' || v.format === 'sms') continue;
        v.mediaIds = [picked[i % picked.length]];
        i++;
      }
    }
    // Re-apply per-channel overrides across regenerations.
    for (const v of g.variations) {
      const item = g.items.find((it) => it.id === v.contentItemId);
      const o = keepOverrides.get(slotKey(v, item?.title ?? ''));
      if (o !== undefined) {
        v.body = o;
        v.overridden = true;
      }
    }
    setGenerated(g);
  }

  const genWarnings = useMemo(() => {
    if (!generated) return new Map<string, ReturnType<typeof preflight>>();
    const map = new Map<string, ReturnType<typeof preflight>>();
    for (const v of generated.variations) {
      map.set(
        v.id,
        preflight(v, {
          campaign: generated.campaign,
          assets: state.media.filter((m) => v.mediaIds.includes(m.id)),
          accounts: state.accounts,
          allVariations: [...state.variations, ...generated.variations],
          campaigns: [...state.campaigns, generated.campaign],
          today: TODAY,
        })
      );
    }
    return map;
  }, [generated, state]);

  const blockedCount = [...genWarnings.values()].filter((ws) => ws.some((w) => w.severity === 'block')).length;

  function finish() {
    if (!generated || !plan) return;
    if (plan === 'template') {
      setDone('Saved as a reusable template for ' + brand.name + '. You can start the next one from it in a single step.');
      return;
    }
    const statusFor = plan === 'recommended' ? ('scheduled' as const) : ('draft' as const);
    const campaign = { ...generated.campaign, status: plan === 'recommended' ? ('scheduled' as const) : ('draft' as const) };
    const variations = generated.variations.map((v) => ({ ...v, status: statusFor }));
    dispatch({
      type: 'addCampaign',
      campaign,
      items: generated.items,
      variations,
      auditDetail:
        plan === 'recommended'
          ? `Approved and scheduled ${variations.length} items across ${channels.size} channels.`
          : `Created with ${variations.length} draft items — dates to be picked on the calendar.`,
    });
    router.push('/calendar');
  }

  const step1Valid = name.trim() && promoting.trim() && action.trim() && startDate && endDate && startDate <= endDate;

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <div className="page-head">
        <div>
          <h1>Create a campaign</h1>
          <div className="sub">Write the message once. Perception adapts it to every channel, and nothing publishes without your approval.</div>
        </div>
      </div>

      <div className="steps">
        {STEPS.map((s, i) => (
          <button
            key={s}
            className={`step-chip ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`}
            style={{ cursor: i < step ? 'pointer' : 'default', border: undefined }}
            onClick={() => i < step && setStep(i)}
          >
            <span className="n">{i < step ? '✓' : i + 1}</span>
            {s}
          </button>
        ))}
      </div>

      {done && (
        <div className="card card-pad">
          <div className="notice success" style={{ marginBottom: 12 }}>
            ✓ {done}
          </div>
          <button className="btn" onClick={() => { setDone(null); setStep(0); setGenerated(null); setPlan(null); }}>
            Start another campaign
          </button>
        </div>
      )}

      {!done && step === 0 && (
        <div className="card card-pad step-panel" key="step-0">
          <div className="grid cols-2">
            <div>
              <div className="field">
                <label htmlFor="c-brand">Which business is this for?</label>
                <select id="c-brand" className="select" style={{ width: '100%' }} value={brandId}
                  onChange={(e) => { setBrandId(e.target.value); setTemplateId(null); setSelectedMedia(new Set()); }}>
                  {BRANDS.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Start from a template built for {brand.industry.replace('_', ' ')} businesses</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {brandTemplates.map((t) => (
                    <button key={t.id} className={`src-chip`} style={templateId === t.id ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-soft)' } : {}}
                      onClick={() => setTemplateId(templateId === t.id ? null : t.id)}>
                      {t.name}
                    </button>
                  ))}
                </div>
                {templateId && (
                  <span className="hint">
                    Recommended: {TEMPLATES.find((t) => t.id === templateId)!.recommendedChannels.map((c) => CHANNEL_META[c].label).join(', ')} ·{' '}
                    {TEMPLATES.find((t) => t.id === templateId)!.cadence}
                  </span>
                )}
              </div>
              <div className="field">
                <label htmlFor="c-name">Campaign name</label>
                <input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="c-promoting">What are you promoting?</label>
                <textarea id="c-promoting" className="textarea" value={promoting} onChange={(e) => setPromoting(e.target.value)} />
                <span className="hint">This becomes the shared campaign message — you write it once.</span>
              </div>
            </div>
            <div>
              <div className="field">
                <label htmlFor="c-action">What should customers do?</label>
                <input id="c-action" className="input" value={action} onChange={(e) => setAction(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="c-url">Where does that action happen? (link)</label>
                <input id="c-url" className="input" value={actionUrl} onChange={(e) => setActionUrl(e.target.value)} />
                <span className="hint">A tagged tracking link and QR code are created automatically.</span>
              </div>
              <div className="field">
                <label htmlFor="c-aud">Who should see it?</label>
                <input id="c-aud" className="input" value={audience} onChange={(e) => setAudience(e.target.value)} />
              </div>
              <div className="field">
                <label>When should it run?</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="date" className="input" style={{ width: 'auto' }} value={startDate} aria-label="Start date" onChange={(e) => setStartDate(e.target.value)} />
                  <span style={{ color: 'var(--muted)' }}>to</span>
                  <input type="date" className="input" style={{ width: 'auto' }} value={endDate} aria-label="End date" onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="c-offer">Is there an offer or deadline?</label>
                <input id="c-offer" className="input" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="e.g. Free estimate" />
                <span style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 4 }}>
                  <input id="c-deadline" type="checkbox" checked={hasDeadline} onChange={(e) => setHasDeadline(e.target.checked)} />
                  <label htmlFor="c-deadline" style={{ fontWeight: 500, fontSize: 12.5 }}>
                    The offer ends when the campaign ends ({fmtShort(endDate)}) — add last-call reminders
                  </label>
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn primary" disabled={!step1Valid} onClick={() => setStep(1)}>
              Continue
            </button>
          </div>
        </div>
      )}

      {!done && step === 1 && (
        <div className="card card-pad step-panel" key="step-1">
          <div className="grid cols-2">
            <div>
              <div className="field">
                <label htmlFor="c-src">Website or listing URL</label>
                <input id="c-src" className="input" placeholder={`https://${brand.website}/...`} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
                <span className="hint">Perception reads the page for services, tone, and details.</span>
              </div>
              <div className="field">
                <label htmlFor="c-notes">Anything else it should know?</label>
                <textarea id="c-notes" className="textarea" placeholder="Testimonials, event details, past posts that worked, brand rules…" value={sourceNotes} onChange={(e) => setSourceNotes(e.target.value)} />
              </div>
            </div>
            <div>
              <div className="field">
                <label>Photos & videos from your Media Library</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {brandMedia.map((m) => {
                    const on = selectedMedia.has(m.id);
                    return (
                      <button key={m.id} onClick={() => {
                        const next = new Set(selectedMedia);
                        if (on) next.delete(m.id); else next.add(m.id);
                        setSelectedMedia(next);
                      }}
                        style={{ border: on ? '2px solid var(--accent)' : '2px solid transparent', borderRadius: 9, padding: 2, background: 'none' }}
                        aria-pressed={on} title={m.name}>
                        <MediaThumb asset={m} size={64} />
                      </button>
                    );
                  })}
                </div>
                <span className="hint">{selectedMedia.size} selected — they’ll be placed across the drafts.</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn" onClick={() => setStep(0)}>Back</button>
            <button className="btn primary" onClick={() => setStep(2)}>Continue</button>
          </div>
        </div>
      )}

      {!done && step === 2 && (
        <div className="card card-pad step-panel" key="step-2">
          <div className="field">
            <label>Where should this campaign go?</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {ALL_CHANNELS.map((ch) => {
                const acct = state.accounts.find((a) => a.channel === ch);
                const connected = acct && acct.status === 'connected';
                const on = channels.has(ch);
                const planned = adapterFor(ch).capabilities.availability === 'planned' && !connected;
                return (
                  <button key={ch} className="src-chip"
                    style={on ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-soft)' } : planned ? { opacity: 0.55 } : {}}
                    onClick={() => {
                      const next = new Set(channels);
                      if (on) next.delete(ch); else next.add(ch);
                      setChannels(next);
                    }}>
                    <ChannelIcon channel={ch} size={15} />
                    {CHANNEL_META[ch].label}
                    {!connected && <span style={{ color: 'var(--st-serious)', fontWeight: 700 }}>{acct?.status === 'needs_reconnect' ? '· reconnect' : '· not connected'}</span>}
                  </button>
                );
              })}
            </div>
            <span className="hint">Channels that aren’t connected can still be planned — the checks will flag them before anything publishes.</span>
          </div>
          <div className="divider" />
          {!generated ? (
            <div style={{ textAlign: 'center', padding: '18px 0 8px' }}>
              <button className="btn primary" onClick={() => runGenerate(input, overrides)}>
                ✨ Generate the campaign
              </button>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
                Creates drafts only. Nothing is published or scheduled without your explicit approval.
              </div>
            </div>
          ) : (
            <>
              <div className="notice success" style={{ marginBottom: 12 }}>
                ✓ Generated {generated.variations.length} drafts across {channels.size} channels, with a suggested schedule from{' '}
                {fmtShort(startDate)} to {fmtShort(endDate)}.
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Suggested time</th>
                    <th>Content</th>
                    <th>Channel</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {generated.variations
                    .slice()
                    .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1))
                    .map((v) => (
                      <tr key={v.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{v.scheduledAt ? fmtDateTime(v.scheduledAt) : '—'}</td>
                        <td style={{ fontWeight: 600 }}>{generated.items.find((i) => i.id === v.contentItemId)?.title}</td>
                        <td>
                          <span className="channel-chip">
                            <ChannelIcon channel={v.channel} size={15} /> {CHANNEL_META[v.channel].label}
                          </span>
                        </td>
                        <td><StatusPill status="draft" /></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <button className="btn" onClick={() => setStep(1)}>Back</button>
            <button className="btn primary" disabled={!generated} onClick={() => setStep(3)}>
              Review the drafts
            </button>
          </div>
        </div>
      )}

      {!done && step === 3 && generated && (
        <div className="step-panel" key="step-3">
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="c-shared">Shared campaign message</label>
              <textarea id="c-shared" className="textarea" value={promoting}
                onChange={(e) => { setPromoting(e.target.value); runGenerate({ ...input, promoting: e.target.value }, overrides); }} />
              <span className="hint">
                Editing this rewrites every draft that hasn’t been customized. Customized channels keep their own version.
              </span>
            </div>
          </div>
          <div className="grid cols-2">
            {generated.variations.map((v) => {
              const item = generated.items.find((i) => i.id === v.contentItemId);
              const ws = genWarnings.get(v.id) ?? [];
              return (
                <div key={v.id} className="card card-pad">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                    <ChannelIcon channel={v.channel} size={16} />
                    <strong style={{ fontSize: 12.5 }}>{item?.title}</strong>
                    <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 11 }}>
                      {v.scheduledAt ? fmtDateTime(v.scheduledAt) : 'unscheduled'}
                    </span>
                  </div>
                  <PlatformPreview variation={v} assets={state.media.filter((m) => v.mediaIds.includes(m.id))} brand={brand} />
                  <details style={{ marginTop: 9 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 650, color: 'var(--accent)' }}>
                      {v.overridden ? 'Customized for this channel — edit' : 'Customize this channel'}
                    </summary>
                    <textarea className="textarea" style={{ marginTop: 8 }} value={v.body}
                      onChange={(e) => {
                        const next = new Map(overrides);
                        next.set(slotKey(v, item?.title ?? ''), e.target.value);
                        setOverrides(next);
                        setGenerated({
                          ...generated,
                          variations: generated.variations.map((x) =>
                            x.id === v.id ? { ...x, body: e.target.value, overridden: true } : x
                          ),
                        });
                      }} />
                  </details>
                  {ws.length > 0 && (
                    <div style={{ marginTop: 9 }}>
                      <WarningsList warnings={ws} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <button className="btn" onClick={() => setStep(2)}>Back</button>
            <button className="btn primary" onClick={() => setStep(4)}>Looks right — continue</button>
          </div>
        </div>
      )}

      {!done && step === 4 && generated && (
        <div className="card card-pad step-panel" key="step-4">
          {blockedCount > 0 && (
            <div className="notice info" style={{ marginBottom: 12 }}>
              {blockedCount} draft{blockedCount > 1 ? 's' : ''} still {blockedCount > 1 ? 'have' : 'has'} blocking checks (connections, footers, media). You can
              schedule the rest now — blocked items hold as drafts until the checks pass, and nothing is ever silently dropped.
            </div>
          )}
          <div className="choice-grid">
            <button className={`choice ${plan === 'recommended' ? 'on' : ''}`} onClick={() => setPlan('recommended')}>
              <div className="c-title">Schedule the recommended plan</div>
              <div className="c-sub">
                Approve once: all {generated.variations.length} items go on the calendar at the suggested times, {fmtShort(startDate)}–{fmtShort(endDate)}.
              </div>
            </button>
            <button className={`choice ${plan === 'manual' ? 'on' : ''}`} onClick={() => setPlan('manual')}>
              <div className="c-title">Choose dates manually</div>
              <div className="c-sub">Everything lands as drafts with suggested times — drag them into place on the calendar.</div>
            </button>
            <button className={`choice ${plan === 'template' ? 'on' : ''}`} onClick={() => setPlan('template')}>
              <div className="c-title">Save as a reusable template</div>
              <div className="c-sub">Keep the structure, copy, and cadence to run again next season.</div>
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            <button className="btn" onClick={() => setStep(3)}>Back</button>
            <button className="btn primary" disabled={!plan} onClick={finish}>
              {plan === 'template' ? 'Save template' : plan === 'manual' ? 'Create drafts' : 'Approve & schedule'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
