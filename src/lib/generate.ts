import { addDays } from './dates';
import { TEMPLATES } from './demo-data';
import type {
  Campaign,
  Channel,
  ChannelVariation,
  ContentItem,
  ContentFormat,
} from './types';

/**
 * The campaign generator behind Step 3 of the composer.
 *
 * In production this calls the model with the brand kit, source material, and
 * template guidance. In the prototype it is deterministic: it assembles
 * channel-appropriate drafts and a suggested posting schedule from the same
 * inputs, so the composer flow — including "AI creates drafts, never
 * publishes without permission" — is fully clickable.
 */

export interface ComposerInput {
  brandId: string;
  templateId: string | null;
  name: string;
  promoting: string;
  action: string; // CTA label, e.g. "Request a Quote"
  actionUrl: string;
  audience: string;
  startDate: string;
  endDate: string;
  offer: string;
  hasDeadline: boolean;
  sourceNotes: string[];
  channels: Channel[];
  colorIndex: number;
}

export interface GeneratedCampaign {
  campaign: Campaign;
  items: ContentItem[];
  variations: ChannelVariation[];
}

let seq = 1;
const nid = (prefix: string) => `${prefix}-gen${seq++}`;

const POST_TIME: Record<Channel, string> = {
  facebook: '09:30',
  instagram: '12:00',
  linkedin: '09:00',
  google_business: '10:00',
  email: '08:00',
  website: '08:00',
  tiktok: '17:00',
  youtube: '15:00',
  x: '09:15',
  threads: '12:30',
  bluesky: '13:00',
  pinterest: '20:00',
  reddit: '11:00',
  nextdoor: '10:30',
  snapchat: '18:00',
  whatsapp: '10:00',
  sms: '10:30',
};

const FORMAT_FOR: Record<Channel, ContentFormat> = {
  facebook: 'post',
  instagram: 'post',
  linkedin: 'post',
  google_business: 'update',
  email: 'email',
  website: 'banner',
  tiktok: 'reel',
  youtube: 'video',
  x: 'post',
  threads: 'post',
  bluesky: 'post',
  pinterest: 'pin',
  reddit: 'post',
  nextdoor: 'post',
  snapchat: 'story',
  whatsapp: 'message',
  sms: 'sms',
};

function hashtagsFrom(promoting: string, extra: string[]): string[] {
  const words = promoting
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 2)
    .map((w) => w.replace(/\s/g, ''));
  return [...new Set([...words, ...extra])].slice(0, 4);
}

function endShort(endDate: string): string {
  const [, m, d] = endDate.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}`;
}

export function generateCampaign(input: ComposerInput): GeneratedCampaign {
  const utm = input.name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);

  const campaign: Campaign = {
    id: nid('c'),
    brandId: input.brandId,
    name: input.name,
    status: 'draft',
    goal: TEMPLATES.find((t) => t.id === input.templateId)?.goal ?? 'quote_requests',
    audience: input.audience,
    startDate: input.startDate,
    endDate: input.endDate,
    offer: input.offer || null,
    cta: { label: input.action, url: input.actionUrl },
    colorIndex: input.colorIndex,
    utmCode: utm || 'new-campaign',
    createdByUserId: 'u-dana',
    templateId: input.templateId,
    description: input.promoting,
  };

  const deadline = input.hasDeadline ? ` through ${endShort(input.endDate)}` : '';
  const offerLine = input.offer ? `${input.offer}${deadline}.` : '';
  const cta = { label: input.action, url: input.actionUrl };

  const items: ContentItem[] = [];
  const variations: ChannelVariation[] = [];

  const baseV = {
    campaignId: campaign.id,
    status: 'draft' as const,
    publishedAt: null,
    subject: null as string | null,
    preheader: null as string | null,
    hasUnsubscribeFooter: true,
    cta,
    assigneeUserId: null,
    overridden: false,
    failure: null,
    mediaIds: [] as string[],
    hashtags: [] as string[],
  };

  const social = input.channels.filter((c) =>
    [
      'facebook', 'instagram', 'linkedin', 'google_business', 'tiktok', 'youtube',
      'x', 'threads', 'bluesky', 'pinterest', 'reddit', 'nextdoor', 'snapchat',
    ].includes(c)
  );

  // --- Announcement wave (staggered across the first two days) --------------
  const announce: ContentItem = {
    id: nid('ci'),
    campaignId: campaign.id,
    title: 'Announcement',
    kind: 'social',
    coreMessage: `${input.promoting} ${offerLine}`.trim(),
  };
  if (social.length > 0) items.push(announce);

  social.forEach((channel, i) => {
    const day = addDays(input.startDate, i < 2 ? 0 : 1);
    const shortForm = channel === 'x' || channel === 'threads' || channel === 'bluesky';
    const body = shortForm
      ? `${input.offer ? input.offer + deadline + '. ' : ''}${input.promoting}`.trim().slice(0, channel === 'x' ? 270 : 290)
      : channel === 'instagram'
        ? `${input.promoting} ✨ ${offerLine} ${input.action} — link in bio.`.trim()
        : channel === 'linkedin'
          ? `For ${input.audience.toLowerCase() || 'our customers'}: ${input.promoting.toLowerCase().replace(/\.$/, '')}. ${offerLine}`.trim()
          : channel === 'google_business' || channel === 'pinterest' || channel === 'nextdoor'
            ? `${input.promoting} ${offerLine}`.trim()
            : channel === 'reddit'
              ? `${input.promoting} ${offerLine} Happy to answer questions in the comments.`.trim()
              : `${input.promoting} ${offerLine} Tap below to ${input.action.toLowerCase()}.`.trim();
    variations.push({
      ...baseV,
      id: nid('v'),
      contentItemId: announce.id,
      channel,
      format: FORMAT_FOR[channel],
      scheduledAt: `${day}T${POST_TIME[channel]}`,
      body,
      hashtags: channel === 'instagram' ? hashtagsFrom(input.promoting, ['local']) : [],
    });
  });

  // --- Mid-run proof point ---------------------------------------------------
  const midChannels = social.filter((c) => c === 'facebook' || c === 'instagram').slice(0, 2);
  if (midChannels.length > 0) {
    const mid: ContentItem = {
      id: nid('ci'),
      campaignId: campaign.id,
      title: 'Proof point (photos or testimonial)',
      kind: 'social',
      coreMessage: `Show, don’t tell: recent results, a customer quote, or before/after photos for “${input.name}”.`,
    };
    items.push(mid);
    const midDate = addDays(input.startDate, Math.max(3, Math.round(daysBetween(input.startDate, input.endDate) / 2)));
    for (const channel of midChannels) {
      variations.push({
        ...baseV,
        id: nid('v'),
        contentItemId: mid.id,
        channel,
        format: 'post',
        scheduledAt: `${midDate}T${POST_TIME[channel]}`,
        body:
          channel === 'instagram'
            ? `The results speak for themselves 📸 (attach your best recent photo). ${offerLine} Link in bio.`.trim()
            : `Here’s what that looks like in practice — (attach a recent photo or customer quote). ${offerLine}`.trim(),
        hashtags: channel === 'instagram' ? hashtagsFrom(input.promoting, ['results']) : [],
      });
    }
  }

  // --- Email sequence --------------------------------------------------------
  if (input.channels.includes('email')) {
    const emailItem: ContentItem = {
      id: nid('ci'),
      campaignId: campaign.id,
      title: 'Announcement email',
      kind: 'email',
      coreMessage: `${input.promoting} ${offerLine}`.trim(),
    };
    items.push(emailItem);
    variations.push({
      ...baseV,
      id: nid('v'),
      contentItemId: emailItem.id,
      channel: 'email',
      format: 'email',
      scheduledAt: `${addDays(input.startDate, 2)}T08:00`,
      subject: input.offer ? `${input.offer}${deadline}` : input.name,
      preheader: input.promoting.slice(0, 90),
      body: `Hi {{first_name}},\n\n${input.promoting}\n\n${offerLine ? offerLine + '\n\n' : ''}Ready when you are — it takes about a minute.`,
    });

    if (input.hasDeadline) {
      const lastCall: ContentItem = {
        id: nid('ci'),
        campaignId: campaign.id,
        title: 'Last-call email',
        kind: 'email',
        coreMessage: `Last call before ${endShort(input.endDate)}.`,
      };
      items.push(lastCall);
      variations.push({
        ...baseV,
        id: nid('v'),
        contentItemId: lastCall.id,
        channel: 'email',
        format: 'email',
        scheduledAt: `${addDays(input.endDate, -5)}T08:00`,
        subject: `Last call: ${(input.offer || input.name).toLowerCase()} ends ${endShort(input.endDate)}`,
        preheader: 'A quick heads-up before the window closes.',
        body: `Hi {{first_name}},\n\nQuick heads-up: this wraps up on ${endShort(input.endDate)}.\n\n${input.offer ? `If you’ve been meaning to grab it — ${input.offer.toLowerCase()} — this is the week.` : 'If you’ve been meaning to act on this, this is the week.'}`,
      });
    }
  }

  // --- Website ---------------------------------------------------------------
  if (input.channels.includes('website')) {
    const web: ContentItem = {
      id: nid('ci'),
      campaignId: campaign.id,
      title: 'Website banner + landing page',
      kind: 'website',
      coreMessage: `${input.name} — ${offerLine || input.promoting}`,
    };
    items.push(web);
    variations.push({
      ...baseV,
      id: nid('v'),
      contentItemId: web.id,
      channel: 'website',
      format: 'banner',
      scheduledAt: `${input.startDate}T08:00`,
      body: `${input.name} — ${offerLine || input.promoting}`.trim(),
    });
    variations.push({
      ...baseV,
      id: nid('v'),
      contentItemId: web.id,
      channel: 'website',
      format: 'landing_page',
      scheduledAt: `${input.startDate}T08:00`,
      body: `Landing page for ${input.name}: the offer up top, what's included, photos, a testimonial, and the ${input.action} form. Tagged link (utm_campaign=${campaign.utmCode}) and QR code are created automatically.`,
    });
  }

  // --- SMS -------------------------------------------------------------------
  if (input.channels.includes('sms')) {
    const sms: ContentItem = {
      id: nid('ci'),
      campaignId: campaign.id,
      title: 'SMS nudge',
      kind: 'sms',
      coreMessage: `${input.offer || input.name}`,
    };
    items.push(sms);
    variations.push({
      ...baseV,
      id: nid('v'),
      contentItemId: sms.id,
      channel: 'sms',
      format: 'sms',
      scheduledAt: `${addDays(input.startDate, 4)}T10:30`,
      body: `${input.offer || input.name}${deadline}. ${input.action}: ${input.actionUrl} Reply STOP to opt out.`.trim(),
    });
  }

  return { campaign, items, variations };
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000);
}
