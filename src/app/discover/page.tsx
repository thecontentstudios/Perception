'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlatformPreview } from '@/components/PlatformPreview';
import { MediaThumb, SevIcon, fmtNum } from '@/components/ui';
import { CHANNEL_META, ChannelIcon } from '@/lib/channels';
import { addDays, fmtShort } from '@/lib/dates';
import {
  analyze,
  DISCOVERY_STAGES,
  KNOWN_DOMAINS,
  type BrandIntel,
  type ProfileIntel,
} from '@/lib/discovery';
import { confidenceLabel, SOURCE_LABEL, suggestPosts, type Suggestion } from '@/lib/suggest';
import { BRANDS, TODAY, useApp } from '@/lib/store';
import type { Campaign, ChannelVariation, ContentItem } from '@/lib/types';

/** A fact with its provenance, so a wrong value can be traced and corrected. */
function FactRow({
  label,
  value,
  where,
  confidence,
}: {
  label: string;
  value: React.ReactNode;
  where: string;
  confidence: number;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {value || <span style={{ color: 'var(--muted)' }}>not found</span>}
        <div style={{ color: 'var(--muted)', fontSize: 10.5, marginTop: 1 }}>
          {where}
          {confidence < 0.8 && (
            <span className="pill review" style={{ marginLeft: 6 }}>
              confirm
            </span>
          )}
        </div>
      </dd>
    </>
  );
}

function ProfileCard({ profile }: { profile: ProfileIntel }) {
  const p = profile;
  const quiet = p.daysSinceLastPost !== null && p.daysSinceLastPost > 30;
  return (
    <div
      className="card card-pad"
      style={{ opacity: p.found ? 1 : 0.72, borderStyle: p.found ? 'solid' : 'dashed' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
        <ChannelIcon channel={p.channel} size={20} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{CHANNEL_META[p.channel].label}</div>
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>
            {p.found ? p.handle : 'no account found'}
          </div>
        </div>
        {p.found ? (
          <span className={`pill ${quiet ? 'review' : 'published'}`} style={{ marginLeft: 'auto' }}>
            {quiet ? `${p.daysSinceLastPost}d quiet` : 'active'}
          </span>
        ) : (
          <span className="pill draft" style={{ marginLeft: 'auto' }}>
            missing
          </span>
        )}
      </div>

      {p.found && (
        <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 6 }}>
          {p.followers !== null && (
            <span>
              <strong>{fmtNum(p.followers)}</strong> followers
            </span>
          )}
          {p.cadence && <span>posts {p.cadence}</span>}
        </div>
      )}

      {p.bestFormat && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
          Best format here: <strong>{p.bestFormat}</strong>
        </div>
      )}
      {p.themes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {p.themes.map((t) => (
            <span key={t} className="pill neutral">
              {t}
            </span>
          ))}
        </div>
      )}
      {p.issues.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 11.5, color: 'var(--ink-2)' }}>
          {p.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      {p.discoveredVia && (
        <div style={{ color: 'var(--muted)', fontSize: 10.5, marginTop: 7 }}>
          found via {p.discoveredVia}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  s,
  intel,
  selected,
  onToggle,
}: {
  s: Suggestion;
  intel: BrandIntel;
  selected: boolean;
  onToggle: () => void;
}) {
  const { state } = useApp();
  const [preview, setPreview] = useState(false);
  const brand = BRANDS.find((b) => b.id === intel.brandId);
  const assets = state.media.filter((m) => s.mediaIds.includes(m.id));
  const previewChannel = s.channels[0];

  const previewVariation = {
    id: s.id,
    contentItemId: s.id,
    campaignId: 'preview',
    channel: previewChannel,
    format: s.format,
    status: 'draft',
    scheduledAt: null,
    publishedAt: null,
    body: s.bodies[previewChannel] ?? s.coreMessage,
    subject: null,
    preheader: null,
    hasUnsubscribeFooter: true,
    mediaIds: s.mediaIds,
    cta: { label: s.ctaLabel, url: s.ctaUrl },
    hashtags: s.hashtags,
    assigneeUserId: null,
    overridden: false,
    failure: null,
  } as ChannelVariation;

  return (
    <div className="card card-pad" style={selected ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent)' } : {}}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select suggestion: ${s.title}`}
          style={{ marginTop: 3 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13 }}>{s.title}</strong>
            <span className="pill neutral">{SOURCE_LABEL[s.source]}</span>
            <span className={`pill ${s.score >= 0.9 ? 'published' : s.score >= 0.8 ? 'scheduled' : 'draft'}`}>
              {confidenceLabel(s.score)}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '7px 0' }}>
            <span className="icon-row">
              {s.channels.map((c) => (
                <ChannelIcon key={c} channel={c} size={16} />
              ))}
            </span>
            <span style={{ color: 'var(--muted)', fontSize: 11 }}>
              {s.channels.map((c) => CHANNEL_META[c].label).join(' · ')} · {s.format.replace('_', ' ')}
            </span>
            {assets[0] && <MediaThumb asset={assets[0]} size={26} />}
          </div>

          <div
            style={{
              background: 'var(--surface-2)',
              borderRadius: 7,
              padding: '8px 11px',
              fontSize: 12.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {s.bodies[previewChannel] ?? s.coreMessage}
          </div>

          {/* The part that earns trust: why this, traced to evidence. */}
          <div className="section-label" style={{ margin: '11px 0 5px' }}>
            Why we're suggesting this
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--ink-2)', display: 'grid', gap: 3 }}>
            {s.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>

          <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => setPreview(!preview)} aria-expanded={preview}>
              {preview ? 'Hide preview' : `Preview on ${CHANNEL_META[previewChannel].label}`}
            </button>
            <button className={`btn sm ${selected ? 'primary' : ''}`} onClick={onToggle}>
              {selected ? '✓ Selected' : 'Select'}
            </button>
          </div>

          {preview && brand && (
            <div style={{ marginTop: 10, maxWidth: 380 }}>
              <PlatformPreview variation={previewVariation} assets={assets} brand={brand} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const { state, dispatch } = useApp();
  const router = useRouter();

  const [input, setInput] = useState('greenscapenj.com');
  const [stage, setStage] = useState<number>(-1); // -1 idle, 0..n running, 99 done
  const [intel, setIntel] = useState<BrandIntel | null>(null);
  const [error, setError] = useState<{ reason: string; suggestions: string[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const usedMediaIds = useMemo(
    () => new Set(state.variations.flatMap((v) => v.mediaIds)),
    [state.variations]
  );

  const suggestions = useMemo(
    () => (intel ? suggestPosts(intel, state.media) : []),
    [intel, state.media]
  );

  function run() {
    setIntel(null);
    setError(null);
    setSelected(new Set());
    setStage(0);

    // Walk the visible stages so the wait explains itself, then resolve.
    let i = 0;
    const tick = () => {
      i += 1;
      if (i < DISCOVERY_STAGES.length) {
        setStage(i);
        setTimeout(tick, 260);
        return;
      }
      const result = analyze({
        domain: input,
        assets: state.media,
        usedMediaIds,
        today: TODAY,
      });
      if (result.ok) {
        setIntel(result.intel);
        setSelected(new Set(suggestPosts(result.intel, state.media).slice(0, 3).map((s) => s.id)));
      } else {
        setError({ reason: result.reason, suggestions: result.suggestions });
      }
      setStage(99);
    };
    setTimeout(tick, 300);
  }

  /** Turn the selected suggestions into a real campaign of drafts. */
  function addSelected() {
    if (!intel) return;
    const picked = suggestions.filter((s) => selected.has(s.id));
    if (picked.length === 0) return;

    const campaignId = `c-disc-${Date.now().toString(36)}`;
    const campaign: Campaign = {
      id: campaignId,
      brandId: intel.brandId ?? BRANDS[0].id,
      name: `Suggested from ${intel.site.domain}`,
      status: 'draft',
      goal: picked[0].goal,
      audience: intel.site.serviceArea.value ?? 'Your local audience',
      startDate: addDays(TODAY, 1),
      endDate: addDays(TODAY, 21),
      offer: intel.site.liveOffers.value[0] ?? null,
      cta: { label: picked[0].ctaLabel, url: picked[0].ctaUrl },
      colorIndex: 3,
      utmCode: `discovery-${intel.site.domain.split('.')[0]}`,
      createdByUserId: 'u-dana',
      templateId: null,
      description: `Drafts generated from an analysis of ${intel.site.domain}, its social profiles, and the media library.`,
    };

    const items: ContentItem[] = [];
    const variations: ChannelVariation[] = [];

    picked.forEach((s, idx) => {
      const itemId = `ci-${s.id}`;
      items.push({
        id: itemId,
        campaignId,
        title: s.title,
        kind: s.channels.includes('email') ? 'email' : 'social',
        coreMessage: s.coreMessage,
      });
      // Stagger across days so the calendar isn't a single pile.
      const day = addDays(TODAY, 1 + idx * 2);
      s.channels.forEach((c, ci) => {
        variations.push({
          id: `v-${s.id}-${c}`,
          contentItemId: itemId,
          campaignId,
          channel: c,
          format: s.format,
          status: 'draft',
          scheduledAt: `${day}T${['09:30', '12:00', '17:00'][ci % 3]}`,
          publishedAt: null,
          body: s.bodies[c] ?? s.coreMessage,
          subject: null,
          preheader: null,
          hasUnsubscribeFooter: true,
          mediaIds: s.mediaIds,
          cta: { label: s.ctaLabel, url: s.ctaUrl },
          hashtags: c === 'instagram' || c === 'tiktok' ? s.hashtags : [],
          assigneeUserId: null,
          overridden: false,
          failure: null,
        });
      });
    });

    dispatch({
      type: 'addCampaign',
      campaign,
      items,
      variations,
      auditDetail: `Created ${variations.length} drafts from discovery of ${intel.site.domain}.`,
    });
    router.push('/calendar');
  }

  const running = stage >= 0 && stage < 99;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Discover</h1>
          <div className="sub">
            Point Perception at a website. It reads the business, finds the social profiles that already
            exist, audits the photo library, and drafts posts grounded in what it found — never published
            without your say-so.
          </div>
        </div>
      </div>

      {/* Input */}
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 260, marginBottom: 0 }}>
            <label htmlFor="d-url">Website address</label>
            <input
              id="d-url"
              className="input"
              value={input}
              placeholder="yourbusiness.com"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !running && run()}
            />
          </div>
          <button className="btn primary" onClick={run} disabled={running || !input.trim()}>
            {running ? 'Analyzing…' : 'Analyze this business'}
          </button>
        </div>
        <div style={{ marginTop: 9, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>Try:</span>
          {KNOWN_DOMAINS.map((d) => (
            <button key={d} className="src-chip" onClick={() => setInput(d)}>
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Staged progress */}
      {running && (
        <div className="card card-pad" style={{ marginBottom: 14 }}>
          {DISCOVERY_STAGES.map((s, i) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '5px 0',
                opacity: i <= stage ? 1 : 0.35,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  background: i < stage ? 'var(--st-good)' : i === stage ? 'var(--accent)' : 'var(--surface-2)',
                  color: i <= stage ? '#fff' : 'var(--muted)',
                  flex: 'none',
                }}
              >
                {i < stage ? '✓' : i + 1}
              </span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 12.5 }}>{s.label}</div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="card card-pad" style={{ marginBottom: 14 }}>
          <div className="warning-row block">
            <span className="w-icon">
              <SevIcon severity="block" />
            </span>
            <div>
              <div style={{ fontWeight: 650 }}>{error.reason}</div>
              <div className="fix">
                This prototype analyzes a fixed set of demo businesses. Try {error.suggestions.join(', ')}.
              </div>
            </div>
          </div>
        </div>
      )}

      {intel && (
        <>
          {/* What we found */}
          <div className="grid cols-2" style={{ marginBottom: 14 }}>
            <div className="card card-pad">
              <h3 style={{ marginBottom: 3 }}>{intel.site.businessName.value}</h3>
              <div className="card-sub" style={{ marginBottom: 10 }}>
                {intel.site.pagesCrawled} pages read · {intel.site.imagesFound} images found ·{' '}
                {intel.site.platform.value}
              </div>
              <dl className="kv">
                <FactRow label="What they do" value={intel.site.description.value} where={intel.site.description.source.where} confidence={intel.site.description.confidence} />
                <FactRow label="Service area" value={intel.site.serviceArea.value} where={intel.site.serviceArea.source.where} confidence={intel.site.serviceArea.confidence} />
                <FactRow label="Address" value={intel.site.address.value} where={intel.site.address.source.where} confidence={intel.site.address.confidence} />
                <FactRow label="Phone" value={intel.site.phone.value} where={intel.site.phone.source.where} confidence={intel.site.phone.confidence} />
                <FactRow label="Hours" value={intel.site.hours.value} where={intel.site.hours.source.where} confidence={intel.site.hours.confidence} />
                <FactRow
                  label="Live offers"
                  value={intel.site.liveOffers.value.join(' · ')}
                  where={intel.site.liveOffers.source.where}
                  confidence={intel.site.liveOffers.confidence}
                />
                <FactRow
                  label="Voice"
                  value={`${intel.site.voice.value.register}, ${intel.site.voice.value.usesEmoji ? 'uses emoji' : 'no emoji'}, ~${intel.site.voice.value.avgSentenceWords}-word sentences`}
                  where={intel.site.voice.source.where}
                  confidence={intel.site.voice.confidence}
                />
              </dl>

              <div className="section-label">Services found</div>
              <div style={{ display: 'grid', gap: 6 }}>
                {intel.site.services.value.map((s) => (
                  <div key={s.name} style={{ fontSize: 12 }}>
                    <strong>{s.name}</strong>
                    {s.priceHint && <span className="pill neutral" style={{ marginLeft: 6 }}>{s.priceHint}</span>}
                    <span className="pill neutral" style={{ marginLeft: 4 }}>{s.season.replace('_', ' ')}</span>
                    <div style={{ color: 'var(--ink-2)' }}>{s.description}</div>
                  </div>
                ))}
              </div>

              <div className="section-label">Brand palette</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {intel.site.palette.value.map((c) => (
                  <span
                    key={c}
                    title={c}
                    style={{ width: 30, height: 22, borderRadius: 5, background: c, border: '1px solid var(--border)' }}
                  />
                ))}
              </div>
            </div>

            <div>
              {/* Gaps */}
              <div className="card card-pad" style={{ marginBottom: 14 }}>
                <h3 style={{ marginBottom: 3 }}>What's missing</h3>
                <div className="card-sub" style={{ marginBottom: 10 }}>
                  {intel.gaps.length} things worth fixing, most costly first
                </div>
                <div className="warnings">
                  {intel.gaps.map((g) => (
                    <div key={g.title} className={`warning-row ${g.severity === 'high' ? 'block' : g.severity === 'medium' ? 'warn' : 'info'}`}>
                      <span className="w-icon">
                        <SevIcon severity={g.severity === 'high' ? 'block' : g.severity === 'medium' ? 'warn' : 'info'} />
                      </span>
                      <div>
                        <div style={{ fontWeight: 650 }}>{g.title}</div>
                        <div className="fix">{g.detail}</div>
                        {g.action && <div className="fix" style={{ color: 'var(--accent)', fontWeight: 600 }}>{g.action}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Media audit */}
              <div className="card card-pad">
                <h3 style={{ marginBottom: 3 }}>Photo & video library</h3>
                <div className="card-sub" style={{ marginBottom: 10 }}>
                  {intel.media.total} assets · {intel.media.videoCount} videos · {intel.media.unused.length} never posted
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 9 }}>
                  {intel.media.unused.slice(0, 8).map((a) => (
                    <MediaThumb key={a.id} asset={a} size={46} />
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
                  Ratios on hand: {Object.entries(intel.media.ratios).map(([r, n]) => `${r} (${n})`).join(', ')}
                </div>
                {intel.media.ratioGapsFor.length > 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 4 }}>
                    No usable assets for:{' '}
                    <strong>{intel.media.ratioGapsFor.map((c) => CHANNEL_META[c].label).join(', ')}</strong>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Profiles */}
          <div className="section-label">Social profiles found</div>
          <div className="grid cols-3" style={{ marginBottom: 18 }}>
            {intel.profiles.map((p) => (
              <ProfileCard key={p.channel} profile={p} />
            ))}
          </div>

          {/* Suggestions */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <h3>Suggested posts</h3>
              <span className="card-sub">
                {suggestions.length} drafts grounded in what we found — nothing publishes without your approval
              </span>
              <div className="right">
                <button
                  className="btn sm"
                  onClick={() =>
                    setSelected(selected.size === suggestions.length ? new Set() : new Set(suggestions.map((s) => s.id)))
                  }
                >
                  {selected.size === suggestions.length ? 'Clear all' : 'Select all'}
                </button>
                <button className="btn primary sm" onClick={addSelected} disabled={selected.size === 0}>
                  Add {selected.size} to calendar as drafts
                </button>
              </div>
            </div>
            <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
              {suggestions.map((s) => (
                <SuggestionCard
                  key={s.id}
                  s={s}
                  intel={intel}
                  selected={selected.has(s.id)}
                  onToggle={() => {
                    const next = new Set(selected);
                    if (next.has(s.id)) next.delete(s.id);
                    else next.add(s.id);
                    setSelected(next);
                  }}
                />
              ))}
            </div>
          </div>

          <div className="notice info">
            Analyzed {fmtShort(intel.analyzedAt)}. Every fact above shows where it came from — correct anything
            wrong and the drafts regenerate from the corrected version.
          </div>
        </>
      )}
    </div>
  );
}
