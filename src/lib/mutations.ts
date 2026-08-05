import { db } from './db';
import type { Channel, Conversation, VariationStatus } from './types';

/**
 * The write path: durable actions → Prisma writes.
 *
 * The reducer stays exactly as it was. It is the optimistic local model, and
 * it is why dragging a card feels instant — an `await` in that path would make
 * the whole app feel worse to use. This module is the sidecar that mirrors the
 * same actions into Postgres, so the two agree after a reload.
 *
 * Mirroring means mirroring *precisely*. Where the reducer derives something —
 * reschedule keeping the existing time of day, approval flipping the pending
 * Approval row — the server has to derive it the same way, or the optimistic
 * UI and the durable truth drift apart in a way nobody notices until they
 * reload and lose work.
 */

/** 'YYYY-MM-DDTHH:mm' → Date, read as UTC exactly like the seed writes it. */
const at = (s: string): Date => new Date(s.length > 10 ? `${s}:00Z` : `${s}T00:00:00Z`);
const upper = <T,>(s: string): T => s.toUpperCase() as T;

/**
 * Actions worth persisting. Deliberately a separate union from the store's
 * `Action`: some actions are UI-only (`setBrand`), some are internal
 * (`hydrate`), and some belong to the publish worker rather than the browser
 * (`startJobs`, `advanceJob`). Naming the durable set here keeps that judgement
 * in one reviewable place instead of scattered `if` statements.
 */
export type Mutation =
  | { type: 'reschedule'; variationId: string; dateKey: string }
  | { type: 'setScheduledAt'; variationId: string; scheduledAt: string | null }
  | { type: 'setStatus'; variationId: string; status: VariationStatus }
  | { type: 'bulkSetStatus'; variationIds: string[]; status: VariationStatus }
  | { type: 'updateVariation'; variationId: string; patch: Record<string, unknown> }
  | { type: 'setAltText'; mediaId: string; altText: string }
  | { type: 'conversationStatus'; conversationId: string; status: Conversation['status'] }
  | { type: 'toggleDestination'; destinationId: string }
  | { type: 'mapDestination'; destinationId: string; brandId: string | null }
  | { type: 'reconnect'; accountId: string }
  | { type: 'connectAccount'; accountId: string; destinationIds: string[] }
  | { type: 'discoverDestinations'; accountId: string; channel: Channel; found: DiscoveredDestination[] }
  | { type: 'duplicateVariation'; sourceId: string; newId: string; scheduledAt: string | null };

export interface DiscoveredDestination {
  id: string;
  name: string;
  kind: string;
  externalId: string;
  followers: number | null;
  issues: string[];
  hue: number;
}

export const DURABLE = new Set<string>([
  'reschedule', 'setScheduledAt', 'setStatus', 'bulkSetStatus', 'updateVariation',
  'setAltText', 'conversationStatus', 'toggleDestination', 'mapDestination',
  'reconnect', 'connectAccount', 'discoverDestinations', 'duplicateVariation',
]);

/**
 * Fields a client is allowed to patch on a variation.
 *
 * A server route that spreads `patch` straight into `update` lets anyone set
 * anything — status, publishedAt, the account it publishes through. These are
 * the fields the composer actually edits; everything else moves through its own
 * action, where the rules live.
 */
const PATCHABLE = new Set([
  'body', 'subject', 'preheader', 'hashtags', 'hasUnsubscribeFooter', 'format', 'assigneeUserId',
]);

const auditRow = (organizationId: string, action: string, target: string, detail: string) =>
  db.auditEvent.create({
    data: { organizationId, actorUserId: 'u-dana', action, target, detail },
  });

export async function applyMutation(organizationId: string, m: Mutation): Promise<void> {
  switch (m.type) {
    case 'reschedule': {
      // The reducer keeps the existing time of day and only moves the date;
      // re-reading the row is how the server learns what that time was.
      const v = await db.channelVariation.findUnique({
        where: { id: m.variationId },
        select: { scheduledAt: true, status: true },
      });
      if (!v) throw new Error(`no variation ${m.variationId}`);
      const time = v.scheduledAt ? v.scheduledAt.toISOString().slice(11, 16) : '12:00';
      await db.channelVariation.update({
        where: { id: m.variationId },
        data: {
          scheduledAt: new Date(`${m.dateKey}T${time}:00Z`),
          // An idea that gets a date has stopped being an idea.
          ...(v.status === 'IDEA' ? { status: 'DRAFT' as const } : {}),
        },
      });
      return;
    }

    case 'setScheduledAt':
      await db.channelVariation.update({
        where: { id: m.variationId },
        data: { scheduledAt: m.scheduledAt ? at(m.scheduledAt) : null },
      });
      return;

    case 'setStatus':
      await db.channelVariation.update({
        where: { id: m.variationId },
        data: { status: upper(m.status) },
      });
      // Approving a post is also a decision on its pending approval request.
      // Two rows, one user action; missing the second leaves the approvals
      // queue showing work that is already done.
      if (m.status === 'approved') {
        await db.approval.updateMany({
          where: { variationId: m.variationId, decision: 'PENDING' },
          data: { decision: 'APPROVED', decidedAt: new Date() },
        });
      }
      return;

    case 'bulkSetStatus':
      await db.channelVariation.updateMany({
        where: { id: { in: m.variationIds } },
        data: { status: upper(m.status) },
      });
      return;

    case 'updateVariation': {
      const data: Record<string, unknown> = { overridden: true };
      for (const [k, val] of Object.entries(m.patch)) {
        if (!PATCHABLE.has(k)) continue;
        // The domain calls it assigneeUserId; the column is assigneeId.
        data[k === 'assigneeUserId' ? 'assigneeId' : k] = val;
      }
      await db.channelVariation.update({ where: { id: m.variationId }, data });
      return;
    }

    case 'setAltText':
      await db.mediaAsset.update({ where: { id: m.mediaId }, data: { altText: m.altText } });
      return;

    case 'conversationStatus':
      await db.conversation.update({ where: { id: m.conversationId }, data: { status: m.status } });
      return;

    case 'toggleDestination': {
      // Read-then-write rather than a raw `NOT enabled`, because the client
      // sent an intent to flip, not a target value.
      const d = await db.publishDestination.findUnique({
        where: { id: m.destinationId },
        select: { enabled: true },
      });
      if (!d) throw new Error(`no destination ${m.destinationId}`);
      await db.publishDestination.update({
        where: { id: m.destinationId },
        data: { enabled: !d.enabled },
      });
      return;
    }

    case 'mapDestination':
      await db.publishDestination.update({
        where: { id: m.destinationId },
        data: { brandId: m.brandId },
      });
      return;

    case 'reconnect':
      await db.connectedAccount.update({
        where: { id: m.accountId },
        data: { status: 'CONNECTED', expiresAt: new Date('2026-12-06T00:00:00Z'), lastSyncAt: new Date() },
      });
      await auditRow(organizationId, 'connection.restored', m.accountId, 'Reconnected by Dana Reyes.');
      return;

    case 'connectAccount':
      await db.connectedAccount.update({
        where: { id: m.accountId },
        data: { status: 'CONNECTED', expiresAt: new Date('2027-02-01T00:00:00Z'), lastSyncAt: new Date() },
      });
      // Selecting destinations during connect is the same switch as toggling
      // them later, so it lands in the same column.
      await db.publishDestination.updateMany({
        where: { accountId: m.accountId },
        data: { enabled: false },
      });
      if (m.destinationIds.length > 0) {
        await db.publishDestination.updateMany({
          where: { id: { in: m.destinationIds } },
          data: { enabled: true },
        });
      }
      await auditRow(organizationId, 'connection.created', m.accountId,
        `${m.destinationIds.length} destination${m.destinationIds.length === 1 ? '' : 's'} enabled.`);
      return;

    case 'discoverDestinations': {
      // Authorizing twice must not duplicate the list — same guard the reducer
      // uses, enforced here because the client can always be raced.
      const existing = await db.publishDestination.count({ where: { accountId: m.accountId } });
      if (existing > 0) return;
      await db.publishDestination.createMany({
        data: m.found.map((d) => ({
          id: d.id, accountId: m.accountId, channel: upper(m.channel), name: d.name,
          kind: d.kind, externalId: d.externalId, brandId: null, enabled: false,
          followers: d.followers, issues: d.issues, hue: d.hue,
        })),
        skipDuplicates: true,
      });
      return;
    }

    case 'duplicateVariation': {
      const src = await db.channelVariation.findUnique({
        where: { id: m.sourceId },
        include: { media: { orderBy: { position: 'asc' } } },
      });
      if (!src) throw new Error(`no variation ${m.sourceId}`);
      const { id, createdAt, updatedAt, media, ...rest } = src as typeof src & {
        createdAt?: Date; updatedAt?: Date;
      };
      void id; void createdAt; void updatedAt;
      await db.channelVariation.create({
        data: {
          ...rest,
          id: m.newId,
          status: 'DRAFT',
          publishedAt: null,
          scheduledAt: m.scheduledAt ? at(m.scheduledAt) : null,
        },
      });
      if (media.length > 0) {
        await db.variationMedia.createMany({
          data: media.map((x) => ({ variationId: m.newId, assetId: x.assetId, position: x.position })),
        });
      }
      return;
    }
  }
}
