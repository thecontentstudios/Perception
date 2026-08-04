import type { Channel } from './types';

/**
 * Display metadata for every supported channel. Colors are approximate
 * platform hues used purely for fast visual identification on calendar cards
 * and badges; icons are simple generic glyphs (prototype placeholders, not
 * platform brand assets).
 */
export const CHANNEL_META: Record<
  Channel,
  { label: string; short: string; color: string }
> = {
  facebook: { label: 'Facebook', short: 'FB', color: '#1877f2' },
  instagram: { label: 'Instagram', short: 'IG', color: '#d6339a' },
  linkedin: { label: 'LinkedIn', short: 'LI', color: '#0a66c2' },
  tiktok: { label: 'TikTok', short: 'TT', color: '#1f2937' },
  youtube: { label: 'YouTube', short: 'YT', color: '#e11d48' },
  google_business: { label: 'Google Business', short: 'GBP', color: '#4285f4' },
  email: { label: 'Email', short: 'EM', color: '#8b5cf6' },
  sms: { label: 'SMS', short: 'SMS', color: '#10b981' },
  website: { label: 'Website', short: 'WEB', color: '#64748b' },
};

export const ALL_CHANNELS = Object.keys(CHANNEL_META) as Channel[];

function Glyph({ channel }: { channel: Channel }) {
  const stroke = 'currentColor';
  switch (channel) {
    case 'facebook':
      return (
        <text x="12" y="17.5" textAnchor="middle" fontSize="15" fontWeight="700" fill={stroke} fontFamily="Georgia, serif">
          f
        </text>
      );
    case 'instagram':
      return (
        <g fill="none" stroke={stroke} strokeWidth="1.8">
          <rect x="4.5" y="4.5" width="15" height="15" rx="4.5" />
          <circle cx="12" cy="12" r="3.4" />
          <circle cx="16.4" cy="7.6" r="0.6" fill={stroke} stroke="none" />
        </g>
      );
    case 'linkedin':
      return (
        <text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="700" fill={stroke} fontFamily="Arial, sans-serif">
          in
        </text>
      );
    case 'tiktok':
      return (
        <g fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round">
          <path d="M10.5 6.5v9a3 3 0 1 1-3-3" />
          <path d="M10.5 6.5c.6 2.6 2.6 4.2 5.5 4.4" />
        </g>
      );
    case 'youtube':
      return (
        <g>
          <rect x="4" y="6.5" width="16" height="11" rx="3" fill="none" stroke={stroke} strokeWidth="1.8" />
          <path d="M10.5 10l4 2-4 2z" fill={stroke} />
        </g>
      );
    case 'google_business':
      return (
        <g fill="none" stroke={stroke} strokeWidth="1.8">
          <path d="M12 20.5s-6-5.6-6-9.8A6 6 0 0 1 18 10.7c0 4.2-6 9.8-6 9.8z" />
          <circle cx="12" cy="10.5" r="1.9" />
        </g>
      );
    case 'email':
      return (
        <g fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round">
          <rect x="4" y="6.5" width="16" height="11" rx="2" />
          <path d="M4.8 8l7.2 5.4L19.2 8" />
        </g>
      );
    case 'sms':
      return (
        <g fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M4.5 6.5h15v9.5h-8l-4 3.5v-3.5h-3z" />
        </g>
      );
    case 'website':
      return (
        <g fill="none" stroke={stroke} strokeWidth="1.6">
          <circle cx="12" cy="12" r="7.5" />
          <ellipse cx="12" cy="12" rx="3.4" ry="7.5" />
          <path d="M4.8 12h14.4" />
        </g>
      );
  }
}

export function ChannelIcon({
  channel,
  size = 18,
  title,
}: {
  channel: Channel;
  size?: number;
  title?: string;
}) {
  const meta = CHANNEL_META[channel];
  return (
    <span
      className="chip-icon"
      style={{ background: meta.color, width: size, height: size }}
      title={title ?? meta.label}
      aria-label={meta.label}
      role="img"
    >
      <svg viewBox="0 0 24 24" width={size - 4} height={size - 4} aria-hidden="true">
        <Glyph channel={channel} />
      </svg>
    </span>
  );
}
