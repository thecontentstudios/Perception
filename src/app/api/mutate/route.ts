import { NextResponse } from 'next/server';
import { applyMutation, DURABLE, NotFound, type Mutation } from '@/lib/mutations';
import { dbAvailable } from '@/lib/db';
import { handle, require_ } from '@/lib/auth/guard';
import { sameOrigin } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * One endpoint for every durable change.
 *
 * A route per action would be thirteen files that all do the same three
 * things. The interesting logic — mirroring the reducer's derivations exactly —
 * lives in `applyMutation`; this is the envelope around it: check the database
 * is there, check the action is one we actually persist, run it, and say
 * plainly what happened.
 *
 * Failures return the message rather than swallowing it, because the client
 * shows it. A write that silently didn't happen is the worst outcome here:
 * the screen looks right and the work is gone on reload.
 */
export async function POST(req: Request) {
  return handle(async () => {
  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }

  // Cookie-authenticated and state-changing, so it needs an origin check: a
  // page on another site can make the browser send this request with the
  // session cookie attached.
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, reason: 'cross-origin request refused' }, { status: 403 });
  }

  const principal = await require_('create_content');

  let body: { mutation?: Mutation };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'malformed JSON' }, { status: 400 });
  }

  const m = body.mutation;
  if (!m || typeof m.type !== 'string' || !DURABLE.has(m.type)) {
    return NextResponse.json(
      { ok: false, reason: `not a durable action: ${m?.type ?? 'none'}` },
      { status: 400 }
    );
  }

  // Approving is a separate permission from writing. A creator drafting a
  // post must not be able to approve their own work by calling the API
  // directly — that is the whole point of the approval step.
  if ((m.type === 'setStatus' && m.status === 'approved') ||
      (m.type === 'bulkSetStatus' && m.status === 'approved')) {
    await require_('approve');
  }
  if (m.type === 'connectAccount' || m.type === 'reconnect' ||
      m.type === 'discoverDestinations' || m.type === 'mapDestination' ||
      m.type === 'toggleDestination') {
    await require_('manage_connections');
  }

  try {
    await applyMutation(principal, m);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // "Not yours" and "broke" are different answers. A 500 for an id belonging
    // to another tenant is both worse to read and slightly leaky — it says the
    // request got further than a clean refusal would have.
    if (e instanceof NotFound) {
      return NextResponse.json({ ok: false, reason: e.message }, { status: 404 });
    }
    console.error('[mutate] failed', e);
    return NextResponse.json({ ok: false, reason: 'That change could not be saved.' }, { status: 500 });
  }
  });
}
