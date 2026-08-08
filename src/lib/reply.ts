import { db } from './db';
import { getAccessToken } from './oauth/store';
import { mastodonContext } from './publishers/mastodon';
import { orgSenderFor } from './senders/registry';
import { recordCharge } from './billing';
import { suppressedAmong, normalizeAddress } from './suppression';
import { previewSms } from './sms';
import { SMS_RATES } from './pricing';

/**
 * The product's voice — the other half of Phase 15's ears.
 *
 * The inbox has shown "Do you service the north side?" since the listeners
 * landed, and offered a **"Mark replied" button that sends nothing**: a
 * status flag pretending to be a reply. Answering meant finding the same
 * message again in the platform's own app — five doors, after the product
 * promised one.
 *
 * Three channels can answer through what the product already holds:
 *
 * - **Mastodon** — a status with `in_reply_to_id`, which is the id the
 *   listener already stored in `externalRef`.
 * - **Bluesky** — a post record carrying `reply: { root, parent }` refs. The
 *   refs need the parent's `cid`, which notifications do not carry, so the
 *   post is fetched by its stored uri first — and the *thread root* is taken
 *   from the parent's own reply refs, because answering mid-thread with the
 *   parent as root would fork the conversation.
 * - **SMS** — a text through the same Twilio adapter campaigns use, charged
 *   through the same ledger with the same idempotency. **Suppression is
 *   checked first**: a customer who texted STOP after asking their question
 *   has withdrawn the invitation, and "they messaged us first" does not
 *   reopen it.
 *
 * Email conversations exist only in the seed today; the reply path says so
 * rather than pretending.
 */

export type ReplyResult =
  | { ok: true; providerRef: string | null }
  | { ok: false; error: string };

export async function sendReply(
  organizationId: string,
  conversationId: string,
  text: string
): Promise<ReplyResult> {
  const body = text.trim();
  if (!body) return { ok: false, error: 'There is nothing to send.' };

  const convo = await db.conversation.findFirst({
    where: { id: conversationId, organizationId },
  });
  if (!convo) return { ok: false, error: 'No such conversation.' };

  let out: ReplyResult;
  switch (convo.channel) {
    case 'MASTODON':
      out = await replyMastodon(convo.externalRef, body);
      break;
    case 'BLUESKY':
      out = await replyBluesky(convo.externalRef, body);
      break;
    case 'SMS':
      out = await replySms(organizationId, convo.fromAddress, body);
      break;
    default:
      out = {
        ok: false,
        error: `Replying on ${convo.channel.toLowerCase()} is not wired up yet — answer in the platform's own app.`,
      };
  }

  if (out.ok) {
    await db.conversation.update({
      where: { id: convo.id },
      data: { status: 'replied' },
    });
    await db.auditEvent.create({
      data: {
        organizationId,
        actorUserId: null,
        action: 'inbox.replied',
        target: convo.id,
        detail: `${convo.channel.toLowerCase()} reply to ${convo.fromName}: "${body.slice(0, 80)}"`,
      },
    });
  }
  return out;
}

async function replyMastodon(externalRef: string | null, body: string): Promise<ReplyResult> {
  const statusId = externalRef?.replace(/^mastodon:/, '');
  if (!statusId) return { ok: false, error: 'This conversation has no message to reply to.' };
  const ctx = mastodonContext();
  const token = getAccessToken('mastodon');
  if (!ctx || !token) return { ok: false, error: 'Mastodon is not connected.' };

  try {
    const scheme = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(ctx.host) ? 'http' : 'https';
    const res = await fetch(`${scheme}://${ctx.host}/api/v1/statuses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: body, in_reply_to_id: statusId, visibility: 'public' }),
    });
    const parsed = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok) return { ok: false, error: `${ctx.host} refused the reply: ${parsed.error ?? res.status}` };
    return { ok: true, providerRef: parsed.id ?? null };
  } catch (e) {
    return { ok: false, error: `Could not reach ${ctx.host}: ${(e as Error).message}` };
  }
}

async function replyBluesky(externalRef: string | null, body: string): Promise<ReplyResult> {
  const uri = externalRef?.replace(/^bluesky:/, '');
  if (!uri) return { ok: false, error: 'This conversation has no message to reply to.' };
  const token = getAccessToken('bluesky');
  if (!token) return { ok: false, error: 'Bluesky is not connected.' };
  const pds = (process.env.BLUESKY_PDS_URL || 'https://bsky.social').replace(/\/+$/, '');

  try {
    // The parent's cid, and the thread's true root. Using the parent as root
    // when it is itself a reply would fork the thread.
    const got = await fetch(`${pds}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!got.ok) return { ok: false, error: `The PDS returned ${got.status} looking up the post.` };
    const found = (await got.json()) as {
      posts?: { uri: string; cid: string; record?: { reply?: { root?: { uri: string; cid: string } } } }[];
    };
    const parent = found.posts?.[0];
    if (!parent) return { ok: false, error: 'That post is gone — there is nothing to reply to.' };
    const root = parent.record?.reply?.root ?? { uri: parent.uri, cid: parent.cid };

    const did = uriDid(uri);
    const ownDid = await sessionDid(pds, token);
    const res = await fetch(`${pds}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        repo: ownDid ?? did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text: body,
          reply: { root, parent: { uri: parent.uri, cid: parent.cid } },
          createdAt: new Date().toISOString(),
        },
      }),
    });
    const parsed = (await res.json().catch(() => ({}))) as { uri?: string; message?: string };
    if (!res.ok) return { ok: false, error: `Bluesky refused the reply: ${parsed.message ?? res.status}` };
    return { ok: true, providerRef: parsed.uri ?? null };
  } catch (e) {
    return { ok: false, error: `Could not reach the PDS: ${(e as Error).message}` };
  }
}

/** The repo a reply is written into is our own, from the stored grant. */
async function sessionDid(pds: string, token: string): Promise<string | null> {
  const { summaries } = await import('./oauth/store');
  const grant = summaries().find((g) => g.channel === 'bluesky');
  return grant?.externalAccountId ?? null;
}

function uriDid(uri: string): string {
  return uri.replace(/^at:\/\//, '').split('/')[0];
}

async function replySms(
  organizationId: string,
  fromAddress: string | null,
  body: string
): Promise<ReplyResult> {
  if (!fromAddress) {
    return { ok: false, error: 'This conversation predates reply support and carries no phone number.' };
  }

  // STOP means stop, even mid-conversation. The question arrived before the
  // opt-out or the row would not exist; the answer must still not be sent.
  const suppressed = await suppressedAmong(organizationId, 'sms', [fromAddress]);
  if (suppressed.has(normalizeAddress(fromAddress))) {
    return {
      ok: false,
      error: 'This person has opted out of texts since writing. The reply cannot be sent — call them if it matters.',
    };
  }

  const sender = await orgSenderFor(organizationId, 'sms');
  if (!sender) return { ok: false, error: 'No text messaging service is connected.' };

  // Priced the way a campaign message is priced: real segments at the real
  // rate, computed from the exact string that goes out.
  const preview = previewSms(body);
  const costCents = Math.max(1, Math.round(preview.segments * SMS_RATES.US.perSegmentCents));

  const deliveryId = `reply-${organizationId.slice(0, 8)}-${Math.random().toString(36).slice(2, 10)}`;
  const sent = await sender.send({ to: fromAddress, body: preview.fullText, deliveryId, costCents });
  if (!sent.ok) return { ok: false, error: sent.error ?? 'The carrier refused the message.' };

  // A reply costs the same money a campaign message does, and lands in the
  // same ledger with the same idempotency — a conversation is not a place
  // where cents stop counting.
  if (sent.providerRef) {
    await recordCharge({
      organizationId,
      brandId: null,
      channel: 'sms',
      providerRef: sent.providerRef,
      cents: costCents,
      units: sent.billedUnits ?? preview.segments,
      note: `Inbox reply to ${fromAddress}`,
    });
  }
  return { ok: true, providerRef: sent.providerRef ?? null };
}
