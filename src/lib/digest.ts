import { db } from './db';
import { driftReport } from './flights';
import { learn } from './learning';
import { orgSenderFor } from './senders/registry';

/**
 * The week, on one page, in the language the product already speaks.
 *
 * Everything here is computed elsewhere and merely composed: sends and their
 * delivery, money split exact/estimated (never blended — the ledger's oldest
 * rule survives summarisation), what came back, one learning, one next
 * action. An owner who reads this once a week knows what happened, what it
 * cost, and the single next thing worth doing — without opening five screens
 * to reconstruct it.
 *
 * The digest declines to pad. A quiet week reads as a quiet week: "nothing
 * went out" is information, and inventing an insight to fill the space would
 * spend the trust every other sentence depends on.
 */

export interface Digest {
  windowDays: number;
  wentOut: { posts: number; emailsDelivered: number; textsDelivered: number; flightsHandedOff: number };
  cost: { exactCents: number; estimatedCents: number };
  cameBack: { conversions: number; revenueCents: number; clicks: number; repliesWaiting: number };
  learning: string;
  nextAction: { label: string; href: string };
  text: string;
}

export async function composeDigest(organizationId: string, days = 7): Promise<Digest> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const [posts, emails, texts, flights, spend, conversions, clicks, replies, learned, drift] = await Promise.all([
    db.publishedPost.count({
      where: { publishedAt: { gte: since }, variation: { contentItem: { campaign: { organizationId } } } },
    }),
    db.emailDelivery.count({
      where: { sentAt: { gte: since }, status: { in: ['DELIVERED', 'OPENED', 'CLICKED'] }, contact: { organizationId } },
    }),
    db.smsDelivery.count({
      where: { sentAt: { gte: since }, status: { in: ['DELIVERED', 'OPENED', 'CLICKED'] }, contact: { organizationId } },
    }),
    db.adFlight.count({ where: { organizationId, handedOffAt: { gte: since } } }),
    db.spendEntry.groupBy({
      by: ['certainty' as const],
      where: { organizationId, occurredAt: { gte: since } },
      _sum: { cents: true },
    }),
    db.conversion.findMany({
      where: { organizationId, occurredAt: { gte: since } },
      select: { valueCents: true },
    }),
    db.linkClick.count({ where: { clickedAt: { gte: since }, link: { campaign: { organizationId } } } }),
    db.conversation.count({ where: { organizationId, status: 'open' } }),
    learn(organizationId).catch(() => null),
    driftReport(organizationId).catch(() => null),
  ]);

  const exactCents = spend.find((s) => s.certainty === 'exact')?._sum.cents ?? 0;
  const estimatedCents = spend.find((s) => s.certainty === 'estimated')?._sum.cents ?? 0;

  // One learning, by precedence: a real finding beats the drift grade beats
  // an honest "not enough happened". Never more than one — a digest that
  // lists everything teaches nothing.
  const learning =
    learned && learned.findings.length > 0
      ? learned.findings[0].sentence
      : drift && drift.meanAbsDrift !== null
        ? drift.verdict
        : 'Not enough happened this week to learn from — which is itself worth knowing.';

  // One next action, by urgency: replies are people waiting; then setup-ish
  // gaps; then the default motion of the product.
  const nextAction =
    replies > 0
      ? { label: `${replies} ${replies === 1 ? 'reply is' : 'replies are'} waiting — answer them first`, href: '/inbox' }
      : posts + emails + texts === 0
        ? { label: 'Nothing went out this week — plan next week from the pathway', href: '/advertise' }
        : { label: 'Plan next week from the calendar', href: '/calendar' };

  const revenueCents = conversions.reduce((a, c) => a + c.valueCents, 0);
  const $ = (c: number) => `$${(c / 100).toFixed(2)}`;

  const text = [
    `YOUR WEEK — the last ${days} days`,
    ``,
    `WENT OUT`,
    `  ${posts} social ${posts === 1 ? 'post' : 'posts'} · ${emails.toLocaleString('en-US')} emails delivered · ${texts.toLocaleString('en-US')} texts delivered · ${flights} ad ${flights === 1 ? 'flight' : 'flights'} handed off`,
    ``,
    `COST`,
    `  ${$(exactCents)} exact${estimatedCents > 0 ? ` · ~${$(estimatedCents)} estimated (settles with invoices)` : ''}`,
    ``,
    `CAME BACK`,
    `  ${conversions.length} ${conversions.length === 1 ? 'result' : 'results'}${revenueCents > 0 ? ` worth ${$(revenueCents)}` : ''} · ${clicks.toLocaleString('en-US')} clicks on your links${replies > 0 ? ` · ${replies} ${replies === 1 ? 'reply' : 'replies'} waiting in the inbox` : ''}`,
    ``,
    `ONE THING WE LEARNED`,
    `  ${learning}`,
    ``,
    `NEXT`,
    `  ${nextAction.label}`,
  ].join('\n');

  return {
    windowDays: days,
    wentOut: { posts, emailsDelivered: emails, textsDelivered: texts, flightsHandedOff: flights },
    cost: { exactCents, estimatedCents },
    cameBack: { conversions: conversions.length, revenueCents, clicks, repliesWaiting: replies },
    learning,
    nextAction,
    text,
  };
}

/** Email the digest through the org's own sender — the same path campaigns use. */
export async function emailDigest(
  organizationId: string,
  to: string
): Promise<{ ok: boolean; error?: string }> {
  const sender = await orgSenderFor(organizationId, 'email');
  if (!sender) return { ok: false, error: 'No email sending service is connected.' };
  const digest = await composeDigest(organizationId);
  const sent = await sender.send({
    deliveryId: `digest-${Date.now().toString(36)}`,
    to,
    subject: 'Your week, on one page',
    body: digest.text,
    costCents: 0,
  });
  return sent.ok ? { ok: true } : { ok: false, error: sent.error ?? 'The provider refused it.' };
}
