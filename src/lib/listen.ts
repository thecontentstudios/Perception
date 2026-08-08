import { db } from './db';
import { getAccessToken, summaries } from './oauth/store';
import { mastodonContext } from './publishers/mastodon';

/**
 * The product's ears.
 *
 * Publishing without listening is a megaphone. The inbox has been able to
 * *hold* social conversations since the first schema — `Conversation` has a
 * channel, a kind, an excerpt — and for eleven phases the only thing that
 * ever wrote one was an SMS webhook and the seed. A Mastodon reply or a
 * Bluesky mention happened in the world and nowhere else: the owner answered
 * the phone but not the door.
 *
 * This polls rather than subscribing, deliberately. Webhooks need a public
 * address, per-platform registration, and secret rotation; a poll every few
 * minutes through the grants we already hold needs nothing and loses only
 * latency a small business does not feel. **Idempotency comes from the
 * platform's own ids** carried in `externalRef` — polling twice cannot write
 * twice, which also means there is no cursor state to corrupt: the poll is
 * safe to run from zero at any time.
 *
 * A like is deliberately not a conversation. Someone pressing a heart is
 * real, and it is engagement — the metrics reader counts it. A row in the
 * inbox asks the owner to *respond*, and responding to a like is not a thing.
 */

export interface ListenResult {
  checked: ('mastodon' | 'bluesky')[];
  created: number;
  /** Notifications seen and already in the inbox — the idempotent path. */
  duplicates: number;
  errors: { channel: string; error: string }[];
}

export async function pollSocialInbox(organizationId: string): Promise<ListenResult> {
  const out: ListenResult = { checked: [], created: 0, duplicates: 0, errors: [] };

  const connected = new Set(summaries().map((g) => g.channel));

  if (connected.has('mastodon')) {
    out.checked.push('mastodon');
    await pollMastodon(organizationId, out);
  }
  if (connected.has('bluesky')) {
    out.checked.push('bluesky');
    await pollBluesky(organizationId, out);
  }

  // The visible last-run. A poll that runs silently is indistinguishable
  // from a poll that stopped running three weeks ago.
  await db.auditEvent.create({
    data: {
      organizationId,
      actorUserId: null,
      action: 'inbox.polled',
      target: out.checked.join(',') || 'nothing-connected',
      detail: `${out.created} new, ${out.duplicates} already seen${out.errors.length ? `, ${out.errors.length} errors` : ''}`,
    },
  });

  return out;
}

/** Write one conversation unless its platform id is already in the inbox. */
async function record(
  organizationId: string,
  out: ListenResult,
  row: {
    channel: 'MASTODON' | 'BLUESKY';
    kind: string;
    fromName: string;
    fromAddress: string | null;
    externalRef: string;
    excerpt: string;
    receivedAt: Date;
  }
): Promise<void> {
  const existing = await db.conversation.findFirst({
    where: { organizationId, externalRef: row.externalRef },
    select: { id: true },
  });
  if (existing) {
    out.duplicates += 1;
    return;
  }
  await db.conversation.create({ data: { organizationId, status: 'open', ...row } });
  out.created += 1;
}

async function pollMastodon(organizationId: string, out: ListenResult): Promise<void> {
  const ctx = mastodonContext();
  const token = getAccessToken('mastodon');
  if (!ctx || !token) return;

  try {
    const scheme = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(ctx.host) ? 'http' : 'https';
    const res = await fetch(`${scheme}://${ctx.host}/api/v1/notifications?limit=30`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      out.errors.push({ channel: 'mastodon', error: `${ctx.host} returned ${res.status}` });
      return;
    }
    const items = (await res.json()) as {
      id: string;
      type: string;
      created_at?: string;
      account?: { display_name?: string; acct?: string };
      status?: { id: string; content?: string };
    }[];

    for (const n of items) {
      // Mentions and replies both arrive as type "mention" — a reply to your
      // status mentions you. Favourites and boosts are engagement, not mail.
      if (n.type !== 'mention' || !n.status) continue;
      await record(organizationId, out, {
        channel: 'MASTODON',
        kind: 'mention',
        fromName: n.account?.display_name || n.account?.acct || 'Someone on Mastodon',
        fromAddress: n.account?.acct ? `@${n.account.acct}` : null,
        externalRef: `mastodon:${n.status.id}`,
        excerpt: stripHtml(n.status.content ?? '').slice(0, 280),
        receivedAt: n.created_at ? new Date(n.created_at) : new Date(),
      });
    }
  } catch (e) {
    out.errors.push({ channel: 'mastodon', error: (e as Error).message });
  }
}

async function pollBluesky(organizationId: string, out: ListenResult): Promise<void> {
  const token = getAccessToken('bluesky');
  if (!token) return;
  const pds = (process.env.BLUESKY_PDS_URL || 'https://bsky.social').replace(/\/+$/, '');

  try {
    const res = await fetch(`${pds}/xrpc/app.bsky.notification.listNotifications?limit=30`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      // An expired access JWT lands here; the next publish refreshes the
      // session and the next poll succeeds. Losing one cycle is the cost of
      // not duplicating the refresh dance outside the publisher.
      out.errors.push({ channel: 'bluesky', error: `PDS returned ${res.status}` });
      return;
    }
    const body = (await res.json()) as {
      notifications?: {
        uri: string;
        reason: string;
        indexedAt?: string;
        author?: { displayName?: string; handle?: string };
        record?: { text?: string };
      }[];
    };

    for (const n of body.notifications ?? []) {
      // Replies, mentions and quotes carry words addressed at the owner.
      // Likes, reposts and follows are counted by the metrics reader instead.
      if (!['reply', 'mention', 'quote'].includes(n.reason)) continue;
      await record(organizationId, out, {
        channel: 'BLUESKY',
        kind: n.reason === 'reply' ? 'comment' : 'mention',
        fromName: n.author?.displayName || n.author?.handle || 'Someone on Bluesky',
        fromAddress: n.author?.handle ? `@${n.author.handle}` : null,
        externalRef: `bluesky:${n.uri}`,
        excerpt: (n.record?.text ?? '').slice(0, 280),
        receivedAt: n.indexedAt ? new Date(n.indexedAt) : new Date(),
      });
    }
  } catch (e) {
    out.errors.push({ channel: 'bluesky', error: (e as Error).message });
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
