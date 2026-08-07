/**
 * Configuration, checked once and loudly.
 *
 * The failure this prevents is the quiet one: a deployment that starts
 * cleanly, serves pages, and only reveals a missing `TOKEN_ENCRYPTION_KEY`
 * when someone tries to connect an account three days later — or worse, one
 * that runs in production with a session cookie sent over plain HTTP because
 * `APP_URL` was left at localhost.
 *
 * Two severities, and the difference matters. A **problem** means the process
 * should not serve traffic. A **warning** means it will work but something is
 * weaker than it looks, and an operator deserves to know which.
 */

export interface ConfigIssue {
  key: string;
  severity: 'problem' | 'warning';
  message: string;
}

const isProd = () => process.env.NODE_ENV === 'production';

function isLoopback(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
  } catch {
    return false;
  }
}

export function checkConfig(): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const add = (key: string, severity: ConfigIssue['severity'], message: string) =>
    issues.push({ key, severity, message });

  if (!process.env.DATABASE_URL) {
    // A warning even in production. The app is built to run on fixtures, and
    // an operator who deliberately deploys the demo should not be blocked —
    // but they should see this every time the process starts.
    add('DATABASE_URL', 'warning',
      'No database configured — the app will serve the sample workspace and store nothing.');
  }

  const tokenKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!tokenKey) {
    // Not fatal outside production: you can browse the whole product without
    // connecting an account, and demanding a key to run `npm run dev` is the
    // kind of friction that gets worked around with a committed default.
    add('TOKEN_ENCRYPTION_KEY', isProd() ? 'problem' : 'warning',
      'Not set — connecting any social account will fail. Generate one with `openssl rand -base64 32`.');
  } else if (Buffer.from(tokenKey, 'base64').length !== 32) {
    add('TOKEN_ENCRYPTION_KEY', 'problem', 'Must be exactly 32 bytes, base64 encoded.');
  } else if (/^(AAAA|BBBB|0000)/.test(tokenKey)) {
    // A key of repeated bytes is what you get from a copy-paste example.
    add('TOKEN_ENCRYPTION_KEY', 'problem', 'That looks like an example key, not a generated one.');
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    add('APP_URL', isProd() ? 'problem' : 'warning',
      'Not set — OAuth redirects and tracked links will point at localhost.');
  } else if (isProd() && !appUrl.startsWith('https://') && !isLoopback(appUrl)) {
    // The session cookie's `secure` flag follows APP_URL, so this is not
    // cosmetic: it decides whether sessions travel in the clear.
    //
    // Loopback is exempt, and deliberately so: `npm start` sets NODE_ENV to
    // production, and refusing to run a production build against localhost
    // would make the thing you actually want to test before deploying
    // impossible to run. A loopback address is not exposed to anyone.
    add('APP_URL', 'problem',
      'Must be https:// when it is reachable from outside — the session cookie is only marked Secure when it is.');
  }

  if (!process.env.REDIS_URL) {
    add('REDIS_URL', 'warning',
      'Not set — scheduled posts will not publish, and rate limits are per-instance rather than shared.');
  }

  const proxies = process.env.TRUSTED_PROXY_COUNT;
  if (isProd() && proxies === undefined) {
    add('TRUSTED_PROXY_COUNT', 'warning',
      'Not set — defaulting to 1 proxy. Set it to match your deployment, or IP rate limits can be bypassed with a forged header.');
  }

  if (isProd() && process.env.SEED_PASSWORD === undefined && process.env.ALLOW_SEED === '1') {
    add('SEED_PASSWORD', 'problem', 'Seeding is enabled in production with the default demo password.');
  }

  return issues;
}

export function configSummary(): { ok: boolean; issues: ConfigIssue[] } {
  const issues = checkConfig();
  return { ok: !issues.some((i) => i.severity === 'problem'), issues };
}

/**
 * Print the report at boot. Called from instrumentation, so it runs once per
 * process rather than per request.
 */
export function reportConfig(): void {
  const { ok, issues } = configSummary();
  if (issues.length === 0) {
    console.log('[config] all good');
    return;
  }
  for (const i of issues) {
    const tag = i.severity === 'problem' ? 'PROBLEM' : 'warning';
    console[i.severity === 'problem' ? 'error' : 'warn'](`[config] ${tag} ${i.key}: ${i.message}`);
  }
  if (!ok && process.env.NODE_ENV === 'production') {
    console.error(
      '[config] Refusing to start with the problems above. Fix them, or set ' +
      'ALLOW_INSECURE_START=1 if you genuinely mean to run this way.'
    );
    if (process.env.ALLOW_INSECURE_START !== '1') process.exit(1);
  }
}
