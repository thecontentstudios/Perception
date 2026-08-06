import type { Channel } from './types';

/**
 * What connecting each platform actually involves.
 *
 * Every permission we request is listed with a plain-English reason, because
 * an OAuth consent screen full of `pages_manage_posts` is where small-business
 * owners abandon setup. If we can't explain why we need a scope in one
 * sentence a non-technical owner understands, we shouldn't be requesting it.
 */

export interface ScopeRequest {
  /** The platform's scope string, shown verbatim so it matches their consent screen. */
  scope: string;
  /** Why we need it, in the owner's terms. */
  why: string;
  /** Optional scopes can be declined without breaking publishing. */
  required: boolean;
}

export interface ConnectSpec {
  channel: Channel;
  /** What the platform calls the thing you post to. */
  destinationNoun: string;
  destinationNounPlural: string;
  /** Prerequisites the owner must already have — checked before we start. */
  prerequisites: string[];
  scopes: ScopeRequest[];
  /** What happens after authorization, so the wait is not a mystery. */
  afterAuth: string;
  /** The honest constraint, if there is one. */
  caveat: string | null;
}

export const CONNECT_SPECS: Partial<Record<Channel, ConnectSpec>> = {
  facebook: {
    channel: 'facebook',
    destinationNoun: 'Page',
    destinationNounPlural: 'Pages',
    prerequisites: ['You are an admin of the Facebook Page(s) you want to post to'],
    scopes: [
      { scope: 'pages_show_list', why: 'See which Pages you manage, so you can choose where to post.', required: true },
      { scope: 'pages_manage_posts', why: 'Publish and schedule posts on the Pages you choose.', required: true },
      { scope: 'pages_read_engagement', why: 'Read likes, comments, and reach so your results show up in Analytics.', required: true },
      { scope: 'pages_messaging', why: 'Bring Page messages into your Inbox. Decline this and publishing still works.', required: false },
    ],
    afterAuth: 'We fetch the Pages you administer and ask which ones belong to which business.',
    caveat: null,
  },

  instagram: {
    channel: 'instagram',
    destinationNoun: 'professional account',
    destinationNounPlural: 'professional accounts',
    prerequisites: [
      'Your Instagram account is a Business or Creator account (not personal)',
      'It is linked to a Facebook Page you administer',
    ],
    scopes: [
      { scope: 'instagram_basic', why: 'Read your account name and profile so we can show you what we found.', required: true },
      { scope: 'instagram_content_publish', why: 'Publish posts and Reels at the time you schedule them.', required: true },
      { scope: 'instagram_manage_insights', why: 'Read reach and engagement for your posts.', required: true },
      { scope: 'instagram_manage_comments', why: 'Bring comments into your Inbox and let you reply from here.', required: false },
    ],
    afterAuth: 'We find the professional accounts linked to your Pages and map them to your businesses.',
    caveat:
      'Instagram has no native scheduling API — Perception holds the post and publishes it at the exact minute you chose.',
  },

  linkedin: {
    channel: 'linkedin',
    destinationNoun: 'company page',
    destinationNounPlural: 'company pages',
    prerequisites: ['You have an admin role on the LinkedIn company page'],
    scopes: [
      { scope: 'r_organization_admin', why: 'See which company pages you administer.', required: true },
      { scope: 'w_organization_social', why: 'Publish posts on those pages.', required: true },
      { scope: 'r_organization_social', why: 'Read post performance and comments.', required: true },
    ],
    afterAuth: 'We list the company pages you administer so you can pick which to publish to.',
    caveat: 'Posting on behalf of an organization requires Marketing Developer Platform approval.',
  },

  google_business: {
    channel: 'google_business',
    destinationNoun: 'business location',
    destinationNounPlural: 'business locations',
    prerequisites: ['Your Business Profile is verified', 'You are an owner or manager of the location'],
    scopes: [
      { scope: 'business.manage', why: 'Post updates, offers, and events to your locations, and read reviews into your Inbox.', required: true },
    ],
    afterAuth: 'We list your verified locations and map each to the right business.',
    caveat: 'Unverified locations cannot receive posts — Google rejects them.',
  },

  x: {
    channel: 'x',
    destinationNoun: 'account',
    destinationNounPlural: 'accounts',
    prerequisites: ['A paid X API tier that permits posting'],
    scopes: [
      { scope: 'tweet.read', why: 'Read your posts and their performance.', required: true },
      { scope: 'tweet.write', why: 'Publish posts at the time you schedule them.', required: true },
      { scope: 'users.read', why: 'Confirm which account we are posting as.', required: true },
    ],
    afterAuth: 'We confirm the authorized handle and enable it as a destination.',
    caveat: 'X charges for write access. Confirm the tier cost before relying on this channel.',
  },

  threads: {
    channel: 'threads',
    destinationNoun: 'profile',
    destinationNounPlural: 'profiles',
    prerequisites: ['A Threads profile linked to your Instagram account'],
    scopes: [
      { scope: 'threads_basic', why: 'Read your profile so we can confirm the account.', required: true },
      { scope: 'threads_content_publish', why: 'Publish posts on your behalf.', required: true },
    ],
    afterAuth: 'We confirm the profile and enable it alongside your Instagram destination.',
    caveat: null,
  },

  bluesky: {
    channel: 'bluesky',
    destinationNoun: 'handle',
    destinationNounPlural: 'handles',
    prerequisites: ['Your Bluesky handle and an app password (not your main password)'],
    scopes: [
      { scope: 'app-password session', why: 'Create posts as you. App passwords can be revoked without changing your login.', required: true },
    ],
    afterAuth: 'We open an authenticated session and enable the handle immediately.',
    caveat: 'Open protocol — no app review, no waiting. The fastest channel to switch on.',
  },

  email: {
    channel: 'email',
    destinationNoun: 'sender domain',
    destinationNounPlural: 'sender domains',
    prerequisites: ['You can add DNS records for the domain you send from'],
    scopes: [
      { scope: 'SPF', why: 'Proves our sending servers are allowed to send as you.', required: true },
      { scope: 'DKIM', why: 'Signs your email so inboxes can verify it was not tampered with.', required: true },
      { scope: 'DMARC', why: 'Tells inboxes what to do with mail that fails the checks above.', required: true },
    ],
    afterAuth: 'We give you three DNS records and verify them — usually minutes, sometimes a few hours.',
    caveat: 'Campaigns cannot send until all three verify. This protects your domain reputation.',
  },

  /**
   * Texting, which is the only channel here where connecting costs money
   * before a single message is sent.
   *
   * Every other spec in this file describes an authorization: click a button,
   * grant a scope, done. SMS is a procurement: a business rents a number,
   * registers its identity with the US carriers, and registers each use case
   * separately — $44 once and $11.15 a month before the first text goes out,
   * and up to a fortnight of waiting. Presenting that as "Connect SMS" next to
   * "Connect Instagram" would be the most expensive omission in the product.
   */
  sms: {
    channel: 'sms',
    destinationNoun: 'sending number',
    destinationNounPlural: 'sending numbers',
    prerequisites: [
      'You have a registered business name and EIN (US carriers verify both)',
      'You collect explicit opt-in before texting anyone — a checkbox that is not pre-ticked',
      'You accept the setup cost: $44 once, then about $11.15 a month',
    ],
    scopes: [
      { scope: 'Brand registration', why: 'US carriers require every business sending texts to identify itself. Unregistered messages are filtered — you pay for them and they do not arrive.', required: true },
      { scope: 'Campaign registration', why: 'One per use case. Promotional texts and appointment reminders are separate registrations with separate approval.', required: true },
      { scope: 'Number provisioning', why: 'The number your texts come from. Toll-free costs about the same and clears faster.', required: true },
    ],
    afterAuth:
      'Brand registration usually clears in a day. Campaign registration takes two days to two weeks depending on the use case, and nothing can be sent until it does.',
    caveat:
      'Marketing texts are restricted to 8am–9pm in the recipient’s time zone, and the penalty for getting consent wrong runs $500–$1,500 per message. On a 400-person list that is a business-ending number, so consent is enforced here rather than trusted.',
  },

  tiktok: {
    channel: 'tiktok',
    destinationNoun: 'account',
    destinationNounPlural: 'accounts',
    prerequisites: ['A TikTok account you can log into'],
    scopes: [
      { scope: 'user.info.basic', why: 'Confirm which account we are posting as.', required: true },
      { scope: 'video.publish', why: 'Upload and publish videos you schedule.', required: true },
    ],
    afterAuth: 'We confirm the account and enable video destinations.',
    caveat:
      'Until our app clears TikTok’s content audit, uploads land as private drafts you finish in the app.',
  },

  youtube: {
    channel: 'youtube',
    destinationNoun: 'channel',
    destinationNounPlural: 'channels',
    prerequisites: ['A YouTube channel on the Google account you authorize'],
    scopes: [
      { scope: 'youtube.upload', why: 'Upload the videos you schedule.', required: true },
      { scope: 'youtube.readonly', why: 'Read views and engagement for your uploads.', required: true },
    ],
    afterAuth: 'We list the channels on the account and enable the ones you pick.',
    caveat: 'Uploads from an unaudited API project stay private until Google completes its compliance audit.',
  },

  pinterest: {
    channel: 'pinterest',
    destinationNoun: 'board',
    destinationNounPlural: 'boards',
    prerequisites: ['A Pinterest business account'],
    scopes: [
      { scope: 'boards:read', why: 'List your boards so you can choose where Pins go.', required: true },
      { scope: 'pins:write', why: 'Create Pins on the boards you choose.', required: true },
    ],
    afterAuth: 'We list your boards — each board is a separate destination.',
    caveat: null,
  },

  website: {
    channel: 'website',
    destinationNoun: 'site',
    destinationNounPlural: 'sites',
    prerequisites: ['An admin login for the site, or the ability to install a plugin'],
    scopes: [
      { scope: 'posts.write', why: 'Publish blog posts and landing pages.', required: true },
      { scope: 'pages.write', why: 'Place and remove promotional banners.', required: true },
    ],
    afterAuth: 'We verify the connection and register the site as a destination.',
    caveat: null,
  },
};

export function connectSpecFor(channel: Channel): ConnectSpec | null {
  return CONNECT_SPECS[channel] ?? null;
}
