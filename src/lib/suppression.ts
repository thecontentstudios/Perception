import { db } from './db';
import type { Channel } from './types';

/**
 * Addresses we must never send to again.
 *
 * The consequence of getting this wrong is not the one message. Mailbox
 * providers score a sender on how often they mail addresses that bounce or
 * complain, and the score decides whether *everything else* reaches an inbox
 * or a spam folder. So re-mailing one hard bounce is not a small error with a
 * small cost — it is a small error that degrades every future campaign, on a
 * timescale where the damage shows up weeks after the cause.
 *
 * The preflight has warned about sending reputation since Phase 1. This is
 * the first thing in the codebase that actually protects it.
 */

export type SuppressionReason = 'bounce' | 'complaint' | 'unsubscribe' | 'manual';

/** Lower-cased and trimmed, so a lookup cannot miss on case or a stray space. */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Add an address to the list. Idempotent — the same bounce arriving twice is
 * normal, and the second one is not an error.
 */
export async function suppress(args: {
  organizationId: string;
  channel: Channel;
  address: string;
  reason: SuppressionReason;
  detail?: string;
}): Promise<'added' | 'already-suppressed'> {
  const { count } = await db.suppression.createMany({
    data: [
      {
        organizationId: args.organizationId,
        channel: args.channel.toUpperCase() as never,
        address: normalizeAddress(args.address),
        reason: args.reason,
        detail: args.detail,
      },
    ],
    skipDuplicates: true,
  });
  return count === 1 ? 'added' : 'already-suppressed';
}

/**
 * Remove an address — only ever at the owner's explicit request.
 *
 * Exists because a suppression can be wrong: a temporary outage at a mailbox
 * provider can look like a hard bounce, and a customer who re-subscribes in
 * person should not be permanently unreachable. It is not called by anything
 * automatic, and it should not be.
 */
export async function unsuppress(organizationId: string, channel: Channel, address: string): Promise<boolean> {
  const { count } = await db.suppression.deleteMany({
    where: { organizationId, channel: channel.toUpperCase() as never, address: normalizeAddress(address) },
  });
  return count > 0;
}

/**
 * The suppressed subset of a list of addresses.
 *
 * One query for the whole audience rather than one per recipient: a
 * thousand-recipient send would otherwise open a thousand round trips at the
 * exact moment the owner is watching a progress bar.
 */
export async function suppressedAmong(
  organizationId: string,
  channel: Channel,
  addresses: string[]
): Promise<Set<string>> {
  if (addresses.length === 0) return new Set();
  const rows = await db.suppression.findMany({
    where: {
      organizationId,
      channel: channel.toUpperCase() as never,
      address: { in: addresses.map(normalizeAddress) },
    },
    select: { address: true },
  });
  return new Set(rows.map((r) => r.address));
}

/** Whether one address is suppressed — the dispatcher's last line of defence. */
export async function isSuppressed(organizationId: string, channel: Channel, address: string): Promise<boolean> {
  const row = await db.suppression.findUnique({
    where: {
      organizationId_channel_address: {
        organizationId,
        channel: channel.toUpperCase() as never,
        address: normalizeAddress(address),
      },
    },
    select: { id: true },
  });
  return row !== null;
}
