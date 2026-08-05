import { db, dbAvailable } from '../db';

import type { Channel } from '../types';

/**
 * Keep the workspace row and the stored grant telling the same story.
 *
 * Two things independently claim to know whether a channel is connected: the
 * `ConnectedAccount` row that every screen and preflight reads, and the token
 * store the publisher actually uses. Until now only the second was written on
 * connect, and the gap was invisible right up until the worker ran preflight
 * at fire time and refused to publish through a live token because the row
 * still said `NOT_CONNECTED`.
 *
 * That is the correct behaviour from preflight and the wrong state to be in.
 * A grant landing is the moment to reconcile, so it happens here, once, for
 * every connect path.
 */
export async function reconcileAccount(input: {
  organizationId: string;
  connectedById?: string | null;
  channel: Channel;
  accountLabel: string;
  externalAccountId: string;
  scopes: string[];
  expiresAt: number | null;
}): Promise<void> {
  if (!(await dbAvailable())) return;

  const data = {
    status: 'CONNECTED' as const,
    displayName: input.accountLabel,
    scopes: input.scopes,
    lastSyncAt: new Date(),
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
  };

  try {
    const existing = await db.connectedAccount.findFirst({
      where: { organizationId: input.organizationId, channel: input.channel.toUpperCase() as never },
    });
    if (existing) {
      await db.connectedAccount.update({ where: { id: existing.id }, data });
      return;
    }
    await db.connectedAccount.create({
      data: {
        ...data,
        organizationId: input.organizationId,
        channel: input.channel.toUpperCase() as never,
        destinationKind: 'Account',
        connectedById: input.connectedById ?? null,
      },
    });
  } catch {
    // A failed reconcile must never break the connect flow itself — the grant
    // is already stored and the person is mid-redirect. The next connect, or
    // a reconnect from Connections, fixes the row.
  }
}

/** The mirror image: disconnecting has to update both halves too. */
export async function reconcileDisconnect(organizationId: string, channel: Channel): Promise<void> {
  if (!(await dbAvailable())) return;
  try {
    await db.connectedAccount.updateMany({
      where: { organizationId, channel: channel.toUpperCase() as never },
      data: { status: 'NOT_CONNECTED', lastSyncAt: new Date() },
    });
  } catch {
    /* same reasoning as above */
  }
}
