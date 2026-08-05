import sharp from 'sharp';
import { storage } from '../storage';

/**
 * Turning an uploaded file into a library asset.
 *
 * **EXIF is stripped, and the reason is not tidiness.** A phone photo carries
 * the GPS coordinates of where it was taken. A landscaper posting a finished
 * job would publish their customer's home address, in a field nobody looks at,
 * to every platform at once. That is a privacy incident caused by a default,
 * and the fix belongs here rather than in a warning nobody reads.
 *
 * **The subtlety that bites:** EXIF also carries *orientation*. Strip it
 * naively and every photo taken in portrait comes out sideways, because the
 * pixels were never rotated — the tag was doing the work. `.rotate()` with no
 * argument applies the orientation tag first, so the pixels end up the right
 * way up and the tag is no longer needed. Getting this backwards is the single
 * most common bug in upload pipelines.
 */

export interface Ingested {
  key: string;
  kind: 'image' | 'video' | 'document';
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  /** True when the stored bytes differ from what was uploaded. */
  normalized: boolean;
  /** Metadata found and removed, so the UI can say what it did. */
  strippedFields: string[];
}

const MAX_BYTES = 25 * 1024 * 1024;
/** Bigger than any platform will show; a 6000px photo just wastes bandwidth. */
const MAX_EDGE = 2400;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

export class IngestError extends Error {}

export async function ingest(
  data: Buffer,
  fileName: string,
  declaredType: string
): Promise<Ingested> {
  if (data.length === 0) throw new IngestError('The file is empty.');
  if (data.length > MAX_BYTES) {
    throw new IngestError(`That file is ${(data.length / 1e6).toFixed(1)} MB — the limit is 25 MB.`);
  }

  if (IMAGE_TYPES.has(declaredType)) return ingestImage(data, declaredType);
  if (VIDEO_TYPES.has(declaredType)) return ingestVideo(data, fileName, declaredType);
  throw new IngestError(
    `Perception can't use ${declaredType || 'that file type'} yet. Images and MP4 video work today.`
  );
}

async function ingestImage(data: Buffer, declaredType: string): Promise<Ingested> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(data).metadata();
  } catch {
    // The declared type is whatever the browser said; the bytes are the truth.
    throw new IngestError('That file says it is an image but could not be read as one.');
  }

  const stripped: string[] = [];
  if (meta.exif) stripped.push('camera and location data');
  if (meta.icc) stripped.push('colour profile');
  if (meta.iptc || meta.xmp) stripped.push('editing metadata');

  const tooBig = (meta.width ?? 0) > MAX_EDGE || (meta.height ?? 0) > MAX_EDGE;

  // Animated GIFs lose their animation if re-encoded frame-by-frame here, so
  // they are stored as uploaded. GIFs do not carry EXIF, so nothing leaks.
  if (declaredType === 'image/gif') {
    const put = await storage().put(data, 'gif');
    return {
      key: put.key, kind: 'image', mimeType: 'image/gif', bytes: put.bytes,
      width: meta.width ?? null, height: meta.height ?? null, durationSec: null,
      normalized: false, strippedFields: [],
    };
  }

  const pipeline = sharp(data)
    // Apply the orientation tag to the pixels *before* the tag goes away.
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });

  // sharp drops all metadata unless told otherwise — which is what we want.
  const isPng = declaredType === 'image/png';
  const out = isPng
    ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await pipeline.jpeg({ quality: 86, mozjpeg: true }).toBuffer({ resolveWithObject: true });

  const put = await storage().put(out.data, isPng ? 'png' : 'jpg');
  return {
    key: put.key,
    kind: 'image',
    mimeType: isPng ? 'image/png' : 'image/jpeg',
    bytes: put.bytes,
    width: out.info.width,
    height: out.info.height,
    durationSec: null,
    normalized: true,
    strippedFields: [...stripped, ...(tooBig ? [`resized to fit ${MAX_EDGE}px`] : [])],
  };
}

async function ingestVideo(data: Buffer, fileName: string, declaredType: string): Promise<Ingested> {
  const { probe } = await import('./video');
  const ext = declaredType === 'video/webm' ? 'webm' : 'mp4';
  const put = await storage().put(data, ext);

  // Probe from storage rather than a temp copy: the file is already written,
  // and ffprobe reading it is cheaper than writing it twice.
  const info = await probe(put.key).catch(() => null);
  return {
    key: put.key,
    kind: 'video',
    mimeType: declaredType,
    bytes: put.bytes,
    width: info?.width ?? null,
    height: info?.height ?? null,
    durationSec: info?.durationSec ?? null,
    normalized: false,
    // Video metadata is stripped during a rendition (Phase 4.2), not on the
    // original — the original is kept intact so a re-crop is always possible.
    strippedFields: [],
  };
}

/** File extension → the mime type we'll trust, for callers without one. */
export function guessType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return (
    {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      avif: 'image/avif', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime',
      webm: 'video/webm',
    }[ext] ?? ''
  );
}
