/**
 * Security headers.
 *
 * Every one of these is a browser default that is wrong for historical
 * reasons, and each closes a specific hole:
 *
 * - **CSP** is the big one. Without it, a single reflected string that reaches
 *   the DOM becomes script execution. Next needs `'unsafe-inline'` for styles
 *   and, in development, `'unsafe-eval'` for fast refresh — so the production
 *   policy is deliberately tighter rather than settling for whichever is
 *   easier to write once.
 * - **frame-ancestors 'none'** stops clickjacking: the app loaded in an
 *   invisible iframe over someone else's page, so a click lands on "Publish".
 * - **nosniff** stops a browser deciding an uploaded file is HTML because its
 *   bytes look like it — which matters here, because customers upload media.
 * - **Referrer-Policy** keeps tracked-link paths out of the Referer header
 *   sent to third parties.
 * - **HSTS** in production only, where it means anything.
 *
 * `/api/media/file/*` gets its own, stricter policy: those are
 * customer-supplied bytes served from our own origin, so they must never be
 * able to run anything.
 */
const isProd = process.env.NODE_ENV === 'production';

// The Content-Security-Policy itself lives in src/middleware.ts, because it
// carries a per-request nonce and a value baked into a static header cannot be
// one. Everything below is static, so it belongs here.
const baseHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Framework fingerprinting, for free, to anyone scanning.
  poweredByHeader: false,

  async headers() {
    return [
      { source: '/:path*', headers: baseHeaders },
      {
        // Customer-uploaded bytes served from our origin. `sandbox` with no
        // allow-list means even an HTML file uploaded as a "photo" executes
        // nothing and can reach nothing of ours.
        source: '/api/media/file/:path*',
        headers: [
          ...baseHeaders,
          { key: 'Content-Security-Policy', value: "default-src 'none'; sandbox" },
        ],
      },
      {
        // The tracking snippet is meant to be loaded by customer sites, so it
        // is the one thing that must stay cross-origin readable.
        source: '/p.js',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ];
  },
};

export default nextConfig;
