import type { AspectRatio, ChannelVariation, MediaAsset, PreflightWarning } from './types';

/**
 * "Fix it for me."
 *
 * Preflight has always been able to say what is wrong. This is what turns it
 * from a critic into something that helps: for the warnings where the fix is
 * mechanical and unambiguous, the product does it.
 *
 * **Not every warning gets a button, and that is the point.** Three tests
 * before a fix is offered:
 *
 *   1. *Is it mechanical?* Trimming a video to 90 seconds is arithmetic.
 *      Writing alt text is a description of something we cannot see.
 *   2. *Is it reversible?* Renditions are new objects; the original is
 *      untouched. Anything that would overwrite the owner's work is not a fix.
 *   3. *Can we say exactly what it will do, first?* "Trim to 90s, dropping the
 *      last 28 seconds" is a decision the owner can make. "Fix it" is not.
 *
 * A warning that fails any of those keeps its human-readable instruction and
 * no button, because a button that does something surprising is worse than a
 * warning that does nothing.
 */

export type RemedyKind =
  | 'trim_video'
  | 'crop_image'
  | 'trim_caption'
  | 'drop_hashtags'
  | 'add_cta'
  | 'reschedule';

export interface Remedy {
  kind: RemedyKind;
  /** The button. Short, and specific about the outcome. */
  label: string;
  /** Exactly what will happen, shown before anything is applied. */
  explains: string;
  /** What this cannot get back, when that is anything. */
  cost: string | null;
  /** Which asset it acts on, when it acts on one. */
  assetId?: string;
  params: Record<string, string | number>;
}

export interface RemediableWarning extends PreflightWarning {
  remedy: Remedy | null;
}

const RATIO_VALUE: Record<string, number> = {
  '1:1': 1, '4:5': 0.8, '4:3': 4 / 3, '2:3': 2 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '1.91:1': 1.91, '3:2': 1.5,
};

/** Best target ratio for an asset among those a destination allows. */
function nearestRatio(asset: MediaAsset, allowed: AspectRatio[]): AspectRatio {
  const actual = RATIO_VALUE[asset.aspectRatio] ?? 1;
  return [...allowed].sort(
    (a, b) => Math.abs((RATIO_VALUE[a] ?? 1) - actual) - Math.abs((RATIO_VALUE[b] ?? 1) - actual)
  )[0];
}

export interface RemedyContext {
  variation: ChannelVariation;
  assets: MediaAsset[];
  /** Limits from the destination's capability sheet. */
  caps: { maxChars: number | null; maxHashtags: number | null; maxVideoSec: number | null; allowedRatios: AspectRatio[] | null };
  campaignCta: { label: string; url: string };
  /** Today, for rescheduling a post that fell into the past. */
  today: string;
}

/** Attach a remedy to each warning that has one. */
export function remediate(warnings: PreflightWarning[], ctx: RemedyContext): RemediableWarning[] {
  return warnings.map((w) => ({ ...w, remedy: remedyFor(w, ctx) }));
}

function remedyFor(w: PreflightWarning, ctx: RemedyContext): Remedy | null {
  switch (w.id) {
    case 'video-too-long': {
      const limit = ctx.caps.maxVideoSec;
      const asset = ctx.assets.find((a) => a.kind === 'video' && (a.durationSec ?? 0) > (limit ?? Infinity));
      if (!asset || limit === null) return null;
      const dropped = (asset.durationSec ?? 0) - limit;
      return {
        kind: 'trim_video',
        label: `Trim to ${limit}s`,
        // Naming the seconds lost is the whole difference between a fix and a
        // surprise. The owner may have put the point at the end.
        explains: `Keeps the first ${limit} seconds of “${asset.name}” and drops the last ${dropped}.`,
        cost: `The final ${dropped} seconds won't appear on this destination.`,
        assetId: asset.id,
        params: { maxSeconds: limit },
      };
    }

    case 'image-ratio': {
      const allowed = ctx.caps.allowedRatios;
      if (!allowed || allowed.length === 0) return null;
      const asset = ctx.assets.find((a) => a.kind === 'image' && !allowed.includes(a.aspectRatio));
      if (!asset) return null;
      const target = nearestRatio(asset, allowed);
      return {
        kind: 'crop_image',
        label: `Crop to ${target}`,
        explains: `Makes a ${target} copy of “${asset.name}” for this destination. Your original stays as it is.`,
        cost: 'Cropping trims the edges — check the result before approving.',
        assetId: asset.id,
        params: { ratio: target },
      };
    }

    case 'caption-length': {
      const limit = ctx.caps.maxChars;
      if (limit === null) return null;
      const over = ctx.variation.body.length - limit;
      return {
        kind: 'trim_caption',
        label: `Shorten by ${over}`,
        explains: `Cuts the text back to ${limit} characters, ending at the last complete word.`,
        cost: `${over} characters of your text will be removed.`,
        params: { maxChars: limit },
      };
    }

    case 'hashtag-count': {
      const limit = ctx.caps.maxHashtags;
      if (limit === null) return null;
      const extra = ctx.variation.hashtags.length - limit;
      return {
        kind: 'drop_hashtags',
        label: `Keep first ${limit}`,
        explains: `Removes the last ${extra} hashtag${extra === 1 ? '' : 's'}: ${ctx.variation.hashtags.slice(limit).join(' ')}.`,
        cost: null,
        params: { maxHashtags: limit },
      };
    }

    case 'no-cta':
      return {
        kind: 'add_cta',
        label: 'Add the campaign link',
        explains: `Appends “${ctx.campaignCta.label}” with your campaign's link to the end of the text.`,
        cost: null,
        params: { label: ctx.campaignCta.label, url: ctx.campaignCta.url },
      };

    case 'in-past': {
      // Same time of day, next available date — the owner chose that hour for
      // a reason, and moving it as well would be two decisions in one button.
      const time = ctx.variation.scheduledAt?.slice(11) ?? '09:00';
      const next = new Date(`${ctx.today}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const dateKey = next.toISOString().slice(0, 10);
      return {
        kind: 'reschedule',
        label: 'Move to tomorrow',
        explains: `Reschedules to ${dateKey} at ${time}, keeping the time of day you picked.`,
        cost: null,
        params: { scheduledAt: `${dateKey}T${time}` },
      };
    }

    // Deliberately unremediable:
    //   missing-alt      — a description of an image nobody here can see
    //   not-connected    — needs an authorization only the owner can grant
    //   needs-reconnect  — same
    //   promo-density    — which campaign should move is a judgement call
    default:
      return null;
  }
}

/** Cut text to a limit at a word boundary, never mid-word. */
export function trimToWords(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  // If there's no space in the whole window it's one long token — take the
  // hard cut rather than returning nothing.
  return (lastSpace > maxChars * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd();
}
