/**
 * Reading the client's address, carefully.
 *
 * `x-forwarded-for` is set by whatever proxy sits in front, and it is
 * *appendable by the client* — a request can arrive with a forged header and
 * the real proxy simply adds to it. So the trustworthy value is the **last**
 * entry, added by the hop we control, not the first.
 *
 * Because that depends on the deployment, `TRUSTED_PROXY_COUNT` says how many
 * hops to skip from the right. Default 1 (one proxy: Vercel, a load balancer,
 * nginx). Set 0 when the app is exposed directly, in which case the header is
 * ignored entirely.
 *
 * Getting this wrong is not academic: an IP-keyed rate limit that reads a
 * spoofable header is a rate limit an attacker opts out of by sending a
 * different value each request.
 */
export function clientIp(req: Request): string {
  const hops = Number(process.env.TRUSTED_PROXY_COUNT ?? '1');

  if (hops > 0) {
    const xff = req.headers.get('x-forwarded-for');
    if (xff) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      // Count from the right: the rightmost entries were added by our own
      // infrastructure and cannot be forged by the caller.
      const idx = parts.length - hops;
      if (idx >= 0 && parts[idx]) return normalize(parts[idx]);
      // Fewer hops than configured means the request did not come through the
      // expected chain. Trust nothing from it.
      return 'unknown';
    }
    const real = req.headers.get('x-real-ip');
    if (real) return normalize(real);
  }

  return 'unknown';
}

/** Strip an IPv6 v4-mapped prefix and any port, so keys are stable. */
function normalize(ip: string): string {
  let out = ip.replace(/^::ffff:/, '');
  // "1.2.3.4:5678" — a port makes every request a distinct rate-limit key.
  const m = out.match(/^(\d+\.\d+\.\d+\.\d+):\d+$/);
  if (m) out = m[1];
  return out.slice(0, 45);
}

/** Origin check for state-changing requests. */
export function sameOrigin(req: Request): boolean {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const origin = req.headers.get('origin');
  // No Origin header at all is a non-browser client (curl, a server-to-server
  // call). Those cannot be victims of CSRF — the attack needs a browser that
  // attaches cookies automatically — so absence is allowed and presence is
  // checked.
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
