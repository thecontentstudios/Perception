'use client';

import { CAMPAIGN_COLORS } from '@/lib/demo-data';
import { USERS } from '@/lib/store';
import type { MediaAsset, PreflightWarning, VariationStatus, WarningSeverity } from '@/lib/types';

export const STATUS_LABEL: Record<VariationStatus, string> = {
  idea: 'Idea',
  draft: 'Draft',
  review: 'In review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
};

export function StatusPill({ status }: { status: VariationStatus }) {
  return <span className={`pill ${status}`}>{STATUS_LABEL[status]}</span>;
}

export function CampaignSwatch({ colorIndex, title }: { colorIndex: number; title?: string }) {
  const c = CAMPAIGN_COLORS[colorIndex % CAMPAIGN_COLORS.length];
  return <span className="campaign-dot" style={{ background: c.line }} title={title} />;
}

export function SevIcon({ severity, size = 14 }: { severity: WarningSeverity; size?: number }) {
  if (severity === 'block') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-label="Blocking" role="img">
        <circle cx="8" cy="8" r="7" fill="#d03b3b" />
        <rect x="4.2" y="7.1" width="7.6" height="1.8" rx="0.9" fill="#fff" />
      </svg>
    );
  }
  if (severity === 'warn') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-label="Warning" role="img">
        <path d="M8 1.5l7 12.5H1z" fill="#fab219" />
        <rect x="7.2" y="6" width="1.6" height="4" rx="0.8" fill="#4a3200" />
        <circle cx="8" cy="11.9" r="0.95" fill="#4a3200" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label="Note" role="img">
      <circle cx="8" cy="8" r="7" fill="#c3c2b7" />
      <rect x="7.2" y="6.8" width="1.6" height="4.4" rx="0.8" fill="#fff" />
      <circle cx="8" cy="4.6" r="1" fill="#fff" />
    </svg>
  );
}

export function WarningsList({ warnings }: { warnings: PreflightWarning[] }) {
  if (warnings.length === 0) {
    return (
      <div className="notice success">
        <span aria-hidden>✓</span> All checks pass — ready to schedule.
      </div>
    );
  }
  return (
    <div className="warnings">
      {warnings.map((w) => (
        <div key={w.id} className={`warning-row ${w.severity}`}>
          <span className="w-icon">
            <SevIcon severity={w.severity} />
          </span>
          <div>
            <div style={{ fontWeight: 600 }}>{w.message}</div>
            {w.fix && <div className="fix">{w.fix}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function WarnBadge({ warnings }: { warnings: PreflightWarning[] }) {
  if (warnings.length === 0) return null;
  const worst = warnings.some((w) => w.severity === 'block') ? 'block' : warnings.some((w) => w.severity === 'warn') ? 'warn' : null;
  if (!worst) return null;
  return (
    <span className={`warn-badge ${worst}`}>
      <SevIcon severity={worst} size={11} />
      {warnings.filter((w) => w.severity !== 'info').length}
    </span>
  );
}

const RATIO_PAD: Record<MediaAsset['aspectRatio'], number> = {
  '1:1': 100,
  '4:5': 125,
  '4:3': 75,
  '3:2': 66.7,
  '16:9': 56.25,
  '9:16': 177.8,
  '1.91:1': 52.4,
};

export function MediaThumb({
  asset,
  size = 38,
  ratio = false,
}: {
  asset: MediaAsset;
  size?: number;
  /** render at the asset's true aspect ratio (previews) instead of a square thumb */
  ratio?: boolean;
}) {
  const bg = `linear-gradient(135deg, ${asset.gradient[0]}, ${asset.gradient[1]})`;
  if (ratio) {
    return (
      <div
        className="thumb"
        role="img"
        aria-label={asset.altText ?? asset.name}
        style={{ background: bg, width: '100%', paddingTop: `${Math.min(RATIO_PAD[asset.aspectRatio], 125)}%`, borderRadius: 0 }}
      >
        <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 34 }} aria-hidden>
          {asset.glyph}
        </span>
        {asset.durationSec !== null && <span className="dur">{asset.durationSec}s</span>}
      </div>
    );
  }
  return (
    <div
      className="thumb"
      role="img"
      aria-label={asset.altText ?? asset.name}
      style={{ background: bg, width: size, height: size, fontSize: size * 0.42 }}
    >
      <span aria-hidden>{asset.glyph}</span>
      {asset.durationSec !== null && size >= 34 && <span className="dur">{asset.durationSec}s</span>}
    </div>
  );
}

export function UserChip({ userId, size = 22 }: { userId: string | null; size?: number }) {
  const u = USERS.find((x) => x.id === userId);
  if (!u) return null;
  return (
    <span
      className="avatar sm"
      style={{ width: size, height: size, fontSize: size * 0.42, background: '#52514e' }}
      title={`${u.name} · ${u.role}`}
    >
      {u.initials}
    </span>
  );
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="stars" aria-label={`${n} out of 5 stars`}>
      {'★'.repeat(n)}
      {'☆'.repeat(5 - n)}
    </span>
  );
}

export function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString('en-US');
}

export function fmtMoney(n: number): string {
  if (Math.abs(n) >= 10_000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `$${n.toLocaleString('en-US')}`;
}
