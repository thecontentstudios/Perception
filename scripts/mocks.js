/**
 * Start every local stand-in server at once.
 *
 *     npm run mocks
 *
 * Nine processes on nine ports is nine terminal tabs, and the number only goes
 * up as channels land. This is the difference between "run the app locally"
 * being a paragraph of instructions and being one command — which matters more
 * than it sounds, because a setup step that takes nine tabs is a setup step
 * people skip, and then they file bugs against a half-running system.
 *
 * These are not fakes in the usual sense. Each one speaks the real wire
 * protocol of the service it stands in for — Twilio's form-encoded POST and
 * signed status callbacks, Mastodon's two-step media upload, Bluesky's blob
 * refs, Reddit's habit of returning errors inside a 200. The adapter code
 * under `src/lib/` is the same code that talks to production; only the
 * hostname changes. That is what makes them worth running rather than
 * stubbing at the function boundary.
 *
 * Ports are fixed and match the `*_BASE_URL` values in `.env.example`. Pass
 * `--only mastodon,twilio` to start a subset.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const MOCKS = [
  ['mastodon', 4321],
  ['site', 4322],
  ['resend', 4323],
  ['twilio', 4324],
  ['meta', 4325],
  ['bluesky', 4326],
  ['reddit', 4327],
  ['pinterest', 4328],
  ['gbp', 4329],
];

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > -1 && process.argv[onlyArg + 1]
  ? new Set(process.argv[onlyArg + 1].split(',').map((s) => s.trim()))
  : null;

const wanted = MOCKS.filter(([name]) => !only || only.has(name));
if (only) {
  const unknown = [...only].filter((n) => !MOCKS.some(([m]) => m === n));
  if (unknown.length) {
    console.error(`unknown mock(s): ${unknown.join(', ')}`);
    console.error(`known: ${MOCKS.map(([m]) => m).join(', ')}`);
    process.exit(1);
  }
}

const children = [];
let shuttingDown = false;

for (const [name, port] of wanted) {
  const child = spawn(process.execPath, [path.join(__dirname, `mock-${name}.js`), String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push({ name, child });

  // Prefix every line so nine interleaved logs stay readable.
  const tag = name.padEnd(9);
  const relay = (stream, sink) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) sink.write(`[${tag}] ${line}\n`);
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    // One mock dying silently is the failure mode that wastes an afternoon:
    // the suite fails on an unrelated assertion and the actual cause scrolled
    // past twenty minutes ago. Take the whole group down instead.
    console.error(`[${tag}] exited (${signal || code}) — stopping the rest`);
    stop(1);
  });
}

function stop(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 200).unref();
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log(`starting ${wanted.length} mock server${wanted.length === 1 ? '' : 's'} — Ctrl-C stops all of them`);
