import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { suppress } from '@/lib/suppression';

export const dynamic = 'force-dynamic';

/**
 * Unsubscribe, in one click, without signing in.
 *
 * Every message this product sends carries a link here — in the visible
 * footer and in the `List-Unsubscribe` header. Generating those links without
 * building the endpoint would have been worse than omitting them: a
 * `List-Unsubscribe` header pointing at a 404 tells Gmail the sender is
 * careless, and a footer link that goes nowhere converts someone who wanted to
 * leave into someone who presses "report spam" instead. A complaint costs far
 * more than the unsubscribe would have.
 *
 * The delivery id is the credential. That is a deliberate trade: it is a cuid
 * in a URL that has already been mailed to exactly the person it concerns, and
 * requiring a login to stop receiving mail is the pattern that makes people
 * give up and complain. The blast radius of a guessed id is one address
 * unsubscribing itself, which is a thing that address is entitled to do.
 *
 * **GET** renders a confirmation page (a human clicked). **POST** unsubscribes
 * immediately, because RFC 8058 one-click means the mail client posts here
 * without a person ever seeing a page.
 */

async function unsubscribe(id: string): Promise<{ ok: boolean; name?: string; already?: boolean; reason?: string }> {
  if (!(await dbAvailable())) return { ok: false, reason: 'no-database' };

  const delivery = await db.emailDelivery.findUnique({
    where: { id },
    include: { contact: true },
  });
  if (!delivery?.contact.email) return { ok: false, reason: 'not-found' };

  const outcome = await suppress({
    organizationId: delivery.contact.organizationId,
    channel: 'email',
    address: delivery.contact.email,
    reason: 'unsubscribe',
    detail: 'Unsubscribed from an email',
  });

  // Both the consent flag and the suppression list. The flag is what the
  // audience builder reads and what the owner sees on the contact; the
  // suppression entry is what survives a re-import of the same address from a
  // CSV, which is how an unsubscribed person usually comes back.
  await db.contact.update({
    where: { id: delivery.contactId },
    data: { emailConsent: 'UNSUBSCRIBED' },
  });

  await db.auditEvent.create({
    data: {
      organizationId: delivery.contact.organizationId,
      actorUserId: null,
      action: 'email.unsubscribed',
      target: delivery.contactId,
      detail: `via delivery ${id}`,
    },
  });

  return { ok: true, name: delivery.contact.name, already: outcome === 'already-suppressed' };
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await unsubscribe(id);
  // A mail client posting here wants a 2xx and nothing else.
  return NextResponse.json({ ok: result.ok }, { status: result.ok ? 200 : 404 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await unsubscribe(id);

  const body = result.ok
    ? `<h1>You're unsubscribed</h1>
       <p>We won't email you again${result.name ? `, ${escapeHtml(result.name.split(' ')[0])}` : ''}. Nothing else is needed.</p>
       <p class="muted">If this was a mistake, reply to any earlier message and ask to be added back.</p>`
    : `<h1>That link has expired</h1>
       <p>We couldn't match it to a message. If you're still receiving email you don't want, reply to it and ask to be removed — a person will see it.</p>`;

  return new NextResponse(page(body), {
    status: result.ok ? 200 : 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Self-contained, with no script and no shared stylesheet.
 *
 * This page is opened from a mail client by someone who is, at this exact
 * moment, mildly annoyed. It should render instantly, work with images and
 * JavaScript blocked, and not ask them for anything.
 */
function page(inner: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Unsubscribed</title>
    <style>
      body { margin:0; padding:48px 24px; background:#f6f6f4; color:#1a1a1a;
             font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
      main { max-width:460px; margin:0 auto; background:#fff; border-radius:12px; padding:32px; }
      h1 { font-size:20px; margin:0 0 12px; letter-spacing:-0.02em; }
      p { margin:0 0 12px; line-height:1.55; font-size:14.5px; }
      .muted { color:#767672; font-size:12.5px; }
    </style>
  </head>
  <body><main>${inner}</main></body>
</html>`;
}
