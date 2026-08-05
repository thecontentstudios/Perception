import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { appUrl, providerFor } from '@/lib/oauth/providers';
import { safeEqual } from '@/lib/oauth/crypto';
import { saveGrant } from '@/lib/oauth/store';
import { reconcileAccount } from '@/lib/oauth/reconcile';
import type { Channel } from '@/lib/types';

/**
 * The other half of a real authorization: verify state, exchange the code for
 * tokens, encrypt and store them, then send the user back to Connections.
 *
 * Tokens never leave the server. The redirect carries only a status.
 */

function back(status: string, detail?: string) {
  const url = new URL(`${appUrl()}/connections`);
  url.searchParams.set('connect', status);
  if (detail) url.searchParams.set('detail', detail.slice(0, 300));
  return NextResponse.redirect(url.toString());
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ channel: string }> }
) {
  const { channel } = await params;
  const provider = providerFor(channel as Channel);
  if (!provider) return back('error', `Unknown provider "${channel}".`);

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');

  // The user pressed Cancel, or the platform refused.
  const platformError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (platformError) return back('denied', platformError);
  if (!code || !returnedState) return back('error', 'The platform did not return a code.');

  const jar = await cookies();
  const expectedState = jar.get(`pc_state_${provider.channel}`)?.value;
  // Without this check anyone could hand the user a crafted callback URL and
  // bind an attacker-controlled account to their workspace.
  if (!expectedState || !safeEqual(expectedState, returnedState)) {
    return back('error', 'State did not match — the authorization was not started here.');
  }

  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  if (!clientId || !clientSecret) return back('error', `${provider.label} credentials are missing.`);

  const redirectUri = `${appUrl()}/api/connect/${provider.channel}/callback`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (provider.tokenAuth === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    body.set('client_id', clientId);
  } else {
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
  }

  const verifier = jar.get(`pc_verifier_${provider.channel}`)?.value;
  if (provider.usesPkce) {
    if (!verifier) return back('error', 'PKCE verifier missing or expired — start the connection again.');
    body.set('code_verifier', verifier);
  }

  let payload: Record<string, unknown>;
  try {
    const res = await fetch(provider.tokenUrl, { method: 'POST', headers, body });
    const text = await res.text();
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return back('error', `Token endpoint returned non-JSON: ${text.slice(0, 160)}`);
    }
    if (!res.ok) {
      const msg =
        (payload.error_description as string) ??
        (typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error ?? payload));
      return back('error', `Token exchange failed (${res.status}): ${msg}`);
    }
  } catch (e) {
    return back('error', `Could not reach ${provider.label}: ${(e as Error).message}`);
  }

  const accessToken = payload.access_token as string | undefined;
  if (!accessToken) return back('error', 'No access_token in the response.');

  // Clear the one-time values as soon as they've served their purpose.
  jar.delete(`pc_state_${provider.channel}`);
  jar.delete(`pc_verifier_${provider.channel}`);

  try {
    saveGrant({
      channel: provider.channel,
      accessToken,
      refreshToken: (payload.refresh_token as string) ?? null,
      expiresInSec: typeof payload.expires_in === 'number' ? payload.expires_in : null,
      scopes:
        typeof payload.scope === 'string'
          ? payload.scope.split(/[ ,]/).filter(Boolean)
          : provider.scopes,
      accountLabel: provider.label,
      externalAccountId: String(payload.user_id ?? payload.open_id ?? 'unknown'),
    });
    await reconcileAccount({
      channel: provider.channel,
      accountLabel: provider.label,
      externalAccountId: String(payload.user_id ?? payload.open_id ?? 'unknown'),
      scopes:
        typeof payload.scope === 'string'
          ? payload.scope.split(/[ ,]/).filter(Boolean)
          : provider.scopes,
      expiresAt:
        typeof payload.expires_in === 'number' ? Date.now() + payload.expires_in * 1000 : null,
    });
  } catch (e) {
    return back('error', `Authorized, but the token could not be stored: ${(e as Error).message}`);
  }

  return back('success', `${provider.label} connected.`);
}
