import type { Channel } from '../types';

/**
 * The publisher contract.
 *
 * A connector *authorizes* and *describes* a platform; a publisher actually
 * puts a post on it. They are separate because the shapes differ: connectors
 * are pure and synchronous where they validate, publishers are async, hold
 * credentials, and need per-account context (a Bluesky DID, a Mastodon host).
 *
 * Two implementations exist so far — AT Protocol XRPC and Mastodon REST — and
 * they were deliberately chosen to be dissimilar. If the same interface fits
 * a repo-and-DID model *and* a per-user-hostname REST model, it will fit the
 * Meta/LinkedIn/Google shapes too.
 */

export interface PublishOutcome {
  ok: boolean;
  /** Platform's own id for the post. */
  id?: string;
  /** Human-clickable permalink. */
  url?: string;
  error?: string;
  /** True when the fix is reconnection, not a retry. */
  needsReconnect?: boolean;
}

export interface PublisherCapabilities {
  channel: Channel;
  /** Hard limit the platform enforces. Null when there isn't one. */
  maxLength: number | null;
  /**
   * How length is counted. Platforms genuinely differ, and counting wrong
   * either rejects valid posts or lets over-long ones reach a 4xx.
   */
  lengthUnit: 'grapheme' | 'codepoint' | 'utf16';
  /** True when the limit is set by the account's own server, not the protocol. */
  limitIsPerInstance: boolean;
}

/**
 * What a platform will tell us about a post after it is up.
 *
 * Every field is nullable, and the nulls are the informative part. Neither
 * platform we can publish to reports impressions — not behind a paid tier,
 * not to the post's own author: the number is absent from the response. A
 * `0` here would tell an owner nobody saw their post, so the shape refuses to
 * let an implementation say that by accident.
 */
export interface PostMetrics {
  impressions: number | null;
  /** Likes, boosts, replies — whatever the platform counts as interaction. */
  engagements: number | null;
  /** Clicks the *platform* counted, which is never our tracked-link count. */
  clicks: number | null;
  /** Present when the post is gone: deleted by the owner, or by the instance. */
  missing?: boolean;
}

export interface Publisher {
  capabilities: PublisherCapabilities;
  /** Count text the way this platform counts it. */
  measure(text: string): number;
  /** Cheap local validation before any network call. */
  check(text: string): { ok: boolean; length: number; error?: string };
  /** Publish. Implementations handle their own token refresh. */
  publish(text: string, opts: { idempotencyKey?: string }): Promise<PublishOutcome>;
  /** Confirm the stored credential still works, and say who it belongs to. */
  verify(): Promise<{ ok: boolean; account?: string; error?: string }>;
  /**
   * Read the platform's own numbers for a post we published.
   *
   * Takes the id `publish` returned. Absent on publishers whose platform has
   * no metrics endpoint at all — an optional method is honest where a method
   * that always returns nulls would look like a bug.
   */
  fetchMetrics?(postId: string): Promise<{ ok: boolean; metrics?: PostMetrics; error?: string }>;
}
