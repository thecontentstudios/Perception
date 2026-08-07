import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { linkFor } from '@/lib/tracking';
import { appUrl } from '@/lib/oauth/providers';
import { handle, require_ } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Mint or fetch the tracked link for a post.
 *
 * `POST` with a variation id returns its short URL, minting one if this is the
 * first time anyone asked. Idempotent, because a second link for the same post
 * would split its own numbers and nobody would notice until the totals stopped
 * adding up.
 */
export async function POST(req: Request) {
  return handle(async () => {
  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }
  const principal = await require_('create_content');

  let variationId: string;
  try {
    ({ variationId } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, reason: 'malformed JSON' }, { status: 400 });
  }

  const v = await db.channelVariation.findFirst({
    where: {
      id: variationId,
      contentItem: { campaign: { organizationId: principal.organizationId } },
    },
    include: { contentItem: { select: { campaignId: true } } },
  });
  if (!v) return NextResponse.json({ ok: false, reason: 'That post could not be found.' }, { status: 404 });

  const campaign = await db.campaign.findUnique({
    where: { id: v.contentItem.campaignId },
    select: { ctaUrl: true },
  });

  const { code, targetUrl } = await linkFor(
    {
      id: v.id,
      campaignId: v.contentItem.campaignId,
      cta: v.ctaUrl ? { url: v.ctaUrl } : null,
    },
    campaign?.ctaUrl ?? 'https://example.com'
  );

  return NextResponse.json({ ok: true, code, url: `${appUrl()}/r/${code}`, targetUrl });
  });
}

/** GET → click counts per link, for a campaign. */
export async function GET(req: Request) {
  return handle(async () => {
  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }
  const principal = await require_('read');
  const campaignId = new URL(req.url).searchParams.get('campaignId');
  if (!campaignId) {
    return NextResponse.json({ ok: false, reason: 'campaignId required' }, { status: 400 });
  }

  const links = await db.trackedLink.findMany({
    where: { campaignId, campaign: { organizationId: principal.organizationId } },
    include: { clicks: { select: { repeat: true, visitorId: true } } },
  });

  return NextResponse.json({
    ok: true,
    links: links.map((l) => ({
      code: l.code,
      variationId: l.variationId,
      targetUrl: l.targetUrl,
      clicks: l.clicks.length,
      // Unique visitors, not raw clicks. Reporting one number as the other is
      // how a campaign looks twice as effective as it was.
      visitors: new Set(l.clicks.map((c) => c.visitorId)).size,
    })),
  });
  });
}
