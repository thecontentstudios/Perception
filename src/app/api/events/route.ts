import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { ATTRIBUTION_COOKIE } from '@/lib/tracking';
import { isConversionKind, resolveAttribution, CONVERSION_KINDS } from '@/lib/attribution';
import { ORG } from '@/lib/demo-data';

export const dynamic = 'force-dynamic';

/**
 * Conversion ingestion — the endpoint that makes the reporting true.
 *
 * The sentence this product is built to say is "this campaign generated N
 * quote requests". Until now that number was written by hand. This is where it
 * starts being counted.
 *
 * Called cross-origin from the customer's own site, so it answers preflight
 * and allows any origin. That is a deliberate choice and needs justifying: the
 * write is not authorized by the origin, it is authorized by the click id,
 * which is unguessable, single-visitor, and expires. Locking the origin down
 * would break every customer who moves a form to a subdomain while doing
 * nothing an attacker couldn't route around.
 *
 * What an unauthenticated caller can therefore do is add an *unattributed*
 * conversion. That inflates a total, and the totals distinguish attributed
 * from unattributed precisely so an inflated one is visible rather than
 * silently believed.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

interface EventBody {
  kind?: string;
  /** Minor units. Cents, not dollars — floats and money don't mix. */
  valueCents?: number;
  /** The caller's own id for this event, so a double-submit counts once. */
  eventId?: string;
  clickId?: string;
  utmContent?: string;
  utmCampaign?: string;
  email?: string;
  occurredAt?: string;
}

export async function POST(req: Request) {
  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503, headers: CORS });
  }

  let body: EventBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'malformed JSON' }, { status: 400, headers: CORS });
  }

  if (!isConversionKind(body.kind)) {
    return NextResponse.json(
      { ok: false, reason: `kind must be one of: ${CONVERSION_KINDS.join(', ')}` },
      { status: 400, headers: CORS }
    );
  }

  // Same-site fallback, for a landing page hosted on our own domain.
  let cookie: { l?: string; v?: string; c?: string; t?: number } | null = null;
  const raw = parseCookies(req.headers.get('cookie'))[ATTRIBUTION_COOKIE];
  if (raw) {
    try { cookie = JSON.parse(raw); } catch { /* a corrupt cookie is just no cookie */ }
  }

  const attribution = await resolveAttribution({
    clickId: body.clickId,
    cookie,
    utmContent: body.utmContent,
    utmCampaign: body.utmCampaign,
  });

  // Match an existing contact by email when one is offered, so a conversion
  // joins the person it belongs to. Never creates one: a form submission is
  // not consent to be added to a marketing list.
  const contact = body.email
    ? await db.contact.findFirst({
        where: { organizationId: ORG.id, email: body.email.toLowerCase().trim() },
        select: { id: true },
      })
    : null;

  const variation = attribution.variationId
    ? await db.channelVariation.findUnique({
        where: { id: attribution.variationId },
        select: { channel: true },
      })
    : null;

  const data = {
    organizationId: ORG.id,
    campaignId: attribution.campaignId,
    variationId: attribution.variationId,
    clickId: attribution.clickId,
    contactId: contact?.id ?? null,
    kind: body.kind,
    channel: variation?.channel ?? null,
    valueCents: Number.isFinite(body.valueCents) ? Math.max(0, Math.round(body.valueCents!)) : 0,
    occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
    externalId: body.eventId ?? null,
    attribution: {
      basis: attribution.basis,
      referrer: req.headers.get('referer'),
      utmCampaign: body.utmCampaign ?? null,
      utmContent: body.utmContent ?? null,
    },
  };

  try {
    // A form that double-submits, or a snippet that retries after a timeout,
    // must not become two leads. With an eventId that is enforced by the
    // database; without one the caller has opted out of the guarantee.
    const conversion = body.eventId
      ? await db.conversion.upsert({
          where: { organizationId_externalId: { organizationId: ORG.id, externalId: body.eventId } },
          create: data,
          update: {},
        })
      : await db.conversion.create({ data });

    return NextResponse.json(
      { ok: true, id: conversion.id, attributed: attribution.basis !== 'none', basis: attribution.basis },
      { headers: CORS }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: (e as Error).message },
      { status: 500, headers: CORS }
    );
  }
}

/** GET → what a campaign actually produced. */
export async function GET(req: Request) {
  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }
  const campaignId = new URL(req.url).searchParams.get('campaignId');

  const rows = await db.conversion.findMany({
    where: campaignId ? { campaignId } : { organizationId: ORG.id },
    orderBy: { occurredAt: 'desc' },
    take: 500,
  });

  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

  return NextResponse.json({
    ok: true,
    total: rows.length,
    // Reported separately and always. "12 quote requests, 8 we can trace to a
    // post" is honest; folding them together is not.
    attributed: rows.filter((r) => r.campaignId).length,
    unattributed: rows.filter((r) => !r.campaignId).length,
    valueCents: rows.reduce((s, r) => s + r.valueCents, 0),
    byKind,
  });
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
