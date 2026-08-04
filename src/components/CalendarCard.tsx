'use client';

import { CAMPAIGN_COLORS } from '@/lib/demo-data';
import { fmtTime } from '@/lib/dates';
import { ChannelIcon } from '@/lib/channels';
import { useApp } from '@/lib/store';
import type { ChannelVariation } from '@/lib/types';
import { MediaThumb, StatusPill, UserChip, WarnBadge } from './ui';

/**
 * The calendar card. At a glance: thumbnail, campaign color (left edge),
 * platform icon, time, content title, status, assignee, and warning
 * indicators — the full anatomy from the product blueprint, at two densities.
 */
export function CalendarCard({
  variation,
  dense = false,
  onOpen,
  draggable = true,
  onDragStart,
  onDragEnd,
  dragging = false,
}: {
  variation: ChannelVariation;
  dense?: boolean;
  onOpen: (id: string) => void;
  draggable?: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
}) {
  const { campaignById, brandById, itemById, assetsFor, preflightFor } = useApp();
  const v = variation;
  const campaign = campaignById(v.campaignId);
  const brand = campaign ? brandById(campaign.brandId) : undefined;
  const item = itemById(v.contentItemId);
  const assets = assetsFor(v);
  const warnings = preflightFor(v);
  const color = CAMPAIGN_COLORS[(campaign?.colorIndex ?? 0) % CAMPAIGN_COLORS.length];

  return (
    <button
      type="button"
      className={`cal-card ${dragging ? 'dragging' : ''}`}
      style={{ borderLeftColor: color.line, background: v.status === 'failed' ? 'rgba(208,59,59,0.05)' : undefined }}
      onClick={() => onOpen(v.id)}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', v.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(v.id);
      }}
      onDragEnd={onDragEnd}
      title={`${item?.title ?? ''} — ${campaign?.name ?? ''}${draggable ? ' (drag to reschedule)' : ''}`}
    >
      {draggable && (
        <span className="grip" aria-hidden>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
            <circle cx="2.5" cy="2" r="1" />
            <circle cx="7.5" cy="2" r="1" />
            <circle cx="2.5" cy="5" r="1" />
            <circle cx="7.5" cy="5" r="1" />
            <circle cx="2.5" cy="8" r="1" />
            <circle cx="7.5" cy="8" r="1" />
          </svg>
        </span>
      )}
      {assets[0] && !dense && <MediaThumb asset={assets[0]} size={34} />}
      <span className="cc-body">
        <span className="cc-top">
          <ChannelIcon channel={v.channel} size={14} />
          {v.scheduledAt && <span className="cc-time">{fmtTime(v.scheduledAt)}</span>}
          <WarnBadge warnings={warnings} />
          {v.assigneeUserId && !dense && (
            <span style={{ marginLeft: 'auto' }}>
              <UserChip userId={v.assigneeUserId} size={16} />
            </span>
          )}
        </span>
        <span className="cc-title">{item?.title ?? v.body.slice(0, 40)}</span>
        {!dense && (
          <span className="cc-meta">
            <StatusPill status={v.status} />
            <span style={{ color: 'var(--muted)', fontSize: 10 }}>{brand?.name}</span>
          </span>
        )}
      </span>
    </button>
  );
}
