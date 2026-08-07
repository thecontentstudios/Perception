import { NextResponse } from 'next/server';
import { currentPrincipal, destroyAllSessions, destroySession, SESSION_COOKIE } from '@/lib/auth/session';
import { db, dbAvailable } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Sign out.
 *
 * `?everywhere=1` ends every session for the user, which is the reason
 * sessions are rows: it is one `DELETE`, and it takes effect on the next
 * request rather than whenever a token happens to expire.
 *
 * The cookie is cleared even when there was no session to delete. Someone
 * clicking "sign out" wants the cookie gone, and returning "you weren't signed
 * in" while leaving a stale cookie in place is the worst of both.
 */
export async function POST(req: Request) {
  const clear = (body: Record<string, unknown>, status = 200) => {
    const res = NextResponse.json(body, { status });
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return res;
  };

  if (!(await dbAvailable())) return clear({ ok: true });

  const principal = await currentPrincipal();
  if (!principal) return clear({ ok: true });

  const everywhere = new URL(req.url).searchParams.get('everywhere') === '1';
  const ended = everywhere ? await destroyAllSessions(principal.userId) : (await destroySession(principal.sessionId), 1);

  await db.auditEvent
    .create({
      data: {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: everywhere ? 'auth.signed_out_everywhere' : 'auth.signed_out',
        target: principal.userId,
        detail: everywhere ? `${ended} sessions ended` : '',
      },
    })
    .catch(() => {});

  return clear({ ok: true, ended });
}
