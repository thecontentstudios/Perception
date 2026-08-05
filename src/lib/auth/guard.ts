import { NextResponse } from 'next/server';
import { currentPrincipal, type Principal } from './session';
import type { Role } from '../types';

/**
 * The gate every route goes through.
 *
 * Two things it exists to make impossible:
 *
 * **Forgetting.** A route that forgets to check auth is open, and nothing in
 * the type system notices. So the contract here is a value, not a check: a
 * route cannot obtain an `organizationId` without having been authorized,
 * because the only place that id comes from is a resolved session. Reaching
 * for `ORG.id` — the demo constant every route used to use — now stands out
 * as obviously wrong.
 *
 * **Confusing 401 with 403.** "You are not signed in" and "you are signed in
 * but may not do this" need different responses, because the first should send
 * someone to a login screen and the second must not.
 */

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Least to most privileged. A role implies every capability below it. */
const RANK: Record<Role, number> = {
  guest: 0, analyst: 1, creator: 2, approver: 3, manager: 4, admin: 5, owner: 6,
};

export type Capability =
  | 'read'
  | 'create_content'
  | 'approve'
  | 'publish'
  | 'manage_connections'
  | 'manage_org';

/**
 * What each capability requires.
 *
 * Approving is separated from creating deliberately: the whole point of an
 * approval step is that the person who wrote it is not always the person who
 * signs it off, and collapsing them into one role quietly removes the control
 * the customer thought they had.
 */
const REQUIRES: Record<Capability, Role> = {
  read: 'guest',
  create_content: 'creator',
  approve: 'approver',
  publish: 'approver',
  manage_connections: 'admin',
  manage_org: 'owner',
};

export function can(role: Role, capability: Capability): boolean {
  return RANK[role] >= RANK[REQUIRES[capability]];
}

/**
 * Require a signed-in caller with a capability. Throws `HttpError`, which
 * `handle()` turns into a response — so a route body reads as the happy path.
 */
export async function require_(capability: Capability = 'read'): Promise<Principal> {
  const principal = await currentPrincipal();
  if (!principal) throw new HttpError(401, 'Sign in to continue.');
  if (!can(principal.role, capability)) {
    throw new HttpError(
      403,
      `Your role (${principal.role}) can't do that. An ${REQUIRES[capability]} or above can.`
    );
  }
  return principal;
}

/**
 * Wrap a route body so thrown errors become correct responses.
 *
 * The catch-all deliberately does *not* return the message: an unexpected
 * throw from deep in a query can contain a connection string or a row's
 * contents, and a 500 that leaks internals is how a small bug becomes a
 * disclosure. Expected failures raise `HttpError`, whose message is written to
 * be read by a user.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ ok: false, reason: e.message }, { status: e.status });
    }
    console.error('[route] unhandled', e);
    return NextResponse.json(
      { ok: false, reason: 'Something went wrong on our end.' },
      { status: 500 }
    );
  }
}

/**
 * Confirm a record belongs to the caller's organization before touching it.
 *
 * Authentication answers "who are you"; this answers "is that yours". Missing
 * the second is the classic multi-tenant bug: a valid session plus somebody
 * else's id, and the query happily obliges. Note it returns 404 rather than
 * 403 — telling an attacker that an id exists but belongs to someone else is
 * itself a disclosure.
 */
export function assertOwned<T extends { organizationId: string } | null>(
  row: T,
  principal: Principal,
  what = 'That'
): NonNullable<T> {
  if (!row || row.organizationId !== principal.organizationId) {
    throw new HttpError(404, `${what} could not be found.`);
  }
  return row as NonNullable<T>;
}
