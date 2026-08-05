import { db } from '../db';
import { loadWorkspace } from '../queries';
import { preflight, type PreflightContext } from '../preflight';
import { publisherFor } from '../publishers/registry';

import type { PublishJobData } from './index';

/**
 * How long a claim is honoured before another worker may take the post.
 * Long enough that a slow platform call is never stolen mid-flight, short
 * enough that a killed worker doesn't strand a post until someone notices.
 */
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * What actually happens when a scheduled post comes due.
 *
 * Five things, in an order that is not arbitrary:
 *
 *   1. Claim the row, atomically. Two workers must never publish the same post.
 *   2. Re-run preflight *now*, not at approval time.
 *   3. Publish through the registry, with the slot's idempotency key.
 *   4. Record the attempt, win or lose.
 *   5. Set the status the owner will see, and leave a trail explaining it.
 */

export interface JobResult {
  status: 'published' | 'failed' | 'skipped';
  detail: string;
  /** Tells BullMQ whether another attempt is worth making. */
  retryable?: boolean;
}

/**
 * Errors worth another try. The distinction is the whole point of a retry
 * policy: a rate limit clears on its own, a revoked token never does, and
 * retrying the second one just burns the owner's time before they find out.
 */
function isRetryable(error: string, needsReconnect?: boolean): boolean {
  if (needsReconnect) return false;
  return /rate.?limit|timeout|network|fetch failed|temporar|5\d\d|ECONN|EAI_AGAIN/i.test(error);
}

export async function runPublishJob(data: PublishJobData): Promise<JobResult> {
  const { variationId, idempotencyKey } = data;

  // The worker has no session — it acts on behalf of the system. So the
  // organization comes from the row it is about to publish, which is the only
  // correct source once more than one tenant exists.
  const owner = await db.channelVariation.findUnique({
    where: { id: variationId },
    select: { contentItem: { select: { campaign: { select: { organizationId: true } } } } },
  });
  if (!owner) return { status: 'skipped', detail: 'variation missing' };
  const organizationId = owner.contentItem.campaign.organizationId;

  // 1 — Claim. `updateMany` with the expected state in the WHERE clause is a
  // compare-and-swap: whichever worker gets count 1 owns the job, the other
  // sees 0 and stops. A read-then-write here would double-post under
  // concurrency, which is the one bug this whole file exists to avoid.
  //
  // A claim older than the timeout is treated as abandoned, because a worker
  // killed mid-publish would otherwise strand the post forever.
  const stale = new Date(Date.now() - CLAIM_TIMEOUT_MS);
  const claimed = await db.channelVariation.updateMany({
    where: {
      id: variationId,
      status: { in: ['APPROVED', 'SCHEDULED'] },
      OR: [{ claimedAt: null }, { claimedAt: { lt: stale } }],
    },
    data: { claimedAt: new Date() },
  });
  if (claimed.count === 0) {
    const current = await db.channelVariation.findUnique({
      where: { id: variationId },
      select: { status: true, claimedAt: true },
    });
    // Already published, already claimed by a live worker, or moved back to
    // draft. This job has nothing left to do, and that is a success.
    return {
      status: 'skipped',
      detail: current
        ? `not claimable (status ${current.status}${current.claimedAt ? ', claimed' : ''})`
        : 'variation missing',
    };
  }

  const attemptNumber =
    (await db.publicationAttempt.count({ where: { idempotencyKey } })) + 1;
  const attempt = await db.publicationAttempt.create({
    data: { variationId, idempotencyKey, attemptNumber },
  });

  const finish = async (r: JobResult, extra: { code?: string; message?: string } = {}) => {
    await db.publicationAttempt.update({
      where: { id: attempt.id },
      data: {
        finishedAt: new Date(),
        success: r.status === 'published',
        errorCode: extra.code ?? null,
        errorMessage: extra.message ?? null,
        willRetry: r.retryable ?? false,
      },
    });
    return r;
  };

  try {
    // 2 — Preflight, again, now. An approval is a statement about the post at
    // the moment it was approved. Between then and firing, a connection can
    // expire, media can be deleted, a campaign can end. Publishing on a stale
    // approval is how a product posts something the owner would not have
    // approved today.
    const w = await loadWorkspace(organizationId);
    const v = w.variations.find((x) => x.id === variationId);
    if (!v) return finish({ status: 'failed', detail: 'variation vanished mid-flight' });

    const campaign = w.campaigns.find((c) => c.id === v.campaignId);
    if (!campaign) {
      await db.channelVariation.update({
        where: { id: variationId },
        data: { status: 'FAILED', claimedAt: null },
      });
      return finish({ status: 'failed', detail: 'no campaign for this post' });
    }

    const ctx: PreflightContext = {
      campaign,
      assets: w.media.filter((m) => v.mediaIds.includes(m.id)),
      accounts: w.accounts,
      allVariations: w.variations,
      campaigns: w.campaigns,
      // Real time, not the demo clock: the worker lives in the present.
      today: new Date().toISOString().slice(0, 10),
    };
    const blockers = preflight({ ...v, status: 'scheduled' }, ctx).filter((x) => x.severity === 'block');
    if (blockers.length > 0) {
      await db.channelVariation.update({
        where: { id: variationId },
        data: { status: 'FAILED', claimedAt: null },
      });
      await db.auditEvent.create({
        data: {
          organizationId, actorUserId: null, action: 'publish.blocked',
          target: variationId, detail: blockers.map((b) => b.message).join('; '),
        },
      });
      return finish(
        { status: 'failed', detail: `blocked at fire time: ${blockers[0].message}` },
        { code: 'preflight_block', message: blockers.map((b) => b.message).join('; ') }
      );
    }

    // 3 — Publish.
    const publisher = publisherFor(v.channel);
    if (!publisher) {
      await db.channelVariation.update({
        where: { id: variationId },
        data: { status: 'FAILED', claimedAt: null },
      });
      return finish(
        { status: 'failed', detail: `no publisher for ${v.channel}` },
        { code: 'not_implemented', message: `Live publishing for ${v.channel} is not wired up yet.` }
      );
    }

    const text = [v.body, v.hashtags.join(' ')].filter(Boolean).join('\n\n');
    const out = await publisher.publish(text, { idempotencyKey });

    if (!out.ok) {
      const retryable = isRetryable(out.error ?? '', out.needsReconnect);
      await db.channelVariation.update({
        where: { id: variationId },
        // A retryable failure goes back to SCHEDULED so the next attempt can
        // claim it; a terminal one stops here and surfaces to the owner.
        // Either way the claim is released — holding it would block the retry
        // this very line just asked for.
        data: { status: retryable ? 'SCHEDULED' : 'FAILED', claimedAt: null },
      });
      await db.auditEvent.create({
        data: {
          organizationId, actorUserId: null, action: 'publish.failed',
          target: variationId, detail: out.error ?? 'unknown error',
        },
      });
      return finish(
        { status: 'failed', detail: out.error ?? 'publish failed', retryable },
        { code: out.needsReconnect ? 'auth_expired' : 'publish_error', message: out.error ?? 'Publish failed.' }
      );
    }

    // 4/5 — It went out. Record where, and say so.
    const now = new Date();
    await db.channelVariation.update({
      where: { id: variationId },
      data: { status: 'PUBLISHED', publishedAt: now, claimedAt: null },
    });
    await db.publishedPost.upsert({
      where: { variationId },
      create: { variationId, externalId: out.id ?? idempotencyKey, url: out.url, publishedAt: now },
      update: { externalId: out.id ?? idempotencyKey, url: out.url, publishedAt: now },
    });
    await db.auditEvent.create({
      data: {
        organizationId, actorUserId: null, action: 'publish.succeeded',
        target: variationId, detail: out.url ?? out.id ?? 'published',
      },
    });
    return finish({ status: 'published', detail: out.url ?? out.id ?? 'published' });
  } catch (e) {
    const message = (e as Error).message;
    const retryable = isRetryable(message);
    // Release the claim on the way out. The timeout would eventually free it
    // anyway, but "eventually" is ten minutes the owner spends staring at a
    // post that looks stuck.
    await db.channelVariation.update({
      where: { id: variationId },
      data: { status: retryable ? 'SCHEDULED' : 'FAILED', claimedAt: null },
    });
    return finish({ status: 'failed', detail: message, retryable }, { code: 'worker_error', message });
  }
}
