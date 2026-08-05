import { NextResponse } from 'next/server';
import { hasEncryptionKey } from '@/lib/oauth/crypto';
import { getAccessToken, removeGrant, saveGrant } from '@/lib/oauth/store';
import { reconcileAccount, reconcileDisconnect } from '@/lib/oauth/reconcile';

/**
 * Bluesky — a connection that genuinely works today, with no app registration,
 * no developer console, and no platform review.
 *
 * AT Protocol authenticates with a handle and an **app password** (created at
 * Settings → App Passwords, revocable independently of the account password).
 * `createSession` returns real JWTs; `createRecord` publishes a real post.
 *
 * This is here to prove the whole pipeline end to end. Every other connector
 * is blocked on paperwork we can't do for you; this one is blocked on nothing.
 */

const PDS = process.env.BLUESKY_PDS_URL || 'https://bsky.social';

interface SessionResponse {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

/** POST { handle, appPassword } → real session, stored encrypted. */
export async function POST(request: Request) {
  let handle: string;
  let appPassword: string;
  try {
    const body = (await request.json()) as { handle?: string; appPassword?: string };
    handle = (body.handle ?? '').trim().replace(/^@/, '');
    appPassword = (body.appPassword ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (!handle || !appPassword) {
    return NextResponse.json(
      { error: 'Both a handle and an app password are required.' },
      { status: 400 }
    );
  }

  // A main account password would work here, which is exactly why we check:
  // app passwords are revocable on their own and are the only safe choice.
  if (!/^([a-z0-9]{4}-){3}[a-z0-9]{4}$/i.test(appPassword)) {
    return NextResponse.json(
      {
        error: 'That does not look like an app password.',
        fix: 'Create one at Bluesky → Settings → App Passwords. It looks like xxxx-xxxx-xxxx-xxxx. Never use your main password.',
      },
      { status: 400 }
    );
  }

  // Config check comes after input validation: a malformed password is
  // malformed whatever the server config, and it's the problem the person at
  // this screen can actually fix. The missing key is the operator's, and the
  // setup panel already shouts about it.
  if (!hasEncryptionKey()) {
    return NextResponse.json(
      {
        error: 'TOKEN_ENCRYPTION_KEY is not set, so the session could not be stored safely.',
        fix: 'Run `openssl rand -base64 32` and set TOKEN_ENCRYPTION_KEY in .env.local.',
      },
      { status: 428 }
    );
  }

  let session: SessionResponse;
  try {
    const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string };
        message = parsed.message ?? parsed.error ?? message;
      } catch {
        /* keep the raw text */
      }
      return NextResponse.json({ error: `Bluesky rejected the login: ${message}` }, { status: 401 });
    }
    session = JSON.parse(text) as SessionResponse;
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach ${PDS}: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  saveGrant({
    channel: 'bluesky',
    accessToken: session.accessJwt,
    refreshToken: session.refreshJwt,
    // AT Proto access JWTs are short-lived; the refresh JWT is the durable one.
    expiresInSec: 60 * 60 * 2,
    scopes: ['app-password session'],
    accountLabel: `@${session.handle}`,
    externalAccountId: session.did,
  });
  await reconcileAccount({
    channel: 'bluesky',
    accountLabel: `@${session.handle}`,
    externalAccountId: session.did,
    scopes: ['app-password session'],
    expiresAt: Date.now() + 60 * 60 * 2 * 1000,
  });

  return NextResponse.json({
    connected: true,
    handle: session.handle,
    did: session.did,
    // Deliberately no tokens in this response.
    destination: { name: `@${session.handle}`, kind: 'Handle', externalId: session.did },
  });
}

/** DELETE → forget the stored session. */
export async function DELETE() {
  removeGrant('bluesky');
  await reconcileDisconnect('bluesky');
  return NextResponse.json({ disconnected: true });
}

/** GET → is there a live session, and whose? */
export async function GET() {
  try {
    const token = getAccessToken('bluesky');
    if (!token) return NextResponse.json({ connected: false });
    const res = await fetch(`${PDS}/xrpc/com.atproto.server.getSession`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return NextResponse.json({ connected: false, stale: true });
    const me = (await res.json()) as { handle: string; did: string };
    return NextResponse.json({ connected: true, handle: me.handle, did: me.did });
  } catch (e) {
    return NextResponse.json({ connected: false, error: (e as Error).message });
  }
}
