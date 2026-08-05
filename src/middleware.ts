import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request CSP nonce.
 *
 * The first version of this policy was a static `script-src 'self'` in
 * `next.config.mjs`, and it **broke the entire application** — Next emits
 * inline bootstrap scripts to hydrate the page, the browser refused every one
 * of them, and the app rendered a blank body. The tests caught it; a deploy
 * would have caught it in front of customers.
 *
 * The tempting fix is `'unsafe-inline'`, which restores the app and removes
 * the only thing the policy was protecting against — an injected `<script>`
 * is inline too. The real fix is a nonce: a fresh random value per response,
 * named in the header, which Next stamps onto its own scripts. Anything
 * injected later does not have it.
 *
 * This has to live in middleware rather than config because the value changes
 * every request. A nonce reused across responses is not a nonce.
 */
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isProd = process.env.NODE_ENV === 'production';

  const csp = [
    "default-src 'self'",
    // `'self'` for the chunk files Next emits as <script src>, and the nonce
    // for its inline bootstrap. Deliberately *not* `strict-dynamic`: that
    // keyword makes browsers ignore `'self'` entirely, so every chunk request
    // was refused and the page loaded without ever hydrating. It is the
    // stricter policy on paper and the broken one in practice unless every
    // script tag carries the nonce.
    isProd
      ? `script-src 'self' 'nonce-${nonce}'`
      : `script-src 'self' 'unsafe-eval' 'unsafe-inline'`,
    // Styles stay 'unsafe-inline': React writes style attributes, and there is
    // no nonce mechanism for those. Worth being explicit that this is a real
    // gap rather than an oversight — CSS injection is a much narrower problem
    // than script injection, but it is not nothing.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  // Next reads the nonce back off the *request* header it forwards, which is
  // how it knows what to stamp onto its script tags.
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set('content-security-policy', csp);
  return res;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the tracking snippet.
     *
     * `/p.js` is excluded deliberately: it is served to other people's
     * websites, and a CSP naming our origin means nothing there. Media files
     * are excluded because they get their own, stricter sandbox policy in
     * next.config.mjs.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|p\\.js|api/media/file).*)',
  ],
};
