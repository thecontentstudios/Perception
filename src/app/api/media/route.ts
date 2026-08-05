import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { ingest, guessType, IngestError } from '@/lib/media/ingest';
import { storage } from '@/lib/storage';
import { suggestAltText } from '@/lib/media/alt-text';
import { handle, require_ } from '@/lib/auth/guard';
import { sameOrigin } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * Upload a file into the media library.
 *
 * Multipart, because that is what a file input sends and asking a customer to
 * base64 their own photo would be absurd.
 */
export async function POST(req: Request) {
  return handle(async () => {
  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, reason: 'cross-origin request refused' }, { status: 403 });
  }
  // Uploading spends storage and CPU (sharp re-encodes every image), so it is
  // gated on being able to make content at all.
  const principal = await require_('create_content');

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, reason: 'expected a multipart upload' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, reason: 'no file in the upload' }, { status: 400 });
  }

  // A brand id from the client has to be one of ours, or the asset lands in
  // another tenant's library.
  const requestedBrand = (form.get('brandId') as string) || null;
  const brandId = requestedBrand
    ? (await db.brand.findFirst({
        where: { id: requestedBrand, organizationId: principal.organizationId },
        select: { id: true },
      }))?.id ?? null
    : null;
  const data = Buffer.from(await file.arrayBuffer());
  // Browsers sometimes send an empty or wrong type; the extension is the
  // better hint, and the bytes are checked either way during ingest.
  const type = file.type || guessType(file.name);

  let result;
  try {
    result = await ingest(data, file.name, type);
  } catch (e) {
    // An ingest failure is nearly always something the person can fix — wrong
    // format, too big — so the message goes straight back rather than becoming
    // a 500 they can do nothing with.
    if (e instanceof IngestError) {
      return NextResponse.json({ ok: false, reason: e.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, reason: (e as Error).message }, { status: 500 });
  }

  const asset = await db.mediaAsset.create({
    data: {
      organizationId: principal.organizationId,
      brandId,
      kind: result.kind,
      storageKey: result.key,
      fileName: file.name,
      mimeType: result.mimeType,
      sizeBytes: result.bytes,
      width: result.width,
      height: result.height,
      durationSec: result.durationSec,
      // Proposed, never assumed. The owner edits it before it counts.
      altText: null,
      tags: [],
      uploadedById: principal.userId,
    },
  });

  return NextResponse.json({
    ok: true,
    asset: {
      id: asset.id,
      url: storage().url(result.key),
      kind: result.kind,
      fileName: asset.fileName,
      width: result.width,
      height: result.height,
      durationSec: result.durationSec,
      sizeKB: Math.round(result.bytes / 1000),
    },
    // What we changed on the way in, so the upload can say so rather than
    // silently altering someone's file.
    stripped: result.strippedFields,
    normalized: result.normalized,
    altTextSuggestion: suggestAltText(file.name, result),
  });
  });
}
