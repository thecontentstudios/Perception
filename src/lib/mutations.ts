import { db } from './db';
import type { Channel, Conversation, VariationStatus } from './types';
import type { Principal } from './auth/session';

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
 *
 * **Every write is scoped to the caller's organization.** Authentication only
 * answers "who are you"; it does not stop a signed-in customer from passing
 * somebody else's variation id. Each `own*` helper below re-reads the row
 * through its organization, so an id belonging to another tenant resolves to
 * nothing and the mutation fails as "not found" — which is also the right
 * thing to say, since confirming the id exists is itself a disclosure.
 */

export class NotFound extends Error {
  constructor(what: string) {
    super(`${what} could not be found.`);
  }
}

/** A variation, but only if it belongs to this organization. */
async function ownVariation(org: string, id: string) {
  const v = await db.channelVariation.findFirst({
    where: { id, contentItem: { campaign: { organizationId: org } } },
    select: { id: true, scheduledAt: true, status: true, body: true, hashtags: true },
  });
  if (!v) throw new NotFound('That post');
  return v;
}

async function ownVariationIds(org: string, ids: string[]): Promise<string[]> {
  const rows = await db.channelVariation.findMany({
    where: { id: { in: ids }, contentItem: { campaign: { organizationId: org } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function ownDestination(org: string, id: string) {
  const d = await db.publishDestination.findFirst({
    where: { id, account: { organizationId: org } },
    select: { id: true, enabled: true },
  });
  if (!d) throw new NotFound('That destination');
  return d;
}

async function ownAccount(org: string, id: string) {
  const a = await db.connectedAccount.findFirst({ where: { id, organizationId: org }, select: { id: true } });
  if (!a) throw new NotFound('That connection');
  return a;
}

/** A brand id supplied by the client has to be one of ours, or null. */
async function ownBrandId(org: string, brandId: string | null): Promise<string | null> {
  if (!brandId) return null;
  const b = await db.brand.findFirst({ where: { id: brandId, organizationId: org }, select: { id: true } });
  if (!b) throw new NotFound('That business');
  return b.id;
}

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

const auditRow = (p: Principal, action: string, target: string, detail: string) =>
  db.auditEvent.create({
    data: { organizationId: p.organizationId, actorUserId: p.userId, action, target, detail },
  });

export async function applyMutation(p: Principal, m: Mutation): Promise<void> {
  const org = p.organizationId;
  switch (m.type) {
    case 'reschedule': {
      // The reducer keeps the existing time of day and only moves the date;
      // re-reading the row is how the server learns what that time was.
      const v = await ownVariation(org, m.variationId);
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
      await ownVariation(org, m.variationId);
      await db.channelVariation.update({
        where: { id: m.variationId },
        data: { scheduledAt: m.scheduledAt ? at(m.scheduledAt) : null },
      });
      return;

    case 'setStatus':
      await ownVariation(org, m.variationId);
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
          // Who signed it off, recorded on the row rather than inferred later.
          data: { decision: 'APPROVED', decidedAt: new Date(), approverId: p.userId },
        });
      }
      return;

    case 'bulkSetStatus': {
      // Filter rather than reject: a bulk action over a stale selection should
      // do the part it legitimately can, not fail wholesale.
      const ids = await ownVariationIds(org, m.variationIds);
      if (ids.length === 0) throw new NotFound('Those posts');
      await db.channelVariation.updateMany({
        where: { id: { in: ids } },
        data: { status: upper(m.status) },
      });
      return;
    }

    case 'updateVariation': {
      await ownVariation(org, m.variationId);
      const data: Record<string, unknown> = { overridden: true };
      for (const [k, val] of Object.entries(m.patch)) {
        if (!PATCHABLE.has(k)) continue;
        // The domain calls it assigneeUserId; the column is assigneeId.
        data[k === 'assigneeUserId' ? 'assigneeId' : k] = val;
      }
      await db.channelVariation.update({ where: { id: m.variationId }, data });
      return;
    }

    case 'setAltText': {
      const { count } = await db.mediaAsset.updateMany({
        where: { id: m.mediaId, organizationId: org },
        data: { altText: m.altText },
      });
      if (count === 0) throw new NotFound('That image');
      return;
    }

    case 'conversationStatus': {
      const { count } = await db.conversation.updateMany({
        where: { id: m.conversationId, organizationId: org },
        data: { status: m.status },
      });
      if (count === 0) throw new NotFound('That message');
      return;
    }

    case 'toggleDestination': {
      // Read-then-write rather than a raw `NOT enabled`, because the client
      // sent an intent to flip, not a target value.
      const d = await ownDestination(org, m.destinationId);
      await db.publishDestination.update({
        where: { id: m.destinationId },
        data: { enabled: !d.enabled },
      });
      return;
    }

    case 'mapDestination':
      await ownDestination(org, m.destinationId);
      await db.publishDestination.update({
        where: { id: m.destinationId },
        // The brand has to be ours too — otherwise a destination could be
        // mapped into another tenant's business.
        data: { brandId: await ownBrandId(org, m.brandId) },
      });
      return;

    case 'reconnect':
      await ownAccount(org, m.accountId);
      await db.connectedAccount.update({
        where: { id: m.accountId },
        data: { status: 'CONNECTED', expiresAt: new Date('2026-12-06T00:00:00Z'), lastSyncAt: new Date() },
      });
      await auditRow(p, 'connection.restored', m.accountId, `Reconnected by ${p.name}.`);
      return;

    case 'connectAccount':
      await ownAccount(org, m.accountId);
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
      await auditRow(p, 'connection.created', m.accountId,
        `${m.destinationIds.length} destination${m.destinationIds.length === 1 ? '' : 's'} enabled.`);
      return;

    case 'discoverDestinations': {
      // Authorizing twice must not duplicate the list — same guard the reducer
      // uses, enforced here because the client can always be raced.
      await ownAccount(org, m.accountId);
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
      await ownVariation(org, m.sourceId);
      const src = await db.channelVariation.findUnique({
        where: { id: m.sourceId },
        include: { media: { orderBy: { position: 'asc' } } },
      });
      if (!src) throw new NotFound('That post');
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
