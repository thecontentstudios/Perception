import { NextResponse } from 'next/server';
import { dbAvailable } from '@/lib/db';
import { confirm } from '@/lib/confirm';

export const dynamic = 'force-dynamic';

/**
 * The click that turns pending into subscribed.
 *
 * Deliberately a GET with no confirmation step. The usual objection is that
 * GETs should not have side effects, and the usual mitigation is an
 * intermediate "click here to really confirm" page — which is exactly the
 * extra step that loses people who were already doing what we asked. The side
 * effect here is one somebody explicitly requested by opening a link sent to
 * their own inbox, and the worst case of a pre-fetching mail client following
 * it is that a person who asked for email gets email.
 *
 * The reverse operation, `/u/<id>`, is the one that has to be forgiving, and
 * it is: unsubscribing is always one click and never asks a question.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!(await dbAvailable())) {
    return html(
      503,
      `<h1>Try again in a moment</h1><p>We couldn't reach our records just now. Your link is still good — open it again shortly.</p>`
    );
  }

  const result = await confirm(token);

  if (!result.ok) {
    return html(
      404,
      result.reason === 'expired'
        ? `<h1>That link has expired</h1><p>Confirmation links last three days. Sign up again and we'll send a fresh one.</p>`
        : `<h1>We couldn't find that link</h1><p>It may have already been used, or been copied incompletely. If you meant to subscribe, sign up again.</p>`
    );
  }

  const first = escapeHtml(result.name.trim().split(/\s+/)[0] || '');
  return html(
    200,
    result.alreadyDone
      ? `<h1>Already confirmed</h1><p>You're on the list${first ? `, ${first}` : ''}. Nothing else to do.</p>`
      : `<h1>You're on the list</h1>
         <p>Thanks${first ? `, ${first}` : ''} — that's confirmed. You can unsubscribe from any message we send.</p>`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function html(status: number, inner: string): NextResponse {
  return new NextResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Confirm your subscription</title>
    <style>
      body { margin:0; padding:48px 24px; background:#f6f6f4; color:#1a1a1a;
             font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
      main { max-width:460px; margin:0 auto; background:#fff; border-radius:12px; padding:32px; }
      h1 { font-size:20px; margin:0 0 12px; letter-spacing:-0.02em; }
      p { margin:0 0 12px; line-height:1.55; font-size:14.5px; }
    </style>
  </head>
  <body><main>${inner}</main></body>
</html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
  );
}
