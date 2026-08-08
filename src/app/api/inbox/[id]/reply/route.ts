import { NextResponse } from 'next/server';
import { dbAvailable } from '@/lib/db';
import { sendReply } from '@/lib/reply';
import { handle, require_, HttpError } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Answer a conversation from the inbox.
 *
 * `publish` permission: a reply goes out under the business's own name on a
 * platform or a phone bill, which is exactly what publishing is. An analyst
 * can read the question; answering it is a different trust.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('publish');
    const { id } = await params;

    let body: { text?: string };
    try {
      body = (await req.json()) as { text?: string };
    } catch {
      throw new HttpError(400, 'Malformed request.');
    }

    const result = await sendReply(principal.organizationId, id, body.text ?? '');
    if (!result.ok) {
      return NextResponse.json({ ok: false, reason: result.error }, { status: 422 });
    }
    return NextResponse.json({ ok: true, providerRef: result.providerRef });
  });
}
