import { db } from './db';

/**
 * Turning a conversion into "which post caused this".
 *
 * **The cookie is not the primary path, and that is the important part.**
 *
 * `/r/<code>` sets a first-party cookie on *our* domain. The conversion,
 * though, happens on the *customer's* domain — their contact form, their
 * booking page. A cookie set on our domain is not sent with a cross-site
 * request from theirs unless it is `SameSite=None; Secure`, which is exactly
 * the third-party-cookie pattern browsers are actively removing and Safari
 * blocks outright. Building attribution on it would work in Chrome today and
 * quietly report zeros for a third of visitors.
 *
 * So the redirect carries the attribution **in the URL** instead. The snippet
 * on the customer's site reads it off the landing page, keeps it in *their*
 * own first-party storage, and sends it back with the conversion. Nothing
 * cross-site is required and nothing breaks when third-party cookies finally
 * go.
 *
 * The cookie stays as a same-site fallback — useful when the landing page is
 * on our domain, and free to keep.
 *
 * **What authorizes the write.** A click id is a random, unguessable value we
 * minted, handed to exactly one visitor, and that expires with the attribution
 * window. Presenting one is the credential: it proves the caller was sent by a
 * real click on a real post. Without it a conversion is still accepted, but it
 * is recorded as unattributed rather than credited to a campaign someone
 * named in a request body.
 */

export const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface Attribution {
  clickId: string | null;
  variationId: string | null;
  campaignId: string | null;
  /** Why it resolved the way it did — shown in reporting, not just logged. */
  basis: 'click' | 'cookie' | 'campaign_only' | 'none';
}

export const UNATTRIBUTED: Attribution = {
  clickId: null, variationId: null, campaignId: null, basis: 'none',
};

/**
 * Resolve attribution from whatever the caller could supply, best evidence
 * first. Each step is strictly weaker than the one above it, and the `basis`
 * says which one won so reporting can be honest about its own confidence.
 */
export async function resolveAttribution(input: {
  clickId?: string | null;
  cookie?: { l?: string; v?: string; c?: string; t?: number } | null;
  /** utm_content from the landing URL — the variation id, when it survives. */
  utmContent?: string | null;
  utmCampaign?: string | null;
}): Promise<Attribution> {
  // 1 — A click id. The strongest evidence: one visitor, one post, one moment.
  const clickId = input.clickId || input.cookie?.l;
  if (clickId) {
    const click = await db.linkClick.findUnique({
      where: { id: clickId },
      include: { link: { select: { variationId: true, campaignId: true } } },
    });
    if (click && Date.now() - click.clickedAt.getTime() < ATTRIBUTION_WINDOW_MS) {
      return {
        clickId: click.id,
        variationId: click.link.variationId,
        campaignId: click.link.campaignId,
        basis: input.clickId ? 'click' : 'cookie',
      };
    }
  }

  // 2 — utm_content carries the variation id. Weaker: anyone can copy a URL,
  // and a shared link credits the original post. Still better than nothing,
  // and it survives a cleared cookie.
  if (input.utmContent) {
    const v = await db.channelVariation.findUnique({
      where: { id: input.utmContent },
      include: { contentItem: { select: { campaignId: true } } },
    });
    if (v) {
      return {
        clickId: null, variationId: v.id,
        campaignId: v.contentItem.campaignId, basis: 'click',
      };
    }
  }

  // 3 — utm_campaign only. Names the campaign, not the post, which is enough
  // for "did this campaign work" and not enough for Phase 3 to learn from.
  if (input.utmCampaign) {
    const c = await db.campaign.findFirst({ where: { utmCode: input.utmCampaign } });
    if (c) return { clickId: null, variationId: null, campaignId: c.id, basis: 'campaign_only' };
  }

  return UNATTRIBUTED;
}

/** The conversion kinds this product understands. */
export const CONVERSION_KINDS = [
  'form_submission', 'booking', 'trial_signup', 'purchase', 'call', 'quote_request',
] as const;
export type ConversionKind = (typeof CONVERSION_KINDS)[number];

export function isConversionKind(x: unknown): x is ConversionKind {
  return typeof x === 'string' && (CONVERSION_KINDS as readonly string[]).includes(x);
}
