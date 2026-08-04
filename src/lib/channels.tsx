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
  x: { label: 'X (Twitter)', short: 'X', color: '#000000' },
  threads: { label: 'Threads', short: 'TH', color: '#33322e' },
  bluesky: { label: 'Bluesky', short: 'BSK', color: '#1185fe' },
  pinterest: { label: 'Pinterest', short: 'PIN', color: '#c8102e' },
  reddit: { label: 'Reddit', short: 'RDT', color: '#ff4500' },
  nextdoor: { label: 'Nextdoor', short: 'ND', color: '#5b8c1a' },
  snapchat: { label: 'Snapchat', short: 'SC', color: '#a16207' },
  whatsapp: { label: 'WhatsApp', short: 'WA', color: '#1da851' },
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
    case 'x':
      return (
        <g stroke={stroke} strokeWidth="2.2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </g>
      );
    case 'threads':
      return (
        <text x="12" y="16.5" textAnchor="middle" fontSize="14" fontWeight="700" fill={stroke} fontFamily="Arial, sans-serif">
          @
        </text>
      );
    case 'bluesky':
      return (
        <g fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 10.5C10.2 7 6.5 5 4.8 5.8c-.9 3.2.8 6.7 7.2 8.2M12 10.5C13.8 7 17.5 5 19.2 5.8c.9 3.2-.8 6.7-7.2 8.2M12 14v4.5" />
        </g>
      );
    case 'pinterest':
      return (
        <text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="700" fill={stroke} fontFamily="Georgia, serif">
          P
        </text>
      );
    case 'reddit':
      return (
        <text x="12" y="17" textAnchor="middle" fontSize="15" fontWeight="700" fill={stroke} fontFamily="Arial, sans-serif">
          r
        </text>
      );
    case 'nextdoor':
      return (
        <g fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M4.5 11.5L12 5l7.5 6.5M6.8 10v8.5h10.4V10" />
        </g>
      );
    case 'snapchat':
      return (
        <path
          d="M7 18v-7.5a5 5 0 0 1 10 0V18l-2.5-1.4L12 18l-2.5-1.4z"
          fill="none"
          stroke={stroke}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      );
    case 'whatsapp':
      return (
        <g fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4.5a7.2 7.2 0 0 1 0 14.4c-1.2 0-2.4-.3-3.4-.9L5 19l1-3.4a7.2 7.2 0 0 1 6-11.1z" />
          <path d="M9.6 9.4c.3 2.2 2.6 4.4 4.8 4.8l1-1.3-1.8-1.1-.9.6c-.8-.5-1.4-1.1-1.8-1.9l.6-.9-1.1-1.7z" />
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
