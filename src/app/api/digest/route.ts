import { NextResponse } from 'next/server';
import { dbAvailable } from '@/lib/db';
import { composeDigest, emailDigest } from '@/lib/digest';
import { handle, require_, HttpError } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/** The week on one page — read it, or have it emailed through your own sender. */
export async function GET() {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('read');
    return NextResponse.json({ ok: true, digest: await composeDigest(principal.organizationId) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    // Emailing goes out under the business's name through its provider —
    // publish trust, same as every other outbound word.
    const principal = await require_('publish');
    let body: { to?: string };
    try {
      body = (await req.json()) as { to?: string };
    } catch {
      throw new HttpError(400, 'Malformed request.');
    }
    const to = (body.to ?? principal.email).trim();
    const sent = await emailDigest(principal.organizationId, to);
    if (!sent.ok) return NextResponse.json({ ok: false, reason: sent.error }, { status: 422 });
    return NextResponse.json({ ok: true, to });
  });
}
