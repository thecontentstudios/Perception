import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { hashPassword, needsRehash, verifyPassword } from '@/lib/auth/password';
import { createSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { rateLimit } from '@/lib/rate-limit';
import { clientIp } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * Sign in.
 *
 * **Every failure returns the same message and the same status.** "No account
 * with that email" is a free account-existence oracle — point it at a customer
 * list and it tells you who uses the product. Wrong password, unknown email,
 * and no password set are indistinguishable from outside.
 *
 * They are also indistinguishable in *time*: the unknown-email path still runs
 * a full hash, because a login that fails in 2ms when the email is unknown and
 * 100ms when it exists says exactly as much as the message would have.
 */
export async function POST(req: Request) {
  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }

  const ip = clientIp(req);
  // A **generous** per-IP ceiling, and this number matters more than it looks.
  //
  // The first version allowed ten attempts per five minutes per address, which
  // is fine for one person at home and wrong for everyone else: an office
  // shares one public IP, so twenty colleagues share one budget and ten fumbled
  // passwords locks out the building. It also locked out this project's own
  // test suite, which is how it was found.
  //
  // So the IP limit is set to catch a script, not a bad morning, and the
  // targeted protection lives on the account instead (below).
  // 600 per five minutes. Sized against the traffic it must never block: an
  // office of fifty at Monday-morning peak, each signing in a few times with
  // the odd fumble, is a couple of hundred. A credential-stuffing script is
  // thousands. The gap between those is where this number belongs.
  const ipLimit = await rateLimit(`login:ip:${ip}`, { max: 600, windowSec: 300 });
  if (!ipLimit.ok) {
    return NextResponse.json(
      { ok: false, reason: `Too many attempts. Try again in ${ipLimit.retryAfterSec} seconds.` },
      { status: 429, headers: { 'retry-after': String(ipLimit.retryAfterSec) } }
    );
  }

  let body: { email?: string; password?: string; organizationId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'malformed request' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const DENIED = { ok: false, reason: 'That email and password do not match.' };

  if (!email || !password) return NextResponse.json(DENIED, { status: 401 });

  // Per-account, counting **failures only**. This is the limit that actually
  // stops someone grinding one person's password, and counting only failures
  // is what stops it becoming a way to lock a colleague out: their own
  // successful sign-ins never consume the budget.
  const attemptKey = `login:acct:${email}`;
  const acctLimit = await rateLimit(attemptKey, { max: 12, windowSec: 900, peek: true });
  if (!acctLimit.ok) {
    return NextResponse.json(
      { ok: false, reason: `Too many failed attempts for that account. Try again in ${acctLimit.retryAfterSec} seconds.` },
      { status: 429, headers: { 'retry-after': String(acctLimit.retryAfterSec) } }
    );
  }

  const user = await db.user.findUnique({
    where: { email },
    include: { memberships: { select: { organizationId: true, role: true } } },
  });

  const valid = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !valid) {
    await rateLimit(attemptKey, { max: 12, windowSec: 900 });
    return NextResponse.json(DENIED, { status: 401 });
  }

  if (user.memberships.length === 0) {
    return NextResponse.json(
      { ok: false, reason: 'Your account is not part of a workspace yet. Ask an owner to invite you.' },
      { status: 403 }
    );
  }

  // A session belongs to one organization. When someone is in several, they
  // pick — an ambient "current org" is how a request ends up writing to the
  // wrong customer's workspace.
  const chosen = body.organizationId
    ? user.memberships.find((m) => m.organizationId === body.organizationId)
    : user.memberships[0];
  if (!chosen) return NextResponse.json({ ok: false, reason: 'You are not a member of that workspace.' }, { status: 403 });

  // Raising the cost factor shouldn't force a reset; upgrade on the way past.
  if (needsRehash(user.passwordHash)) {
    await db.user
      .update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
      .catch(() => {});
  }

  const { token, expiresAt } = await createSession({
    userId: user.id,
    organizationId: chosen.organizationId,
    userAgent: req.headers.get('user-agent'),
    ip,
  });

  await db.auditEvent.create({
    data: {
      organizationId: chosen.organizationId, actorUserId: user.id,
      action: 'auth.signed_in', target: user.id, detail: `from ${ip}`,
    },
  });

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role: chosen.role.toLowerCase() },
    organizations: user.memberships.map((m) => m.organizationId),
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return res;
}
