import type { Ingested } from './ingest';

/**
 * Proposed alt text.
 *
 * The honest framing matters more than the copy. Alt text describes what is in
 * a picture; nothing in this file can see the picture. What it *can* do is
 * turn the filename and the shape of the file into a starting sentence the
 * owner edits in two seconds instead of writing from a blank box — which is
 * the actual reason alt text goes missing.
 *
 * So this returns a **draft with a confidence**, never a value. It is never
 * written to `altText` automatically: a wrong description is worse than none,
 * because a screen-reader user has no way to tell it is wrong. Preflight keeps
 * warning until a human has looked at it.
 *
 * PRODUCTION NOTE. This is the seam where a vision model goes. The contract
 * stays exactly as it is — a suggestion, a confidence, and an owner who has to
 * agree — because that is the part that protects the person reading it.
 */

export interface AltSuggestion {
  text: string;
  /** low: a filename guess. medium: the filename actually described something. */
  confidence: 'low' | 'medium';
  /** Shown next to the field so nobody mistakes this for a description. */
  note: string;
}

/** Filenames that carry no information at all. */
const NOISE = /^(img|dsc|image|photo|video|screenshot|untitled|final|copy|export|render|pxl|mvimg)[\W_]*\d*$/i;

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'with', 'copy', 'final', 'v1', 'v2', 'edit', 'new']);

/** 'fall-cleanup_before-after_02.jpg' → 'fall cleanup before after' */
function wordsFrom(fileName: string): string[] {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, '');
  if (NOISE.test(stem.replace(/[\W_]+/g, ''))) return [];
  return stem
    .split(/[\W_]+/)
    .map((w) => w.trim().toLowerCase())
    // Drop pure numbers and camera counters, keep words like "2024" out too —
    // a year is not a description.
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !STOP.has(w));
}

export function suggestAltText(fileName: string, file: Pick<Ingested, 'kind' | 'width' | 'height' | 'durationSec'>): AltSuggestion {
  const words = wordsFrom(fileName);
  const noun = file.kind === 'video' ? 'Video' : 'Photo';

  if (words.length === 0) {
    // Saying "Photo" and calling it a description would be worse than
    // admitting we have nothing — the owner needs to know to write this one.
    return {
      text: '',
      confidence: 'low',
      note: `The filename doesn't say what this shows. Describe it in a few words — what would you tell someone who can't see it?`,
    };
  }

  const phrase = words.join(' ');
  const shape =
    file.width && file.height
      ? file.height > file.width * 1.2
        ? ' shot upright'
        : file.width > file.height * 1.5
          ? ' shot wide'
          : ''
      : '';

  return {
    text: `${noun} of ${phrase}${shape}.`,
    confidence: 'medium',
    note: 'Built from the filename, not from looking at the image — check it says what the picture actually shows.',
  };
}
