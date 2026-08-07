import type { Channel } from './types';

/**
 * What each channel can actually do.
 *
 * The question behind this file is the one nobody answers before a business
 * has already committed: *"if I use this, what am I able to make?"* Every
 * platform's own documentation answers it as a feature list written by the
 * platform, which is a different question — it tells you what exists, not what
 * you can do from here with the account you have.
 *
 * So each entry records limits as **numbers where numbers exist** and as
 * "no" where the answer is no. A capability matrix full of green ticks is
 * useless: the ticks are the boring part. The value is in the cells that say
 * *no*, because those are the ones that turn into "we built the campaign and
 * then found out".
 */

export type Support = 'yes' | 'no' | 'limited';

export interface Capability {
  channel: Channel;
  label: string;
  /** Roughly what one use of it is, in the owner's words. */
  unit: string;

  /** Hard length limit on the message, in characters. Null = no practical one. */
  maxCharacters: number | null;
  /** What the limit actually means — a hard reject, a truncation, or a cost. */
  limitBehaviour: string;

  images: Support;
  video: Support;
  /** Whether a link in the message is clickable and can be attributed. */
  links: Support;
  /** Per-recipient personalisation — a first name, a booking time. */
  personalisation: Support;
  /** Can the recipient reply, and does anyone see it. */
  twoWay: Support;
  /** Can we schedule it for later through the platform's own API. */
  scheduling: Support;
  /** Can we tell whether it worked, and at what resolution. */
  measurement: string;
  /** Who you are allowed to send to. */
  targeting: string;
  /** The thing that most often surprises someone using this for the first time. */
  surprise: string;
}

export const CAPABILITIES: Partial<Record<Channel, Capability>> = {
  email: {
    channel: 'email',
    label: 'Email',
    unit: 'one message to one list',
    maxCharacters: null,
    limitBehaviour:
      'No length limit worth worrying about, but Gmail clips a message over about 102KB and hides the rest behind "View entire message" — including your unsubscribe link, which is the part regulators care about.',
    images: 'yes',
    video: 'limited',
    links: 'yes',
    personalisation: 'yes',
    twoWay: 'yes',
    scheduling: 'yes',
    measurement:
      'Opens (unreliable since Apple Mail Privacy Protection pre-loads images), clicks (reliable), replies, bounces, complaints.',
    targeting: 'Anyone who confirmed they want email from you. Segments by list, tag, or past behaviour.',
    surprise:
      'Video does not play in most inboxes — Gmail and Outlook strip it. What works is a still frame with a play button that links out, which is a link, not a video.',
  },

  sms: {
    channel: 'sms',
    label: 'Text message',
    unit: 'one text to one list',
    maxCharacters: 160,
    limitBehaviour:
      'Not a limit — a price step. Past 160 characters the message is split into billed segments, and a single emoji or curly apostrophe drops the step to 70.',
    images: 'limited',
    video: 'no',
    links: 'yes',
    personalisation: 'yes',
    twoWay: 'yes',
    scheduling: 'yes',
    measurement: 'Delivery receipts, link clicks, replies, opt-outs. No opens — there is no such thing.',
    targeting:
      'Only contacts who gave explicit written consent to be texted. Not "customers", not "people who left a number".',
    surprise:
      'Pictures make it an MMS, which costs roughly ten times a text and is not supported by every carrier route. Most businesses that want a picture should send a link.',
  },

  facebook: {
    channel: 'facebook',
    label: 'Facebook',
    unit: 'one post, or one paid flight',
    maxCharacters: 63_206,
    limitBehaviour: 'Truncated to about 480 characters in the feed with a "See more" — write for the first 120.',
    images: 'yes',
    video: 'yes',
    links: 'yes',
    personalisation: 'no',
    twoWay: 'yes',
    scheduling: 'yes',
    measurement: 'Reach, engagement, link clicks. Conversions only if the pixel is on your site.',
    targeting: 'Paid: location, age, interests, lookalikes of your customer list. Organic: whoever the feed decides.',
    surprise:
      'Organic reach on a business Page is in the low single-digit percent of followers. The followers are not an audience you own — they are an audience you rent by paying to reach them.',
  },

  instagram: {
    channel: 'instagram',
    label: 'Instagram',
    unit: 'one post, reel, or paid flight',
    maxCharacters: 2_200,
    limitBehaviour: 'Truncated after about 125 characters in the feed. Up to 30 hashtags, counted separately.',
    images: 'yes',
    video: 'yes',
    links: 'limited',
    personalisation: 'no',
    twoWay: 'yes',
    scheduling: 'yes',
    measurement: 'Reach, saves, shares, profile visits. Link clicks only from the bio, stories, or paid ads.',
    targeting: 'Same auction as Facebook. Organic reach depends heavily on whether it is a Reel.',
    surprise:
      'A link in a caption is not clickable. Every "link in bio" workaround exists because of this one restriction, and it is the single largest source of lost attribution on the platform.',
  },

  google_business: {
    channel: 'google_business',
    label: 'Google Business',
    unit: 'one local post, or one search campaign',
    maxCharacters: 1_500,
    limitBehaviour: 'Posts over 1,500 characters are rejected. About 80 characters show before "Read more".',
    images: 'yes',
    video: 'limited',
    links: 'yes',
    personalisation: 'no',
    twoWay: 'yes',
    scheduling: 'limited',
    measurement: 'Views, clicks, direction requests, calls. The clearest local intent signal available.',
    targeting: 'Paid: search terms and radius. Organic: people already looking for a business like yours.',
    surprise:
      'Local posts expire after seven days unless they are an event or offer. A "post once a month" habit means an empty profile for three weeks out of four.',
  },

  linkedin: {
    channel: 'linkedin',
    label: 'LinkedIn',
    unit: 'one post, or one paid flight',
    maxCharacters: 3_000,
    limitBehaviour: 'Truncated after about 210 characters with a "…see more".',
    images: 'yes',
    video: 'yes',
    links: 'yes',
    personalisation: 'no',
    twoWay: 'yes',
    scheduling: 'yes',
    measurement: 'Impressions, reactions, clicks, follower growth. Job-title breakdowns on paid.',
    targeting: 'Paid: job title, company size, industry, seniority — the best B2B targeting anywhere, at the highest price.',
    surprise:
      'A post containing an external link reaches noticeably fewer people than one without. Putting the link in the first comment is the widely used workaround and it is not a myth.',
  },

  tiktok: {
    channel: 'tiktok',
    label: 'TikTok',
    unit: 'one video, or one paid flight',
    maxCharacters: 2_200,
    limitBehaviour: 'Caption only. The video itself is the message.',
    images: 'limited',
    video: 'yes',
    links: 'limited',
    personalisation: 'no',
    twoWay: 'yes',
    scheduling: 'yes',
    measurement: 'Views, watch time, shares. Watch-through rate is the number that predicts everything else.',
    targeting: 'Paid: interest and behaviour. Organic: the algorithm, which is genuinely willing to show a new account to strangers.',
    surprise:
      'The only major platform where an account with no followers can reach a hundred thousand people. It is also the one where creative burns out fastest — a winning video is usually finished within a fortnight.',
  },

  youtube: {
    channel: 'youtube',
    label: 'YouTube',
    unit: 'one video, or one paid flight',
    maxCharacters: 5_000,
    limitBehaviour: 'Description limit. Only the first ~150 characters show without expanding.',
    images: 'limited',
    video: 'yes',
    links: 'yes',
    personalisation: 'no',
    twoWay: 'yes',
    scheduling: 'yes',
    measurement: 'Views, watch time, traffic sources. The longest-lived measurement of any channel here.',
    targeting: 'Paid: topics, keywords, placements, and audiences. Organic: search and suggested.',
    surprise:
      'It is a search engine, not a feed. A video answering a question people type keeps earning views for years, which no other channel on this list does.',
  },

  x: {
    channel: 'x',
    label: 'X',
    unit: 'one post, or one paid flight',
    maxCharacters: 280,
    limitBehaviour: 'Hard limit for a standard account; longer posts require a paid subscription.',
    images: 'yes',
    video: 'yes',
    links: 'yes',
    personalisation: 'no',
    twoWay: 'yes',
    scheduling: 'yes',
    measurement: 'Impressions, engagements, link clicks.',
    targeting: 'Paid: keywords, follower lookalikes, interests.',
    surprise: 'Cheapest major-platform reach since 2023, and the reason is that advertisers left. Check what your ad appears next to.',
  },

  pinterest: {
    channel: 'pinterest',
    label: 'Pinterest',
    unit: 'one pin, or one paid flight',
    maxCharacters: 500,
    limitBehaviour: 'Description limit; the image carries the message.',
    images: 'yes',
    video: 'limited',
    links: 'yes',
    personalisation: 'no',
    twoWay: 'limited',
    scheduling: 'yes',
    measurement: 'Impressions, saves, outbound clicks.',
    targeting: 'Paid: keywords and interests, with unusually strong purchase intent.',
    surprise:
      'The only channel here with a long half-life. A pin can still be driving traffic a year later, which makes its true cost-per-click far lower than it looks on day one.',
  },
};

/** Channels a business can compare side by side, in a sensible reading order. */
export const COMPARABLE: Channel[] = [
  'email',
  'sms',
  'facebook',
  'instagram',
  'google_business',
  'linkedin',
  'tiktok',
  'youtube',
  'x',
  'pinterest',
];

export const SUPPORT_LABEL: Record<Support, string> = {
  yes: 'Yes',
  no: 'No',
  limited: 'Partly',
};
