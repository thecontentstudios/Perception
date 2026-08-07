import { dateKeyOf } from './dates';
import { adapterFor } from './connectors/registry';
import { warning } from './connectors/contract';
import { CHANNEL_META } from './channels';
import type {
  Campaign,
  ChannelVariation,
  ConnectedAccount,
  MediaAsset,
  PreflightWarning,
  WarningSeverity,
} from './types';

/**
 * The intelligent-safeguards engine. Runs before scheduling and continuously
 * in the editor. Every result is a human-readable sentence with a suggested
 * fix; nothing a platform doesn't support is ever silently discarded — it
 * surfaces here instead.
 */

export interface PreflightContext {
  campaign: Campaign;
  assets: MediaAsset[]; // assets attached to the variation, resolved
  accounts: ConnectedAccount[];
  /** every variation in the workspace (for cross-campaign checks) */
  allVariations: ChannelVariation[];
  /** all campaigns by id (for promotion-density naming) */
  campaigns: Campaign[];
  today: string; // demo clock, YYYY-MM-DD
}

const SEVERITY_RANK: Record<WarningSeverity, number> = { block: 0, warn: 1, info: 2 };

export function preflight(v: ChannelVariation, ctx: PreflightContext): PreflightWarning[] {
  // Published items have nothing left to gate — checks exist to protect the
  // next publish, not to re-litigate a successful one.
  if (v.status === 'published') return [];

  const out: PreflightWarning[] = [];
  const label = CHANNEL_META[v.channel].label;

  // 1 — Connection health. Publishing to a dead connection is the #1 silent
  // failure in this category of product, so it outranks content checks.
  const account = ctx.accounts.find((a) => a.channel === v.channel);
  if (!account || account.status === 'not_connected') {
    out.push(
      warning('not-connected', 'block', `${label} is not connected.`, `Connect a ${label} account before this can publish.`)
    );
  } else if (account.status === 'needs_reconnect') {
    out.push(
      warning('needs-reconnect', 'block', `${label} has not been reconnected.`, 'Reconnect from the Connections page — takes under a minute.')
    );
  } else if (account.status === 'expiring') {
    out.push(
      warning('expiring', 'warn', `The ${label} connection expires soon.`, 'Renew it from the Connections page to avoid a failed publish.')
    );
  }

  // 2 — Channel-specific rules from the adapter's capability sheet.
  out.push(...adapterFor(v.channel).validate(v, ctx.assets));

  // 3 — Call to action. A promotion without an ask is a wasted slot.
  const ctaFormats = ['post', 'update', 'reel', 'email', 'banner', 'landing_page'];
  const hasLink = /https?:\/\//.test(v.body);
  if (ctaFormats.includes(v.format) && !v.cta && !hasLink) {
    out.push(
      warning('no-cta', 'warn', 'This post has no call to action.', `Add the campaign's action — “${ctx.campaign.cta.label}” — or a link.`)
    );
  }

  // 4 — Accessibility: alternative text on images.
  for (const asset of ctx.assets) {
    if (asset.kind === 'image' && !asset.altText) {
      out.push(
        warning('missing-alt', 'warn', `This image is missing alternative text (“${asset.name}”).`, 'Describe the image in the Media Library — screen readers and deliverability both use it.')
      );
    }
  }

  // 5 — Promotion density: three or more campaigns landing on one day.
  if (v.scheduledAt) {
    const day = dateKeyOf(v.scheduledAt);
    const campaignsThatDay = new Set(
      ctx.allVariations
        .filter((o) => o.scheduledAt && dateKeyOf(o.scheduledAt) === day)
        .filter((o) => o.status === 'scheduled' || o.status === 'approved' || o.status === 'published')
        .map((o) => o.campaignId)
    );
    campaignsThatDay.add(v.campaignId);
    if (campaignsThatDay.size >= 3) {
      out.push(
        warning('promo-density', 'warn', `${campaignsThatDay.size} promotions are scheduled on the same day.`, 'Spread campaigns out so they don’t compete for the same audience.')
      );
    }
  }

  // 6 — Time sanity against the clock.
  if (v.scheduledAt && dateKeyOf(v.scheduledAt) < ctx.today && v.status !== 'failed') {
    out.push(
      warning('in-past', 'block', 'The scheduled time is in the past.', 'Pick a new time — nothing publishes retroactively.')
    );
  }
  if (!v.scheduledAt && v.status === 'approved') {
    out.push(warning('approved-unscheduled', 'info', 'Approved but not scheduled yet.', 'Drag it onto the calendar or pick a time.'));
  }

  // Dedupe by rule id (adapter + engine can overlap), keep the worst severity first.
  const seen = new Map<string, PreflightWarning>();
  for (const w of out) {
    const existing = seen.get(w.id);
    if (!existing || SEVERITY_RANK[w.severity] < SEVERITY_RANK[existing.severity]) seen.set(w.id, w);
  }
  return [...seen.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function worstSeverity(warnings: PreflightWarning[]): WarningSeverity | null {
  if (warnings.length === 0) return null;
  return warnings.reduce<WarningSeverity>(
    (worst, w) => (SEVERITY_RANK[w.severity] < SEVERITY_RANK[worst] ? w.severity : worst),
    'info'
  );
}
