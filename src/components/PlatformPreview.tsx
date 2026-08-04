'use client';

import { CHANNEL_META, ChannelIcon } from '@/lib/channels';
import type { Brand, ChannelVariation, MediaAsset } from '@/lib/types';
import { MediaThumb } from './ui';

/**
 * Accurate-feeling destination previews. Each frame mirrors the layout
 * conventions of its platform closely enough that an owner can judge how the
 * post will actually read — without pretending to be the platform itself.
 */

function handleFor(brand: Brand): string {
  return '@' + brand.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 22);
}

function BrandAvatar({ brand, size = 30 }: { brand: Brand; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: '#52514e' }}
      aria-hidden
    >
      {brand.name.slice(0, 1)}
    </span>
  );
}

function ActionRow({ items }: { items: string[] }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 18,
        padding: '8px 12px',
        color: 'var(--ink-2)',
        fontSize: 11.5,
        fontWeight: 650,
        borderTop: '1px solid var(--hairline)',
      }}
    >
      {items.map((i) => (
        <span key={i}>{i}</span>
      ))}
    </div>
  );
}

export function PlatformPreview({
  variation,
  assets,
  brand,
}: {
  variation: ChannelVariation;
  assets: MediaAsset[];
  brand: Brand;
}) {
  const v = variation;
  const media = assets[0];

  if (v.channel === 'email') {
    return (
      <div className="preview-frame email">
        <div className="pv-head" style={{ borderBottom: '1px solid var(--hairline)' }}>
          <ChannelIcon channel="email" />
          <div>
            <div className="pv-name">{brand.name} &lt;hello@summitlocal.co&gt;</div>
            <div className="pv-sub">To: {'{{first_name}}'} · your subscribers</div>
          </div>
        </div>
        <div className="pv-subject">{v.subject || <em style={{ color: 'var(--st-critical)' }}>Missing subject line</em>}</div>
        <div className="pv-preheader">{v.preheader || 'No preview text set'}</div>
        {media && <MediaThumb asset={media} ratio />}
        <div className="pv-body">{v.body.replace(/\{\{first_name\}\}/g, 'Priya')}</div>
        {v.cta && <span className="pv-cta">{v.cta.label}</span>}
        {v.hasUnsubscribeFooter ? (
          <div className="pv-footer">
            {brand.name} · 41 Springfield Ave, Maplewood, NJ · <u>Unsubscribe</u> · <u>Preferences</u>
          </div>
        ) : (
          <div className="pv-footer missing">Unsubscribe footer missing — required before this email can send</div>
        )}
      </div>
    );
  }

  if (v.channel === 'sms' || v.channel === 'whatsapp') {
    return (
      <div className="preview-frame" style={{ padding: 14, background: 'var(--surface-2)' }}>
        <div
          style={{
            background: v.channel === 'whatsapp' ? '#e7fbdf' : '#fff',
            border: '1px solid var(--hairline)',
            borderRadius: '14px 14px 14px 4px',
            padding: '9px 12px',
            maxWidth: 300,
            fontSize: 12.5,
          }}
        >
          {v.body}
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 10.5, marginTop: 6 }}>
          {brand.name} · {v.channel === 'whatsapp' ? 'WhatsApp Business (template message)' : 'SMS'}
        </div>
      </div>
    );
  }

  // Short-form feeds: no CTA button exists organically — the link rides in the text.
  if (v.channel === 'x' || v.channel === 'threads' || v.channel === 'bluesky') {
    return (
      <div className="preview-frame">
        <div className="pv-head">
          <BrandAvatar brand={brand} size={26} />
          <div>
            <div className="pv-name">{brand.name}</div>
            <div className="pv-sub">{handleFor(brand)} · now</div>
          </div>
          <span style={{ marginLeft: 'auto' }}>
            <ChannelIcon channel={v.channel} size={16} />
          </span>
        </div>
        <div className="pv-body">
          {v.body}
          {v.cta && <div style={{ color: '#1c5cab', marginTop: 6 }}>{v.cta.url}</div>}
        </div>
        {media && <MediaThumb asset={media} ratio />}
        <ActionRow items={v.channel === 'x' ? ['💬 Reply', '↻ Repost', '♥ Like', '⌁ Bookmark'] : ['♥ Like', '💬 Reply', '↻ Repost', '➤ Share']} />
        <div className="pv-footer">
          {v.body.length}/{v.channel === 'x' ? 280 : v.channel === 'threads' ? 500 : 300} characters
        </div>
      </div>
    );
  }

  if (v.channel === 'website') {
    if (v.format === 'banner') {
      return (
        <div className="preview-frame">
          <div
            style={{
              background: 'linear-gradient(120deg, #101014, #2d2d36)',
              color: '#fff',
              padding: '13px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13 }}>{v.body}</span>
            {v.cta && (
              <span
                style={{
                  marginLeft: 'auto',
                  background: '#fff',
                  color: '#101014',
                  borderRadius: 7,
                  padding: '5px 12px',
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                {v.cta.label}
              </span>
            )}
          </div>
          <div className="pv-footer">Sitewide banner on {brand.website}</div>
        </div>
      );
    }
    return (
      <div className="preview-frame">
        <div className="pv-head">
          <ChannelIcon channel="website" />
          <div>
            <div className="pv-name">
              {brand.website}
              {v.format === 'landing_page' ? ` — ${v.campaignId ? 'landing page' : ''}` : ' — blog'}
            </div>
            <div className="pv-sub">{v.format === 'landing_page' ? 'Landing page' : 'Blog post'}</div>
          </div>
        </div>
        {media && <MediaThumb asset={media} ratio />}
        <div className="pv-body">{v.body}</div>
        {v.cta && <span className="pv-cta">{v.cta.label}</span>}
      </div>
    );
  }

  if (v.channel === 'instagram') {
    return (
      <div className="preview-frame">
        <div className="pv-head">
          <BrandAvatar brand={brand} size={26} />
          <div>
            <div className="pv-name">{handleFor(brand).slice(1)}</div>
            <div className="pv-sub">{brand.location}</div>
          </div>
          <span style={{ marginLeft: 'auto' }}>
            <ChannelIcon channel="instagram" size={16} />
          </span>
        </div>
        {media && <MediaThumb asset={media} ratio />}
        <ActionRow items={['♥ Like', '💬 Comment', '➤ Share', '⌁ Save']} />
        <div className="pv-body">
          <strong>{handleFor(brand).slice(1)}</strong> {v.body}
        </div>
        {v.hashtags.length > 0 && <div className="pv-tags">{v.hashtags.map((h) => `#${h}`).join(' ')}</div>}
        {v.format === 'reel' && (
          <div className="pv-footer">Reel · vertical 9:16 · CTA “{v.cta?.label}” goes in bio link</div>
        )}
      </div>
    );
  }

  if (v.channel === 'linkedin') {
    return (
      <div className="preview-frame">
        <div className="pv-head">
          <BrandAvatar brand={brand} size={30} />
          <div>
            <div className="pv-name">{brand.name}</div>
            <div className="pv-sub">1,024 followers · Promoted by {CHANNEL_META.linkedin.label}</div>
          </div>
        </div>
        <div className="pv-body">{v.body}</div>
        {media && <MediaThumb asset={media} ratio />}
        {v.cta && <span className="pv-cta">{v.cta.label} ↗</span>}
        <ActionRow items={['👍 Like', '💬 Comment', '↻ Repost', '➤ Send']} />
      </div>
    );
  }

  if (v.channel === 'google_business') {
    return (
      <div className="preview-frame">
        <div className="pv-head">
          <ChannelIcon channel="google_business" />
          <div>
            <div className="pv-name">{brand.name}</div>
            <div className="pv-sub">Business Profile update · {brand.location}</div>
          </div>
        </div>
        {media && <MediaThumb asset={media} ratio />}
        <div className="pv-body">{v.body}</div>
        {v.cta && <span className="pv-cta">{v.cta.label}</span>}
      </div>
    );
  }

  // Facebook and remaining feed-style channels
  return (
    <div className="preview-frame">
      <div className="pv-head">
        <BrandAvatar brand={brand} size={30} />
        <div>
          <div className="pv-name">{brand.name}</div>
          <div className="pv-sub">Just now · 🌐</div>
        </div>
        <span style={{ marginLeft: 'auto' }}>
          <ChannelIcon channel={v.channel} size={16} />
        </span>
      </div>
      <div className="pv-body">{v.body}</div>
      {media && <MediaThumb asset={media} ratio />}
      {v.cta && <span className="pv-cta">{v.cta.label}</span>}
      <ActionRow items={['👍 Like', '💬 Comment', '➤ Share']} />
    </div>
  );
}
