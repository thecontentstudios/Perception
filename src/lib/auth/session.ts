import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from '../db';
import type { Role } from '../types';

/**
 * Sessions.
 *
 * The token in the cookie is 32 random bytes. What's stored is its SHA-256, so
 * a database dump — the most likely way this leaks — does not hand anyone a
 * working session. No salt and no slow hash here on purpose: the token already
 * has 256 bits of entropy, so there is nothing to brute-force and nothing a
 * dictionary can help with. That reasoning does *not* transfer to passwords,
 * which is why those use scrypt.
 */

export const SESSION_COOKIE = 'pcp_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Refresh the row at most this often, so reading doesn't write on every hit. */
const TOUCH_AFTER_MS = 60 * 60 * 1000;

export interface Principal {
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
  name: string;
  sessionId: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(input: {
  userId: string;
  organizationId: string;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId: input.userId,
      organizationId: input.organizationId,
      expiresAt,
      userAgent: input.userAgent?.slice(0, 255) ?? null,
      ip: input.ip ?? null,
    },
  });
  return { token, expiresAt };
}

/**
 * Resolve the caller, or null.
 *
 * Membership is re-read on every request rather than trusted from the session
 * row. Roles change, and people get removed from organizations — a session
 * that keeps its old role until it expires is how a former employee still has
 * access on their way out.
 */
export async function currentPrincipal(): Promise<Principal | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    // Clean up on the way past rather than waiting for a sweep.
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const membership = await db.membership.findUnique({
    where: { organizationId_userId: { organizationId: session.organizationId, userId: session.userId } },
    select: { role: true },
  });
  if (!membership) {
    // Removed from the organization: the session is void immediately, not at
    // expiry.
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }

  return {
    userId: session.userId,
    organizationId: session.organizationId,
    role: membership.role.toLowerCase() as Role,
    email: session.user.email,
    name: session.user.name,
    sessionId: session.id,
  };
}

export async function destroySession(sessionId: string): Promise<void> {
  await db.session.delete({ where: { id: sessionId } }).catch(() => {});
}

/** Sign out everywhere — the reason sessions are rows and not JWTs. */
export async function destroyAllSessions(userId: string): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { userId } });
  return count;
}

/** Expired rows accumulate; the worker sweeps them. */
export async function sweepExpiredSessions(): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}

/**
 * Cookie attributes.
 *
 * `secure` follows APP_URL rather than NODE_ENV: a staging deployment served
 * over https with NODE_ENV unset would otherwise send the session cookie in
 * the clear, which is exactly the environment where nobody is watching.
 */
export function sessionCookieOptions(expiresAt: Date) {
  const https = (process.env.APP_URL ?? '').startsWith('https://');
  return {
    httpOnly: true,
    secure: https,
    // 'lax' still sends the cookie on top-level navigation, which OAuth
    // callbacks need; 'strict' would log the user out mid-connect.
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

/** Constant-time compare for CSRF tokens and the like. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
