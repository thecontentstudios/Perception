/**
 * A stand-in Mastodon instance, just enough of the API to publish against.
 *
 *   node scripts/mock-mastodon.js [port]
 *
 * Real Mastodon is the right thing to test against, and also a terrible thing
 * to depend on in a test suite: it needs an account, it rate-limits, and it
 * leaves real posts on a real timeline. This speaks the same wire protocol —
 * bearer auth, `Idempotency-Key`, the status shape the publisher parses — so
 * the code under test is the real publisher taking a real HTTP round trip.
 *
 * It also honours idempotency the way Mastodon does, which is the property
 * the worker's retry policy depends on.
 */
const http = require('node:http');

const port = Number(process.argv[2] || 4321);
const TOKEN = process.env.MOCK_TOKEN || 'mock-access-token';
const posts = [];
const byKey = new Map();

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '');

    if (req.url === '/api/v1/instance') {
      return send(res, 200, { uri: `localhost:${port}`, title: 'Mock', configuration: { statuses: { max_characters: 500 } } });
    }

    if (req.url === '/api/v1/accounts/verify_credentials') {
      if (auth !== TOKEN) return send(res, 401, { error: 'The access token is invalid' });
      return send(res, 200, { id: '1', username: 'greenscape', acct: 'greenscape' });
    }

    if (req.url === '/api/v1/statuses' && req.method === 'POST') {
      if (auth !== TOKEN) return send(res, 401, { error: 'The access token is invalid' });
      let body = '';
      req.on('data', (c) => (body += c));
      return req.on('end', () => {
        const key = req.headers['idempotency-key'];
        // The behaviour the retry policy leans on: the same key returns the
        // original status rather than creating a second one.
        if (key && byKey.has(key)) return send(res, 200, byKey.get(key));
        const { status } = JSON.parse(body || '{}');
        const post = { id: String(posts.length + 1), url: `http://localhost:${port}/@greenscape/${posts.length + 1}`, content: status };
        posts.push(post);
        if (key) byKey.set(key, post);
        send(res, 200, post);
      });
    }

    // Test introspection, not part of the Mastodon API.
    if (req.url === '/__posts') return send(res, 200, { count: posts.length, posts });

    // Also not Mastodon: let a test start from a known state. Without this,
    // two runs inside the same minute share an idempotency key, the second
    // correctly gets the first run's post back, and the test reads that as a
    // publish that never happened.
    if (req.url === '/__reset' && req.method === 'POST') {
      posts.length = 0;
      byKey.clear();
      return send(res, 200, { reset: true });
    }

    send(res, 404, { error: 'Record not found' });
  })
  .listen(port, () => console.log(`mock mastodon on http://localhost:${port}`));
