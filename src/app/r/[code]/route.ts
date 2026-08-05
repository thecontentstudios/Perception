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
 * Order matters. **Redirect first, record second** — a slow or failing
 * database must never leave a real person staring at a blank tab. Everything
 * that could go wrong is caught, and a click we failed to record is a number
 * we lose, not a visitor.
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

  const destination = withUtms(link.targetUrl, {
    campaign: link.campaign.utmCode,
    source: link.variation.channel.toLowerCase(),
    medium: 'social',
    content: link.variation.id,
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
    JSON.stringify({ l: link.id, v: link.variationId, c: link.campaignId, t: Date.now() }),
    { maxAge: ATTRIBUTION_MAX_AGE, httpOnly: true, sameSite: 'lax', path: '/' }
  );

  try {
    const repeat =
      returning &&
      (await db.linkClick.count({ where: { linkId: link.id, visitorId } })) > 0;
    await db.linkClick.create({
      data: {
        linkId: link.id,
        visitorId,
        repeat,
        referrer: req.headers.get('referer'),
        userAgent: req.headers.get('user-agent')?.slice(0, 255),
      },
    });
  } catch {
    // Losing a click is a reporting gap. Blocking the redirect on it would be
    // a broken link, which is worse by a wide margin.
  }

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
