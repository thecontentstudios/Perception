import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { appUrl, providerFor } from '@/lib/oauth/providers';
import { hasEncryptionKey, pkceChallenge, randomUrlSafe } from '@/lib/oauth/crypto';
import type { Channel } from '@/lib/types';

/**
 * Begin a real authorization.
 *
 * Builds the platform's authorize URL, mints a `state` and (where the
 * provider supports it) a PKCE verifier, stashes both in httpOnly cookies,
 * and redirects. This is the genuine article — the user lands on Meta's or
 * LinkedIn's own consent screen.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ channel: string }> }
) {
  const { channel } = await params;
  const provider = providerFor(channel as Channel);

  if (!provider) {
    return NextResponse.json(
      { error: `No OAuth provider configured for "${channel}".` },
      { status: 404 }
    );
  }

  // Fail loudly and usefully rather than bouncing the user to a platform that
  // will reject them for a missing client_id.
  const clientId = process.env[provider.clientIdEnv];
  if (!clientId) {
    return NextResponse.json(
      {
        error: `${provider.label} is not configured.`,
        missing: provider.clientIdEnv,
        fix: `Create an app at ${provider.consoleUrl}, then set ${provider.clientIdEnv} and ${provider.clientSecretEnv} in .env.local.`,
        redirectUriToRegister: `${appUrl()}/api/connect/${provider.channel}/callback`,
      },
      { status: 428 }
    );
  }

  if (!hasEncryptionKey()) {
    return NextResponse.json(
      {
        error: 'TOKEN_ENCRYPTION_KEY is not set, so a returned token could not be stored safely.',
        fix: 'Run `openssl rand -base64 32` and set TOKEN_ENCRYPTION_KEY in .env.local.',
      },
      { status: 428 }
    );
  }

  const state = randomUrlSafe();
  const redirectUri = `${appUrl()}/api/connect/${provider.channel}/callback`;

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: provider.scopes.join(provider.scopeSeparator),
    state,
    ...(provider.extraAuthParams ?? {}),
  });

  const jar = await cookies();
  const secure = appUrl().startsWith('https');
  // 10 minutes is plenty for a consent screen and limits the replay window.
  const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: 600 };

  jar.set(`pc_state_${provider.channel}`, state, cookieOpts);

  if (provider.usesPkce) {
    const verifier = randomUrlSafe(64);
    query.set('code_challenge', pkceChallenge(verifier));
    query.set('code_challenge_method', 'S256');
    jar.set(`pc_verifier_${provider.channel}`, verifier, cookieOpts);
  }

  return NextResponse.redirect(`${provider.authorizeUrl}?${query.toString()}`);
}
