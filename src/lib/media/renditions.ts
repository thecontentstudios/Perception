import sharp from 'sharp';
import { storage } from '../storage';
import { reframe, trim } from './video';
import type { AspectRatio, Channel, ContentFormat } from '../types';

/**
 * Per-destination renditions.
 *
 * The problem this solves is mundane and constant: one photo, five places that
 * each want a different shape. Instagram's feed rewards 4:5, Reels and TikTok
 * demand 9:16, Pinterest wants 2:3, and a landscape photo posted to all of
 * them gets letterboxed or centre-cropped by the platform — badly, and
 * differently each time. Doing the crop here means the owner sees the result
 * before it publishes instead of discovering it on their own feed.
 *
 * **Cropping is lossy in the literal sense: it throws away part of the
 * picture.** So a rendition never replaces the original — it is a derived
 * object with its own key, the original stays exactly as uploaded, and any
 * crop can be redone or discarded.
 */

/** What each channel and format actually wants. */
export const TARGET_RATIO: Partial<Record<Channel, Partial<Record<ContentFormat, AspectRatio>>>> = {
  instagram: { post: '4:5', reel: '9:16', story: '9:16' },
  facebook: { post: '1:1', reel: '9:16', story: '9:16' },
  tiktok: { reel: '9:16', video: '9:16' },
  youtube: { video: '16:9', reel: '9:16' },
  pinterest: { pin: '2:3' },
  linkedin: { post: '1:1', video: '16:9' },
  x: { post: '16:9' },
  google_business: { update: '4:3' },
};

/** Hard duration limits, in seconds. Null where the platform doesn't cap it. */
export const MAX_DURATION: Partial<Record<Channel, Partial<Record<ContentFormat, number>>>> = {
  instagram: { reel: 90, story: 60 },
  tiktok: { reel: 600 },
  facebook: { reel: 90, story: 60 },
  youtube: { reel: 60 },
  pinterest: { pin: 300 },
};

export function targetFor(channel: Channel, format: ContentFormat): AspectRatio | null {
  return TARGET_RATIO[channel]?.[format] ?? null;
}

export function maxDurationFor(channel: Channel, format: ContentFormat): number | null {
  return MAX_DURATION[channel]?.[format] ?? null;
}

const RATIO_VALUE: Record<string, number> = {
  '1:1': 1, '4:5': 0.8, '4:3': 4 / 3, '2:3': 2 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '1.91:1': 1.91, '3:2': 1.5,
};

/** How far a shape is from a target, as a fraction. */
export function ratioDistance(width: number, height: number, target: AspectRatio): number {
  const actual = width / height;
  const want = RATIO_VALUE[target] ?? 1;
  return Math.abs(actual - want) / want;
}

/** Under this, cropping would change nothing anyone can see. */
export const RATIO_TOLERANCE = 0.02;

export interface Rendition {
  key: string;
  width: number;
  height: number;
  bytes: number;
  ratio: AspectRatio;
  durationSec: number | null;
}

/**
 * Crop an image to a target ratio, centred.
 *
 * `sharp`'s `attention` strategy picks the crop window by finding the most
 * visually salient region rather than assuming the subject is dead centre —
 * on a photo of a house with sky above it, that is the difference between a
 * usable square and a square of sky.
 */
export async function cropImage(key: string, ratio: AspectRatio): Promise<Rendition> {
  const source = await storage().get(key);
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) throw new Error('could not read the image dimensions');

  const want = RATIO_VALUE[ratio] ?? 1;
  // The largest rectangle of the target ratio that fits inside the original.
  let w = meta.width;
  let h = Math.round(w / want);
  if (h > meta.height) {
    h = meta.height;
    w = Math.round(h * want);
  }

  const out = await sharp(source)
    .resize(w, h, { fit: 'cover', position: sharp.strategy.attention })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const put = await storage().put(out.data, 'jpg');
  return { key: put.key, width: out.info.width, height: out.info.height, bytes: put.bytes, ratio, durationSec: null };
}

/** Crop a video to a target ratio. */
export async function cropVideo(key: string, ratio: AspectRatio): Promise<Rendition> {
  if (!['1:1', '4:5', '9:16', '16:9'].includes(ratio)) {
    throw new Error(`Video cannot be reframed to ${ratio} yet.`);
  }
  const r = await reframe(key, ratio as '1:1' | '4:5' | '9:16' | '16:9');
  const { probe } = await import('./video');
  const info = await probe(r.key);
  return { key: r.key, width: info.width, height: info.height, bytes: r.bytes, ratio, durationSec: info.durationSec };
}

/** Trim a video to a platform's limit. */
export async function trimVideo(key: string, maxSeconds: number): Promise<Rendition> {
  const r = await trim(key, maxSeconds);
  const { probe } = await import('./video');
  const info = await probe(r.key);
  return {
    key: r.key, width: info.width, height: info.height, bytes: r.bytes,
    ratio: `${info.width}:${info.height}` as AspectRatio, durationSec: info.durationSec,
  };
}
