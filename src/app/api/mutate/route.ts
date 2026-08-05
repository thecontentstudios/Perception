import { NextResponse } from 'next/server';
import { applyMutation, DURABLE, type Mutation } from '@/lib/mutations';
import { dbAvailable } from '@/lib/db';
import { ORG } from '@/lib/demo-data';

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
  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }

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

  try {
    await applyMutation(ORG.id, m);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: (e as Error).message }, { status: 500 });
  }
}
