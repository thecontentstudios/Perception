import type { Learning } from './learning';
import type { Suggestion } from './suggest';
import type { Channel, ContentFormat } from './types';

/**
 * Suggestions drawn from the owner's own results.
 *
 * Every other suggestion source reads the *outside* of a business — its
 * website, its profiles, its unused photos. This one reads what the business
 * actually did and what came of it, which is the only source that improves on
 * its own as the product runs.
 *
 * **The number in the sentence has to be the number in the database.** A
 * suggestion that says "your short videos convert 3× better" and is wrong is
 * worse than no suggestion at all: it spends the trust that makes every other
 * suggestion worth reading. So these are built *from* `Finding` objects rather
 * than alongside them — the sentence shown to the owner is the one the query
 * produced, not a re-description of it.
 */

const FORMAT_FOR: Record<string, ContentFormat> = {
  'short videos': 'reel',
  'plain posts': 'post',
  stories: 'story',
  'long videos': 'video',
  'local updates': 'update',
  pins: 'pin',
  emails: 'email',
  texts: 'sms',
};

export function performanceSuggestions(
  learning: Learning,
  opts: { channels: Channel[]; ctaLabel: string; ctaUrl: string; coreMessage: string }
): Suggestion[] {
  const out: Suggestion[] = [];
  let n = 0;
  const id = () => `sg-perf-${n++}`;

  const format = learning.findings.find((f) => f.dimension === 'format');
  const channel = learning.findings.find((f) => f.dimension === 'channel');
  const timing = learning.findings.find((f) => f.dimension === 'hour');
  const day = learning.findings.find((f) => f.dimension === 'weekday');

  // --- Make more of the format that works ----------------------------------
  if (format && format.lift) {
    const target = FORMAT_FOR[format.best.label] ?? 'post';
    const channels =
      // Prefer the channel that also earns its keep, when we know one.
      channel && opts.channels.includes(channel.best.key as Channel)
        ? [channel.best.key as Channel, ...opts.channels.filter((c) => c !== channel.best.key)].slice(0, 3)
        : opts.channels.slice(0, 3);
    if (channels.length > 0) {
      out.push({
        id: id(),
        title: `Make another ${format.best.label.replace(/s$/, '')} — they work for you`,
        coreMessage: opts.coreMessage,
        channels,
        format: target,
        goal: 'quote_requests',
        source: 'performance',
        // The finding's own sentence, verbatim. Rewriting it here is how the
        // number and the claim drift apart.
        reasons: [
          format.sentence,
          `Based on ${format.best.posts + (format.versus?.posts ?? 0)} of your published posts and ${
            format.best.clicks + (format.versus?.clicks ?? 0)
          } clicks.`,
          ...(channel ? [channel.sentence] : []),
        ],
        bodies: Object.fromEntries(channels.map((c) => [c, opts.coreMessage])),
        mediaIds: [],
        hashtags: [],
        ctaLabel: opts.ctaLabel,
        ctaUrl: opts.ctaUrl,
        // Confidence tracks the evidence, not the enthusiasm. A 4× lift over
        // forty posts should outrank a 1.3× lift over four.
        score: Math.min(0.99, 0.6 + Math.min(format.lift, 4) * 0.06 + Math.min(format.best.posts, 20) * 0.008),
      });
    }
  }

  // --- Post when your audience is actually there ---------------------------
  if (timing && timing.lift) {
    const channels = opts.channels.slice(0, 3);
    if (channels.length > 0) {
      out.push({
        id: id(),
        title: `Move your next post to ${timing.best.label.toLowerCase()}`,
        coreMessage: opts.coreMessage,
        channels,
        format: 'post',
        goal: 'quote_requests',
        source: 'performance',
        reasons: [
          timing.sentence,
          ...(day ? [day.sentence] : []),
          'This is your own posting history, not a general best-practice.',
        ],
        bodies: Object.fromEntries(channels.map((c) => [c, opts.coreMessage])),
        mediaIds: [],
        hashtags: [],
        ctaLabel: opts.ctaLabel,
        ctaUrl: opts.ctaUrl,
        score: Math.min(0.95, 0.55 + Math.min(timing.lift, 4) * 0.06),
      });
    }
  }

  return out;
}
