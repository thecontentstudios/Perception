import { NextResponse } from 'next/server';
import { OAUTH_PROVIDERS, appUrl, providerStatus, type OAuthProvider } from '@/lib/oauth/providers';
import { hasEncryptionKey } from '@/lib/oauth/crypto';
import { summaries } from '@/lib/oauth/store';

/**
 * What is actually wired up right now.
 *
 * Reports which providers have credentials, which are missing, the exact
 * redirect URI to register, and which grants are live — without ever
 * returning a credential or a token.
 */
export async function GET() {
  const base = appUrl();
  const providers = Object.values(OAUTH_PROVIDERS)
    .filter((p): p is OAuthProvider => Boolean(p))
    .map((p) => providerStatus(p, base));

  let grants: ReturnType<typeof summaries> = [];
  let storeError: string | null = null;
  try {
    grants = summaries();
  } catch (e) {
    storeError = (e as Error).message;
  }

  return NextResponse.json({
    appUrl: base,
    encryptionKeySet: hasEncryptionKey(),
    // Bluesky is listed apart because it needs no app registration at all.
    bluesky: {
      channel: 'bluesky',
      label: 'Bluesky',
      needsAppRegistration: false,
      howTo: 'Bluesky → Settings → App Passwords. Paste the handle and app password; no developer console, no review.',
      endpoint: '/api/connect/bluesky',
    },
    providers,
    configuredCount: providers.filter((p) => p.configured).length,
    grants,
    storeError,
  });
}
