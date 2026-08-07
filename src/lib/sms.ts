/**
 * What a text message actually costs to send.
 *
 * SMS is not billed per message. It is billed per **segment**, and how many
 * segments a message becomes depends on which characters are in it. This is
 * the single most expensive piece of hidden knowledge in small-business
 * marketing, because the rule is invisible:
 *
 *   - A message made only of characters in the GSM-7 alphabet fits **160**
 *     characters in one segment.
 *   - A message containing *one* character outside that alphabet is re-encoded
 *     as UCS-2, and the whole message drops to **70** characters per segment.
 *
 * One emoji costs you 90 characters. Not 90 characters of the emoji — 90
 * characters of everything else in the message.
 *
 * Worse, the character that does it is usually invisible. Type an apostrophe in
 * Word, Google Docs, Notes, or any phone keyboard and you get `’` (U+2019),
 * not `'` (U+0027). They render identically in every UI including this one.
 * One is GSM-7. The other is not. A 158-character message written in a word
 * processor and pasted in becomes three segments instead of one, and the bill
 * triples, and nothing on screen looks different.
 *
 * That is what this file is for: to make the invisible thing visible *before*
 * the send, name the exact character responsible, and offer the one-click
 * substitution that takes the cost back down.
 */

import { effectiveOffset } from './timezone';

// ---------------------------------------------------------------------------
// The alphabet
// ---------------------------------------------------------------------------

/**
 * GSM 03.38 basic character set — the 128 characters that cost one septet.
 *
 * Written out rather than computed because it is not derivable from any
 * Unicode property: it is a table a standards committee wrote in 1988, and it
 * contains `Ω` and `Ξ` but not `[`.
 */
const GSM7_BASIC = new Set(
  (
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§' +
    '¿abcdefghijklmnopqrstuvwxyzäöñüà'
  ).split('')
);

/**
 * The extension table. These are real GSM-7 characters, but each is encoded as
 * an escape byte followed by the character, so **each one costs two septets**.
 *
 * `[` and `]` are here, which is why a message full of brackets runs out of
 * room at 80 characters rather than 160 — while still being "GSM-7", so
 * nothing warns you.
 */
const GSM7_EXTENDED = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€', '\f']);

export type SmsEncoding = 'GSM-7' | 'UCS-2';

const LIMITS = {
  'GSM-7': { single: 160, concat: 153 },
  'UCS-2': { single: 70, concat: 67 },
} as const;

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

export interface SegmentCount {
  encoding: SmsEncoding;
  /** Septets for GSM-7, UTF-16 code units for UCS-2. */
  units: number;
  segments: number;
  /** Units left before this message costs one more segment. */
  remainingInSegment: number;
  /** Per-segment capacity at the current length — 160 vs 153 differ. */
  perSegment: number;
  /**
   * The characters that forced UCS-2, in the order they appear, deduplicated.
   * Empty when the message is GSM-7. This is the actionable part: not "your
   * message is UCS-2" but "the `’` in *don't* did this".
   */
  culprits: Culprit[];
}

export interface Culprit {
  char: string;
  /** Index of the first occurrence, so the editor can point at it. */
  at: number;
  count: number;
  /** U+XXXX, because two culprits can look identical on screen. */
  codePoint: string;
  name: string;
  /** A GSM-7 character that means the same thing, when one exists. */
  replacement: string | null;
}

/**
 * Characters that are *almost always* a typographic upgrade of an ASCII
 * character the writer actually meant, and can be substituted with no loss of
 * meaning. Emoji are deliberately absent — an emoji is a choice, and replacing
 * it silently would be editing someone's message, not fixing their encoding.
 */
const SUBSTITUTIONS: Record<string, { to: string; name: string }> = {
  '‘': { to: "'", name: 'left single quote' },
  '’': { to: "'", name: 'right single quote (curly apostrophe)' },
  '“': { to: '"', name: 'left double quote' },
  '”': { to: '"', name: 'right double quote' },
  '–': { to: '-', name: 'en dash' },
  '—': { to: '-', name: 'em dash' },
  '…': { to: '...', name: 'ellipsis' },
  ' ': { to: ' ', name: 'non-breaking space' },
  '​': { to: '', name: 'zero-width space' },
  '•': { to: '*', name: 'bullet' },
  '·': { to: '.', name: 'middle dot' },
  '′': { to: "'", name: 'prime' },
  '″': { to: '"', name: 'double prime' },
  '−': { to: '-', name: 'minus sign' },
  '«': { to: '"', name: 'left guillemet' },
  '»': { to: '"', name: 'right guillemet' },
  '‐': { to: '-', name: 'hyphen' },
  '‑': { to: '-', name: 'non-breaking hyphen' },
  '‹': { to: '<', name: 'single left angle quote' },
  '›': { to: '>', name: 'single right angle quote' },
  '⁄': { to: '/', name: 'fraction slash' },
  '™': { to: '(TM)', name: 'trademark sign' },
  '®': { to: '(R)', name: 'registered sign' },
  '©': { to: '(C)', name: 'copyright sign' },
  '→': { to: '->', name: 'right arrow' },
  '≤': { to: '<=', name: 'less-than-or-equal' },
  '≥': { to: '>=', name: 'greater-than-or-equal' },
  '½': { to: '1/2', name: 'one half' },
  '¼': { to: '1/4', name: 'one quarter' },
  '¾': { to: '3/4', name: 'three quarters' },
  ' ': { to: '\n', name: 'line separator' },
  ' ': { to: '\n', name: 'paragraph separator' },
  '﻿': { to: '', name: 'byte order mark' },
};

function describe(char: string): string {
  const sub = SUBSTITUTIONS[char];
  if (sub) return sub.name;
  const cp = char.codePointAt(0) ?? 0;
  if (cp >= 0x1f300 && cp <= 0x1faff) return 'emoji';
  if (cp >= 0x2600 && cp <= 0x27bf) return 'symbol';
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return 'flag';
  if (cp === 0x200d) return 'zero-width joiner';
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 'variation selector';
  return 'not in the GSM-7 alphabet';
}

function hex(char: string): string {
  const cp = char.codePointAt(0) ?? 0;
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function encodingOf(text: string): SmsEncoding {
  for (const ch of text) {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXTENDED.has(ch)) return 'UCS-2';
  }
  return 'GSM-7';
}

/**
 * Count segments the way a carrier counts them.
 *
 * Two details that a naive `length / 160` gets wrong, and both cost money:
 *
 * 1. **Concatenation overhead.** A multi-part message carries a 6-byte header
 *    in every part, so capacity drops from 160 to 153 (70 to 67 for UCS-2).
 *    A 161-character message is not "one segment plus one character" — it is
 *    two segments of 153, and 320 characters is three segments, not two.
 *
 * 2. **Surrogate pairs.** UCS-2 counts UTF-16 code units, and most emoji are
 *    two of them. `😀` is 2 of your 70, and a flag or a family emoji built
 *    from joiners can be 7 or 11. Iterating a JavaScript string with `for…of`
 *    yields code *points*, which would undercount by half — so the UCS-2 path
 *    deliberately uses `.length`, which is code units, which is what the
 *    carrier bills.
 */
export function countSegments(text: string): SegmentCount {
  const encoding = encodingOf(text);

  if (encoding === 'UCS-2') {
    const units = text.length; // UTF-16 code units — see above.
    const seen = new Map<string, Culprit>();
    let idx = 0;
    for (const ch of text) {
      if (!GSM7_BASIC.has(ch) && !GSM7_EXTENDED.has(ch)) {
        const existing = seen.get(ch);
        if (existing) existing.count += 1;
        else
          seen.set(ch, {
            char: ch,
            at: idx,
            count: 1,
            codePoint: hex(ch),
            name: describe(ch),
            replacement: SUBSTITUTIONS[ch]?.to ?? null,
          });
      }
      idx += ch.length;
    }
    const perSegment = units <= LIMITS['UCS-2'].single ? LIMITS['UCS-2'].single : LIMITS['UCS-2'].concat;
    const segments = units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67);
    return {
      encoding,
      units,
      segments,
      perSegment,
      remainingInSegment: segments === 0 ? perSegment : segments * perSegment - units,
      culprits: [...seen.values()],
    };
  }

  // GSM-7: extended characters cost two septets each.
  let units = 0;
  for (const ch of text) units += GSM7_EXTENDED.has(ch) ? 2 : 1;

  let segments: number;
  if (units === 0) segments = 0;
  else if (units <= LIMITS['GSM-7'].single) segments = 1;
  else segments = countConcatenatedGsm(text);

  const perSegment = segments <= 1 ? LIMITS['GSM-7'].single : LIMITS['GSM-7'].concat;
  return {
    encoding,
    units,
    segments,
    perSegment,
    remainingInSegment: segments === 0 ? perSegment : segments * perSegment - units,
    culprits: [],
  };
}

/**
 * Walk the message filling 153-septet segments.
 *
 * `ceil(units / 153)` is *almost* right, and wrong in one case: an escaped
 * character (`{`, `€`, `[`…) is an escape septet plus a data septet, and the
 * pair cannot be split across a segment boundary. When one septet is left in a
 * segment it is wasted and the pair moves to the next.
 *
 * That only changes the answer when escaped characters are dense enough for
 * the wasted septets to add up — 153 `€` signs is three segments by this walk
 * and two by the formula. Rare, entirely real, and the kind of off-by-one that
 * surfaces months later as an invoice nobody can reconcile. Since the carrier
 * does the walk, so do we.
 */
function countConcatenatedGsm(text: string): number {
  const cap = LIMITS['GSM-7'].concat;
  let segments = 1;
  let used = 0;
  for (const ch of text) {
    const cost = GSM7_EXTENDED.has(ch) ? 2 : 1;
    if (used + cost > cap) {
      segments += 1;
      used = cost;
    } else {
      used += cost;
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Making it cheaper
// ---------------------------------------------------------------------------

export interface Downgrade {
  text: string;
  /** Characters replaced, for a "we changed these" confirmation. */
  changed: Culprit[];
  /** Characters that could not be replaced — emoji, mostly. */
  remaining: Culprit[];
  before: SegmentCount;
  after: SegmentCount;
  segmentsSaved: number;
}

/**
 * Rewrite a message into GSM-7 where that can be done without changing what it
 * says, and report exactly what was touched.
 *
 * Returns the *proposal*, never applies it. Silently editing someone's message
 * to save a cent is how a product loses trust; showing them that `’` → `'`
 * halves the bill and letting them press the button is how it earns it.
 */
export function proposeDowngrade(text: string): Downgrade {
  const before = countSegments(text);
  let out = '';
  const changed = new Map<string, Culprit>();
  let idx = 0;
  for (const ch of text) {
    const sub = SUBSTITUTIONS[ch];
    if (sub && !GSM7_BASIC.has(ch) && !GSM7_EXTENDED.has(ch)) {
      out += sub.to;
      const e = changed.get(ch);
      if (e) e.count += 1;
      else
        changed.set(ch, {
          char: ch,
          at: idx,
          count: 1,
          codePoint: hex(ch),
          name: sub.name,
          replacement: sub.to,
        });
    } else {
      out += ch;
    }
    idx += ch.length;
  }
  const after = countSegments(out);
  return {
    text: out,
    changed: [...changed.values()],
    remaining: after.culprits,
    before,
    after,
    segmentsSaved: before.segments - after.segments,
  };
}

// ---------------------------------------------------------------------------
// The parts you are legally required to send
// ---------------------------------------------------------------------------

/**
 * Opt-out language, which is not optional and is not free.
 *
 * US carriers require a clear opt-out on the first message of a conversation
 * and, in practice, on promotional messages generally. "Reply STOP to opt out"
 * is 24 characters — 15% of a single segment — and a composer that shows a
 * 160-character counter while the sender is about to have 24 characters
 * appended is lying to them at exactly the moment it matters.
 *
 * So the count the composer shows always includes this.
 */
export const OPT_OUT_SUFFIX = ' Reply STOP to opt out.';

export interface SmsPreview extends SegmentCount {
  /** The message as it will actually leave, suffix and all. */
  fullText: string;
  /** Whether the opt-out was appended by us rather than written by the sender. */
  optOutAdded: boolean;
}

const OPT_OUT_PATTERN = /\b(stop|unsubscribe|opt[\s-]?out|quit|cancel)\b/i;

/**
 * What the recipient will receive, counted.
 *
 * If the sender already wrote their own opt-out — "text STOP to quit", "reply
 * CANCEL" — we do not append a second one. Two opt-out instructions in one
 * message reads as a machine wrote it, and costs a segment for the privilege.
 */
export function previewSms(body: string, opts: { optOut?: boolean } = {}): SmsPreview {
  const wantsOptOut = opts.optOut !== false;
  const already = OPT_OUT_PATTERN.test(body);
  const optOutAdded = wantsOptOut && !already;
  const fullText = optOutAdded ? body.trimEnd() + OPT_OUT_SUFFIX : body;
  return { ...countSegments(fullText), fullText, optOutAdded };
}

// ---------------------------------------------------------------------------
// When you are allowed to send
// ---------------------------------------------------------------------------

/**
 * Quiet hours.
 *
 * The TCPA restricts marketing calls and texts to 8am–9pm **in the
 * recipient's** time zone, and the penalty is $500–$1,500 per message — which
 * on a 400-contact list is a business-ending number for a landscaper. Several
 * states are stricter. This uses 9am–8pm as the default window, deliberately
 * inside the legal one, because the boundary is where the arguments happen.
 *
 * Note the *recipient's* time zone. A 9am send from California lands at noon
 * in New York, which is fine; an 8pm send from New York lands at 5pm in
 * California, which is also fine; but a 7am California send lands at 10am in
 * New York while being illegal where it was sent. The check therefore has to
 * be per-contact, not per-campaign, and this function takes the offset.
 */
export const QUIET_HOURS = { openHour: 9, closeHour: 20 };

export interface QuietHoursVerdict {
  allowed: boolean;
  localHour: number;
  reason: string;
  /** Next moment inside the window, when the send is blocked. */
  nextOpening: Date | null;
}

export function checkQuietHours(at: Date, utcOffsetHours: number): QuietHoursVerdict {
  const localHour = (((at.getUTCHours() + utcOffsetHours) % 24) + 24) % 24;
  if (localHour >= QUIET_HOURS.openHour && localHour < QUIET_HOURS.closeHour) {
    return { allowed: true, localHour, reason: `${localHour}:00 local — inside sending hours.`, nextOpening: null };
  }
  const next = new Date(at);
  const hoursUntilOpen =
    localHour < QUIET_HOURS.openHour
      ? QUIET_HOURS.openHour - localHour
      : 24 - localHour + QUIET_HOURS.openHour;
  next.setUTCHours(next.getUTCHours() + hoursUntilOpen, 0, 0, 0);
  return {
    allowed: false,
    localHour,
    reason:
      localHour < QUIET_HOURS.openHour
        ? `${localHour}:00 local — too early. Marketing texts are restricted before ${QUIET_HOURS.openHour}am.`
        : `${localHour}:00 local — too late. Marketing texts are restricted after ${QUIET_HOURS.closeHour - 12}pm.`,
    nextOpening: next,
  };
}

/**
 * Quiet hours for a whole audience, judged recipient by recipient.
 *
 * One clock for a batch is the wrong shape: a list spanning four time zones
 * is legal for some of it and illegal for the rest at any given moment. The
 * verdict here mirrors what the dispatcher will actually do — send to the
 * recipients whose local time allows it, hold the rest — so the number the
 * composer shows is the number that happens.
 *
 * `allowed` is false only when **nobody** can receive a text right now. That
 * is the only situation where refusing the send tells the owner something
 * true; refusing because the *owner's* clock says 8pm silences a Hawaii
 * customer's 5pm afternoon.
 */
export interface AudienceQuietVerdict {
  allowed: boolean;
  /** How many recipients can legally receive a text at this moment. */
  sendableNow: number;
  /** How many the dispatcher will hold until their own morning. */
  deferred: number;
  reason: string;
  /** Earliest moment the first held recipient becomes reachable. */
  nextOpening: Date | null;
}

export function quietHoursForAudience(
  contacts: { phone?: string | null }[],
  at: Date
): AudienceQuietVerdict {
  let sendableNow = 0;
  let deferred = 0;
  let nextOpening: Date | null = null;

  for (const c of contacts) {
    const zone = effectiveOffset(c.phone, at);
    const verdict = checkQuietHours(at, zone.offsetHours);
    if (verdict.allowed) {
      sendableNow += 1;
    } else {
      deferred += 1;
      if (verdict.nextOpening && (!nextOpening || verdict.nextOpening < nextOpening)) {
        nextOpening = verdict.nextOpening;
      }
    }
  }

  if (contacts.length === 0) {
    return { allowed: true, sendableNow: 0, deferred: 0, reason: 'Nobody to check.', nextOpening: null };
  }

  if (sendableNow === 0) {
    return {
      allowed: false,
      sendableNow,
      deferred,
      reason:
        'It is between 8pm and 9am for everyone on this list. Marketing texts are restricted to daytime hours — schedule it, or send in the morning.',
      nextOpening,
    };
  }

  return {
    allowed: true,
    sendableNow,
    deferred,
    reason:
      deferred === 0
        ? 'Inside sending hours for everyone on this list.'
        : `${sendableNow} of ${contacts.length} can receive it now; ${deferred} will be held until their own morning.`,
    nextOpening,
  };
}

// ---------------------------------------------------------------------------
// Merge fields
// ---------------------------------------------------------------------------

/**
 * Personalisation tokens, and why they make the segment count a *range*.
 *
 * `Hi {{name}},` is 11 characters in the composer and somewhere between 6 and
 * 30 once it is sent. A composer that counts the template rather than the
 * output will happily show "1 segment" for a message that costs two for every
 * customer called Konstantinos. So the count is computed over the shortest and
 * longest actual values in the audience, and if they differ the UI shows both.
 */
export const MERGE_FIELDS: Record<string, string> = {
  '{{name}}': 'Contact first name',
  '{{full_name}}': 'Contact full name',
  '{{business}}': 'Your business name',
  '{{link}}': 'Tracked short link',
};

/** Short-link length is fixed by our own router: /r/<8 chars> on the app host. */
export const TRACKED_LINK_LENGTH = 24;

export function fillMergeFields(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => values[key] ?? whole);
}

export interface SegmentRange {
  min: SmsPreview;
  max: SmsPreview;
  /** True when personalisation makes the cost differ between recipients. */
  varies: boolean;
}

/**
 * The honest answer when merge fields are present: a range, computed from the
 * real audience rather than a placeholder.
 */
export function previewRange(
  body: string,
  audience: { names: string[]; business: string },
  opts: { optOut?: boolean } = {}
): SegmentRange {
  const names = audience.names.length ? audience.names : [''];
  let shortest = names[0];
  let longest = names[0];
  for (const n of names) {
    if (n.length < shortest.length) shortest = n;
    if (n.length > longest.length) longest = n;
  }
  const link = 'x'.repeat(TRACKED_LINK_LENGTH);
  const render = (name: string) =>
    fillMergeFields(body, {
      name: name.split(' ')[0] ?? '',
      full_name: name,
      business: audience.business,
      link,
    });
  const min = previewSms(render(shortest), opts);
  const max = previewSms(render(longest), opts);
  return { min, max, varies: min.segments !== max.segments };
}
