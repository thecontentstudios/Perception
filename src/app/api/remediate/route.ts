import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { cropImage, cropVideo, trimVideo } from '@/lib/media/renditions';
import { trimToWords, type RemedyKind } from '@/lib/remediate';
import { ffmpegAvailable } from '@/lib/media/video';
import { storage } from '@/lib/storage';
import { handle, require_ } from '@/lib/auth/guard';
import { sameOrigin } from '@/lib/request';
import type { AspectRatio } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Apply a fix.
 *
 * Every branch is deliberately narrow — it takes the remedy kind and its
 * parameters and does exactly that, with no interpretation. The judgement
 * about *whether* a fix is safe to offer lives in `remediate.ts`, where it can
 * be read in one place; this route only carries it out.
 *
 * Media fixes create a **new asset** rather than mutating the original. The
 * original photo is the only copy the owner has, and a crop that turns out
 * wrong must never be the thing that destroyed it.
 */

interface Body {
  kind: RemedyKind;
  variationId: string;
  assetId?: string;
  params: Record<string, string | number>;
}

export async function POST(req: Request) {
  return handle(async () => {
  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, reason: 'cross-origin request refused' }, { status: 403 });
  }
  const principal = await require_('create_content');

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'malformed JSON' }, { status: 400 });
  }

  // Scoped: a fix is a write, and an id from another tenant must resolve to
  // nothing rather than to their post.
  const variation = await db.channelVariation.findFirst({
    where: {
      id: body.variationId,
      contentItem: { campaign: { organizationId: principal.organizationId } },
    },
    include: { media: { include: { asset: true }, orderBy: { position: 'asc' } } },
  });
  if (!variation) return NextResponse.json({ ok: false, reason: 'That post could not be found.' }, { status: 404 });

  try {
    switch (body.kind) {
      case 'trim_caption': {
        const max = Number(body.params.maxChars);
        const next = trimToWords(variation.body, max);
        await db.channelVariation.update({
          where: { id: variation.id },
          data: { body: next, overridden: true },
        });
        return NextResponse.json({ ok: true, applied: 'trim_caption', body: next });
      }

      case 'drop_hashtags': {
        const max = Number(body.params.maxHashtags);
        const next = variation.hashtags.slice(0, max);
        await db.channelVariation.update({
          where: { id: variation.id },
          data: { hashtags: next, overridden: true },
        });
        return NextResponse.json({ ok: true, applied: 'drop_hashtags', hashtags: next });
      }

      case 'add_cta': {
        const label = String(body.params.label);
        const url = String(body.params.url);
        const next = `${variation.body.trimEnd()}\n\n${label}: ${url}`;
        await db.channelVariation.update({
          where: { id: variation.id },
          data: { body: next, ctaLabel: label, ctaUrl: url, overridden: true },
        });
        return NextResponse.json({ ok: true, applied: 'add_cta', body: next });
      }

      case 'reschedule': {
        const at = String(body.params.scheduledAt);
        await db.channelVariation.update({
          where: { id: variation.id },
          data: { scheduledAt: new Date(`${at}:00Z`) },
        });
        return NextResponse.json({ ok: true, applied: 'reschedule', scheduledAt: at });
      }

      case 'trim_video':
      case 'crop_image': {
        const asset = variation.media.find((m) => m.assetId === body.assetId)?.asset;
        if (!asset) return NextResponse.json({ ok: false, reason: 'that asset is not on this post' }, { status: 400 });

        if (body.kind === 'trim_video' && !(await ffmpegAvailable())) {
          // A missing tool is an operator problem, not the owner's. Say which.
          return NextResponse.json(
            { ok: false, reason: 'Video editing needs ffmpeg installed on the server.' },
            { status: 501 }
          );
        }

        const rendition =
          body.kind === 'trim_video'
            ? await trimVideo(asset.storageKey, Number(body.params.maxSeconds))
            : asset.kind === 'video'
              ? await cropVideo(asset.storageKey, String(body.params.ratio) as AspectRatio)
              : await cropImage(asset.storageKey, String(body.params.ratio) as AspectRatio);

        // A new row, not an edit. The original keeps its id, its usages, and
        // its bytes.
        const derived = await db.mediaAsset.create({
          data: {
            organizationId: principal.organizationId,
            brandId: asset.brandId,
            kind: asset.kind,
            storageKey: rendition.key,
            fileName:
              body.kind === 'trim_video'
                ? `${asset.fileName} (${rendition.durationSec}s)`
                : `${asset.fileName} (${rendition.ratio})`,
            mimeType: asset.kind === 'video' ? 'video/mp4' : 'image/jpeg',
            sizeBytes: rendition.bytes,
            width: rendition.width,
            height: rendition.height,
            durationSec: rendition.durationSec,
            // Alt text carries over: the picture still shows the same thing.
            altText: asset.altText,
            tags: [...asset.tags, 'rendition'],
            uploadedById: principal.userId,
          },
        });

        // Swap the rendition in on *this* post only. Other posts using the
        // original are none of this fix's business.
        await db.variationMedia.updateMany({
          where: { variationId: variation.id, assetId: asset.id },
          data: { assetId: derived.id },
        });

        await db.auditEvent.create({
          data: {
            organizationId: principal.organizationId, actorUserId: principal.userId,
            action: `media.${body.kind}`,
            target: variation.id,
            detail: `${asset.fileName} → ${derived.fileName}; original kept.`,
          },
        });

        return NextResponse.json({
          ok: true,
          applied: body.kind,
          asset: {
            id: derived.id, url: storage().url(rendition.key),
            width: rendition.width, height: rendition.height,
            durationSec: rendition.durationSec, sizeKB: Math.round(rendition.bytes / 1000),
          },
          originalKept: asset.id,
        });
      }

      default:
        return NextResponse.json({ ok: false, reason: `unknown fix: ${body.kind}` }, { status: 400 });
    }
  } catch (e) {
    console.error('[remediate] failed', e);
    return NextResponse.json({ ok: false, reason: 'That fix could not be applied.' }, { status: 500 });
  }
  });
}
