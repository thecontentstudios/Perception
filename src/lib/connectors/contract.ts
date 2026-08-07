import type {
  AspectRatio,
  Channel,
  ChannelMetrics,
  ChannelVariation,
  ConnectedAccount,
  ContentFormat,
  Conversation,
  MediaAsset,
  PreflightWarning,
} from '../types';

/**
 * The connector contract.
 *
 * Every destination — social platform, email, website — implements this one
 * interface. Platform adapters translate the universal campaign
 * (ChannelVariation + MediaAssets) into their own format, so new destinations
 * can be added without rewriting the campaign system.
 *
 * In the production system the publishing workers consume this interface from
 * background jobs (BullMQ) with retries, idempotency keys, and audit logging.
 * In this prototype the operations are simulated, but the shapes are the real
 * ones the workers would use.
 */

export interface ConnectorDestination {
  id: string;
  name: string;
  kind: string; // "Page", "Business account", "Company page", "Location"…
}

export interface PublishReceipt {
  externalId: string;
  url: string | null;
  publishedAt: string;
}

export interface NormalizedError {
  code:
    | 'auth_expired'
    | 'permission_missing'
    | 'rate_limited'
    | 'media_rejected'
    | 'content_rejected'
    | 'destination_missing'
    | 'network'
    | 'unknown';
  message: string;
  retryable: boolean;
  /** what the user should do, when the fix is theirs (e.g. reconnect) */
  userAction: string | null;
}

export interface ConnectorCapabilities {
  channel: Channel;
  /** the official API this adapter is built on */
  api: string;
  availability: 'mvp' | 'planned';
  formats: ContentFormat[];
  /** null = no ratio restrictions */
  allowedRatios: AspectRatio[] | null;
  maxVideoSec: number | null;
  maxChars: number | null;
  maxHashtags: number | null;
  /** platform offers native scheduled publishing (else we enqueue and publish at time) */
  supportsNativeScheduling: boolean;
  supportsEdit: boolean;
  supportsDelete: boolean;
  supportsMetrics: boolean;
  supportsInboxEvents: boolean;
  /** app-review / audit constraints that gate go-live and must start early */
  reviewNotes: string | null;
}

export interface ConnectorAdapter {
  capabilities: ConnectorCapabilities;

  /** Begin OAuth (or domain setup for email). Returns the URL to send the user to. */
  connect(): Promise<{ authorizeUrl: string }>;

  /** Refresh tokens before expiry; called by the token-health scheduler. */
  refreshAuth(account: ConnectedAccount): Promise<{ expiresAt: string }>;

  /** Pages / accounts / locations the connected identity can publish to. */
  listDestinations(account: ConnectedAccount): Promise<ConnectorDestination[]>;

  /**
   * Channel-specific content validation. Pure and synchronous so the UI can
   * run it live while the user edits. Cross-channel checks (connection
   * health, same-day promotion density, alt text, CTA) live in the shared
   * preflight engine.
   */
  validate(variation: ChannelVariation, assets: MediaAsset[]): PreflightWarning[];

  /** Upload media ahead of publish; returns the platform's media reference. */
  uploadMedia(asset: MediaAsset): Promise<{ mediaRef: string }>;

  /** Publish immediately. Idempotency key prevents double-posting on retry. */
  publish(
    variation: ChannelVariation,
    assets: MediaAsset[],
    idempotencyKey: string
  ): Promise<PublishReceipt>;

  /** Schedule via the platform's native scheduler when supported, else enqueue locally. */
  enqueue(variation: ChannelVariation): Promise<{ jobId: string }>;

  /** Edit a live post where the platform supports it. */
  edit?(externalId: string, variation: ChannelVariation): Promise<void>;

  /** Delete a live post where the platform supports it. */
  remove?(externalId: string): Promise<void>;

  /** Poll publication status (processing → live) for async platforms. */
  getStatus(externalId: string): Promise<'processing' | 'live' | 'removed'>;

  /** Pull per-post metrics into the analytics pipeline. */
  collectMetrics(externalId: string): Promise<Partial<ChannelMetrics>>;

  /** Pull comments / messages / reviews into the unified inbox. */
  pullEvents(since: string): Promise<Conversation[]>;

  /** Map raw platform errors to one normalized shape for retry logic + UI. */
  normalizeError(raw: unknown): NormalizedError;
}

// ---------------------------------------------------------------------------
// Shared helpers for adapters
// ---------------------------------------------------------------------------

export function warning(
  id: string,
  severity: PreflightWarning['severity'],
  message: string,
  fix: string | null = null
): PreflightWarning {
  return { id, severity, message, fix };
}

/**
 * Simulated operations for the prototype. Deterministic, no network. Each
 * real adapter replaces these with calls to the platform API.
 */
export function simulatedOperations(
  channel: Channel
): Omit<ConnectorAdapter, 'capabilities' | 'validate'> {
  return {
    async connect() {
      return { authorizeUrl: `https://connect.example/oauth/${channel}` };
    },
    async refreshAuth() {
      return { expiresAt: '2027-01-01' };
    },
    async listDestinations() {
      return [];
    },
    async uploadMedia(asset: MediaAsset) {
      return { mediaRef: `${channel}-media-${asset.id}` };
    },
    async publish(variation: ChannelVariation, _assets: MediaAsset[], idempotencyKey: string) {
      return {
        externalId: `${channel}-${variation.id}-${idempotencyKey}`,
        url: null,
        publishedAt: variation.scheduledAt ?? '',
      };
    },
    async enqueue(variation: ChannelVariation) {
      return { jobId: `job-${channel}-${variation.id}` };
    },
    async getStatus() {
      return 'live' as const;
    },
    async collectMetrics() {
      return {};
    },
    async pullEvents() {
      return [];
    },
    normalizeError(raw: unknown): NormalizedError {
      return {
        code: 'unknown',
        message: raw instanceof Error ? raw.message : String(raw),
        retryable: true,
        userAction: null,
      };
    },
  };
}

/** Shared caption/duration/ratio checks driven by an adapter's capability sheet. */
export function capabilityChecks(
  caps: ConnectorCapabilities,
  variation: ChannelVariation,
  assets: MediaAsset[]
): PreflightWarning[] {
  const out: PreflightWarning[] = [];
  const label =
    caps.channel === 'google_business' ? 'Google Business Profile' : caps.api.split(' ')[0];

  if (caps.maxChars !== null && variation.body.length > caps.maxChars) {
    out.push(
      warning(
        'caption-length',
        'block',
        `This text is ${variation.body.length - caps.maxChars} characters over the ${caps.maxChars}-character limit for this destination.`,
        'Shorten the text or let Perception trim it to fit.'
      )
    );
  }

  if (caps.maxHashtags !== null && variation.hashtags.length > caps.maxHashtags) {
    out.push(
      warning(
        'hashtag-count',
        'warn',
        `${variation.hashtags.length} hashtags exceeds the ${caps.maxHashtags} allowed here.`,
        'Remove the extras — the first ones are kept.'
      )
    );
  }

  for (const asset of assets) {
    if (asset.kind === 'video' && caps.maxVideoSec !== null && (asset.durationSec ?? 0) > caps.maxVideoSec) {
      out.push(
        warning(
          'video-too-long',
          'block',
          `This video is too long for this destination (${asset.durationSec}s, limit ${caps.maxVideoSec}s).`,
          'Trim the video or switch this slot to a shorter cut.'
        )
      );
    }
    if (
      asset.kind === 'image' &&
      caps.allowedRatios !== null &&
      !caps.allowedRatios.includes(asset.aspectRatio)
    ) {
      out.push(
        warning(
          'image-ratio',
          'warn',
          `${label} requires a different image ratio — “${asset.name}” is ${asset.aspectRatio}, supported: ${caps.allowedRatios.join(', ')}.`,
          'Crop the image in the editor or pick another asset.'
        )
      );
    }
  }

  return out;
}
