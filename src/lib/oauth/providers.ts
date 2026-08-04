import type { Channel } from '../types';

/**
 * Real OAuth provider configuration.
 *
 * These are the actual authorize and token endpoints. Nothing here is
 * simulated — drop valid credentials into the environment and the connect
 * flow performs a genuine authorization against the platform.
 *
 * What this file cannot do for you: register the app. Every provider below
 * except Bluesky requires you to create an app in that platform's developer
 * console, obtain a client id and secret, and register the redirect URI. The
 * setup panel in Connections prints the exact values to paste where.
 */

export interface OAuthProvider {
  channel: Channel;
  label: string;
  /** Where the user is sent to approve. */
  authorizeUrl: string;
  /** Where we exchange the code for tokens. */
  tokenUrl: string;
  /** Env var names — never the values. */
  clientIdEnv: string;
  clientSecretEnv: string;
  scopes: string[];
  /** Scope list separator; platforms disagree. */
  scopeSeparator: string;
  /** PKCE is required by some, optional-but-good on others. */
  usesPkce: boolean;
  /** Some providers need the secret in a Basic auth header, not the body. */
  tokenAuth: 'body' | 'basic';
  /** Where to create the app. */
  consoleUrl: string;
  /** Extra params some providers demand on the authorize call. */
  extraAuthParams?: Record<string, string>;
  /** How to fetch the destinations this grant can publish to. */
  destinationsHint: string;
}

export const OAUTH_PROVIDERS: Partial<Record<Channel, OAuthProvider>> = {
  facebook: {
    channel: 'facebook',
    label: 'Facebook Pages',
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    clientIdEnv: 'META_APP_ID',
    clientSecretEnv: 'META_APP_SECRET',
    scopes: ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'],
    scopeSeparator: ',',
    usesPkce: false,
    tokenAuth: 'body',
    consoleUrl: 'https://developers.facebook.com/apps',
    destinationsHint: 'GET /me/accounts — the Pages this user administers',
  },

  instagram: {
    channel: 'instagram',
    label: 'Instagram professional',
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    clientIdEnv: 'META_APP_ID',
    clientSecretEnv: 'META_APP_SECRET',
    scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
    scopeSeparator: ',',
    usesPkce: false,
    tokenAuth: 'body',
    consoleUrl: 'https://developers.facebook.com/apps',
    destinationsHint: 'GET /me/accounts then ?fields=instagram_business_account per Page',
  },

  linkedin: {
    channel: 'linkedin',
    label: 'LinkedIn',
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
    scopes: ['r_organization_admin', 'w_organization_social', 'r_organization_social'],
    scopeSeparator: ' ',
    usesPkce: false,
    tokenAuth: 'body',
    consoleUrl: 'https://www.linkedin.com/developers/apps',
    destinationsHint: 'GET /rest/organizationAcls?q=roleAssignee — pages you administer',
  },

  google_business: {
    channel: 'google_business',
    label: 'Google Business Profile',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    scopes: ['https://www.googleapis.com/auth/business.manage'],
    scopeSeparator: ' ',
    usesPkce: true,
    tokenAuth: 'body',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    // Refresh tokens only come back with these two present.
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    destinationsHint: 'accounts.locations.list — your verified locations',
  },

  youtube: {
    channel: 'youtube',
    label: 'YouTube',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
    scopeSeparator: ' ',
    usesPkce: true,
    tokenAuth: 'body',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    destinationsHint: 'channels.list?mine=true',
  },

  x: {
    channel: 'x',
    label: 'X',
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    clientIdEnv: 'X_CLIENT_ID',
    clientSecretEnv: 'X_CLIENT_SECRET',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    scopeSeparator: ' ',
    usesPkce: true,
    tokenAuth: 'basic',
    consoleUrl: 'https://developer.x.com/en/portal/dashboard',
    destinationsHint: 'GET /2/users/me',
  },

  threads: {
    channel: 'threads',
    label: 'Threads',
    authorizeUrl: 'https://threads.net/oauth/authorize',
    tokenUrl: 'https://graph.threads.net/oauth/access_token',
    clientIdEnv: 'THREADS_APP_ID',
    clientSecretEnv: 'THREADS_APP_SECRET',
    scopes: ['threads_basic', 'threads_content_publish'],
    scopeSeparator: ',',
    usesPkce: false,
    tokenAuth: 'body',
    consoleUrl: 'https://developers.facebook.com/apps',
    destinationsHint: 'GET /me?fields=id,username',
  },

  pinterest: {
    channel: 'pinterest',
    label: 'Pinterest',
    authorizeUrl: 'https://www.pinterest.com/oauth/',
    tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
    clientIdEnv: 'PINTEREST_APP_ID',
    clientSecretEnv: 'PINTEREST_APP_SECRET',
    scopes: ['boards:read', 'pins:read', 'pins:write'],
    scopeSeparator: ',',
    usesPkce: false,
    tokenAuth: 'basic',
    consoleUrl: 'https://developers.pinterest.com/apps',
    destinationsHint: 'GET /v5/boards',
  },

  tiktok: {
    channel: 'tiktok',
    label: 'TikTok',
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    clientIdEnv: 'TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
    scopes: ['user.info.basic', 'video.publish'],
    scopeSeparator: ',',
    usesPkce: true,
    tokenAuth: 'body',
    consoleUrl: 'https://developers.tiktok.com/apps',
    destinationsHint: 'GET /v2/user/info/',
  },
};

export function providerFor(channel: Channel): OAuthProvider | null {
  return OAUTH_PROVIDERS[channel] ?? null;
}

export interface ProviderStatus {
  channel: Channel;
  label: string;
  /** True when both credentials are present in the environment. */
  configured: boolean;
  missing: string[];
  consoleUrl: string;
  /** The exact value to paste into the platform's redirect-URI field. */
  redirectUri: string;
  scopes: string[];
  destinationsHint: string;
}

/** Read credential presence without ever exposing the values. */
export function providerStatus(p: OAuthProvider, appUrl: string): ProviderStatus {
  const missing: string[] = [];
  if (!process.env[p.clientIdEnv]) missing.push(p.clientIdEnv);
  if (!process.env[p.clientSecretEnv]) missing.push(p.clientSecretEnv);
  return {
    channel: p.channel,
    label: p.label,
    configured: missing.length === 0,
    missing,
    consoleUrl: p.consoleUrl,
    redirectUri: `${appUrl}/api/connect/${p.channel}/callback`,
    scopes: p.scopes,
    destinationsHint: p.destinationsHint,
  };
}

export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}
