import { NextResponse } from 'next/server';
import { hasEncryptionKey } from '@/lib/oauth/crypto';
import { removeGrant, saveGrant } from '@/lib/oauth/store';
import { reconcileAccount, reconcileDisconnect } from '@/lib/oauth/reconcile';
import { handle, require_ } from '@/lib/auth/guard';
import { fetchInstanceLimits, mastodonPublisher } from '@/lib/publishers/mastodon';

/**
 * Connect a Mastodon account with an instance host and an access token.
 *
 * No developer console: the owner creates the token themselves at
 * <their instance>/settings/applications with the `write:statuses` scope. We
 * verify it against the real server, read that instance's actual character
 * limit, and store both.
 */

function normalizeHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^@/, '');
}

export async function POST(request: Request) {
  return handle(async () => {
  // Connecting an account is an admin action: it grants this workspace the
  // ability to post as the business.
  const principal = await require_('manage_connections');
  let host: string;
  let token: string;
  try {
    const body = (await request.json()) as { host?: string; accessToken?: string };
    host = normalizeHost(body.host ?? '');
    token = (body.accessToken ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (!host || !token) {
    return NextResponse.json(
      { error: 'Both an instance address and an access token are required.' },
      { status: 400 }
    );
  }
  const isLoopback = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  if (!isLoopback && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
    return NextResponse.json(
      {
        error: `"${host}" doesn't look like an instance address.`,
        fix: 'Use the domain you log in at, for example mastodon.social.',
      },
      { status: 400 }
    );
  }

  if (!hasEncryptionKey()) {
    return NextResponse.json(
      {
        error: 'TOKEN_ENCRYPTION_KEY is not set, so the token could not be stored safely.',
        fix: 'Run `openssl rand -base64 32` and set TOKEN_ENCRYPTION_KEY in .env.local.',
      },
      { status: 428 }
    );
  }

  // Verify against the real instance before storing anything.
  let account: string;
  try {
    const scheme = isLoopback ? 'http' : 'https';
    const res = await fetch(`${scheme}://${host}/api/v1/accounts/verify_credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        {
          error: `${host} rejected that token.`,
          fix: `Create one at https://${host}/settings/applications with the write:statuses scope.`,
        },
        { status: 401 }
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: `${host} returned ${res.status} — is that the right instance?` },
        { status: 502 }
      );
    }
    const me = (await res.json()) as { username: string };
    account = me.username;
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach ${host}: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  // Read the instance's own limit rather than assuming the 500 default —
  // plenty of instances raise it, and assuming would reject valid posts.
  const limits = await fetchInstanceLimits(host);
  const limit = limits.limit ?? 500;

  saveGrant({
    channel: 'mastodon',
    accessToken: token,
    refreshToken: null,
    expiresInSec: null, // Mastodon tokens don't expire; they get revoked
    scopes: ['write:statuses', 'read:accounts'],
    accountLabel: `@${account}@${host}`,
    // host|account|limit — per-instance facts live with the grant they belong to
    externalAccountId: `${host}|${account}|${limit}`,
  });
  // The grant is only half of "connected" — the workspace row is what every
  // screen and preflight reads.
  await reconcileAccount({
    organizationId: principal.organizationId,
    connectedById: principal.userId,
    channel: 'mastodon',
    accountLabel: `@${account}@${host}`,
    externalAccountId: `${host}|${account}|${limit}`,
    scopes: ['write:statuses', 'read:accounts'],
    expiresAt: null,
  });

  return NextResponse.json({
    connected: true,
    account: `@${account}@${host}`,
    instance: limits.title ?? host,
    characterLimit: limit,
    note:
      limit !== 500
        ? `This instance allows ${limit} characters, not the usual 500 — we read it from the server.`
        : undefined,
  });
  });
}

export async function GET() {
  const v = await mastodonPublisher.verify();
  return NextResponse.json(v.ok ? { connected: true, account: v.account } : { connected: false });
}

export async function DELETE() {
  return handle(async () => {
  const principal = await require_('manage_connections');
  removeGrant('mastodon');
  await reconcileDisconnect(principal.organizationId, 'mastodon');
  return NextResponse.json({ disconnected: true });
  });
}
