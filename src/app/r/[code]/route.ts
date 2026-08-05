import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import {
  ATTRIBUTION_COOKIE, ATTRIBUTION_MAX_AGE, VISITOR_COOKIE, newVisitorId, withUtms,
} from '@/lib/tracking';

export const dynamic = 'force-dynamic';

/**
 * The redirector. Somebody tapped a link in a post; this runs before they see
 * anything, so it has exactly one job and a very short deadline.
 *
 * The click write has to happen *before* the redirect, because the click id
 * travels in the destination URL — a cookie set here is not sent from the
 * customer's own domain later, so the URL is the only carrier that survives
 * (see `src/lib/attribution.ts`). But it must never be able to *block* the
 * redirect: the write is wrapped, and a failure costs us a number rather than
 * costing the customer a visitor.
 *
 * The cookie is first-party and holds an opaque id we generated. No
 * fingerprinting, no third-party pixel, nothing that follows anyone off this
 * domain — the attribution question here is only ever "did the click that
 * brought you here come from a post of ours".
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  if (!(await dbAvailable())) {
    return NextResponse.redirect(new URL('/', req.url), 302);
  }

  const link = await db.trackedLink.findUnique({
    where: { code },
    include: { campaign: { select: { utmCode: true } }, variation: { select: { channel: true, id: true } } },
  });
  if (!link) {
    // An unknown code is far more likely a typo or an old link than an attack.
    // Send them somewhere useful rather than showing a 404.
    return NextResponse.redirect(new URL('/', req.url), 302);
  }

  const cookies = parseCookies(req.headers.get('cookie'));
  const returning = Boolean(cookies[VISITOR_COOKIE]);
  const visitorId = cookies[VISITOR_COOKIE] || newVisitorId();

  // Record the click *before* redirecting in this one respect: the click id
  // has to travel in the URL, because the conversion happens on the customer's
  // domain where our cookie will not be sent. See src/lib/attribution.ts.
  let clickId: string | null = null;
  try {
    const repeat =
      returning && (await db.linkClick.count({ where: { linkId: link.id, visitorId } })) > 0;
    const click = await db.linkClick.create({
      data: {
        linkId: link.id,
        visitorId,
        repeat,
        referrer: req.headers.get('referer'),
        userAgent: req.headers.get('user-agent')?.slice(0, 255),
      },
    });
    clickId = click.id;
  } catch {
    // Losing a click costs us a number. Blocking the redirect on it would cost
    // the customer a visitor, which is worse by a wide margin — so the
    // redirect goes out either way, just without attribution.
  }

  const destination = withUtms(link.targetUrl, {
    campaign: link.campaign.utmCode,
    source: link.variation.channel.toLowerCase(),
    medium: 'social',
    content: link.variation.id,
    click: clickId,
  });

  const res = NextResponse.redirect(destination, 302);
  res.cookies.set(VISITOR_COOKIE, visitorId, {
    maxAge: ATTRIBUTION_MAX_AGE, httpOnly: true, sameSite: 'lax', path: '/',
  });
  // The attribution cookie carries the click a later conversion belongs to.
  // Last-touch: the most recent click wins, which is the model a small
  // business can actually reason about.
  res.cookies.set(
    ATTRIBUTION_COOKIE,
    JSON.stringify({ l: clickId, v: link.variationId, c: link.campaignId, t: Date.now() }),
    { maxAge: ATTRIBUTION_MAX_AGE, httpOnly: true, sameSite: 'lax', path: '/' }
  );

  return res;
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
