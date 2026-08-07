/**
 * Runs once when the server process starts.
 *
 * Next calls this before serving anything, which makes it the right place for
 * the configuration check: a misconfigured deployment should say so at boot,
 * in the logs someone is already watching, rather than at the moment a
 * customer tries to connect an account.
 */
export async function register() {
  // Only in the Node runtime — the edge runtime has no process.exit and
  // shouldn't be duplicating this anyway.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportConfig } = await import('./lib/config');
  reportConfig();
}
