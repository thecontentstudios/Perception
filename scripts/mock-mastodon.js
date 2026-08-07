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
/** Per-status engagement counters a test can set. */
const engagement = new Map();
/** Uploaded media, by id, so a status can reference it. */
const mediaStore = new Map();
/** Notifications a test has staged, newest first, the way Mastodon returns them. */
const notifications = [];

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

    // POST /api/v2/media — image upload. Parsed loosely: the tests send
    // ASCII stand-in bytes, and what matters on this side is that the
    // description (Mastodon's name for alt text) survives the trip.
    if (req.url === '/api/v2/media' && req.method === 'POST') {
      if (auth !== TOKEN) return send(res, 401, { error: 'The access token is invalid' });
      let body = '';
      req.on('data', (c) => (body += c));
      return req.on('end', () => {
        const desc = /name="description"\r\n\r\n([^\r]*)/.exec(body);
        const file = /name="file"[^]*?\r\n\r\n([^]*?)\r\n--/.exec(body);
        const id = String(700 + mediaStore.size);
        mediaStore.set(id, { description: desc ? desc[1] : null, bytes: file ? file[1].length : 0 });
        send(res, 200, { id, type: 'image', description: desc ? desc[1] : null });
      });
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
        const { status, media_ids } = JSON.parse(body || '{}');
        const attachments = (media_ids || []).map((id) => mediaStore.get(String(id))).filter(Boolean);
        const post = { id: String(posts.length + 1), url: `http://localhost:${port}/@greenscape/${posts.length + 1}`, content: status, media_attachments: attachments };
        posts.push(post);
        if (key) byKey.set(key, post);
        send(res, 200, post);
      });
    }

    // GET a single status — how the metrics reader asks how a post is doing.
    //
    // The counters this returns are the whole point of the endpoint for our
    // purposes, and so is what it *omits*: there is no view count, because
    // Mastodon does not have one. A stand-in that invented an `views` field
    // would let a reader pass that could never work against a real instance.
    const statusMatch = /^\/api\/v1\/statuses\/([^/?]+)$/.exec(req.url || '');
    if (statusMatch && req.method === 'GET') {
      if (auth !== TOKEN) return send(res, 401, { error: 'The access token is invalid' });
      const id = decodeURIComponent(statusMatch[1]);
      const post = posts.find((p) => p.id === id);
      // A deleted status is a 404, and the reader is expected to treat that as
      // an answer rather than an error.
      if (!post) return send(res, 404, { error: 'Record not found' });
      const counts = engagement.get(id) || { favourites: 0, reblogs: 0, replies: 0 };
      return send(res, 200, {
        ...post,
        favourites_count: counts.favourites,
        reblogs_count: counts.reblogs,
        replies_count: counts.replies,
      });
    }

    // GET /api/v1/notifications — mentions and replies for the inbox poll.
    if (req.url.startsWith('/api/v1/notifications') && req.method === 'GET') {
      if (auth !== TOKEN) return send(res, 401, { error: 'The access token is invalid' });
      return send(res, 200, notifications);
    }

    // Stage a notification: {type, from, text, statusId}
    if (req.url === '/__notify' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      return req.on('end', () => {
        const b = JSON.parse(body || '{}');
        notifications.unshift({
          id: String(9000 + notifications.length),
          type: b.type || 'mention',
          created_at: new Date().toISOString(),
          account: { display_name: b.from || 'Casey Reyes', acct: (b.from || 'casey').toLowerCase().replace(/\s+/g, '') },
          status: b.statusId || b.text
            ? { id: String(b.statusId ?? 5000 + notifications.length), content: `<p>${b.text ?? ''}</p>` }
            : undefined,
        });
        send(res, 200, { ok: true, staged: notifications.length });
      });
    }

    // Test introspection, not part of the Mastodon API.
    if (req.url === '/__posts') return send(res, 200, { count: posts.length, posts });

    // Give a post some engagement, so a test can assert a number it chose.
    if (req.url === '/__engage' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      return req.on('end', () => {
        const b = JSON.parse(body || '{}');
        engagement.set(String(b.id), {
          favourites: Number(b.favourites) || 0,
          reblogs: Number(b.reblogs) || 0,
          replies: Number(b.replies) || 0,
        });
        send(res, 200, { ok: true });
      });
    }

    // Delete a post, so a test can check the reader records it as gone rather
    // than retrying a 404 for ever.
    if (req.url === '/__delete' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      return req.on('end', () => {
        const b = JSON.parse(body || '{}');
        const i = posts.findIndex((p) => p.id === String(b.id));
        if (i >= 0) posts.splice(i, 1);
        send(res, 200, { ok: true, deleted: i >= 0 });
      });
    }

    // Also not Mastodon: let a test start from a known state. Without this,
    // two runs inside the same minute share an idempotency key, the second
    // correctly gets the first run's post back, and the test reads that as a
    // publish that never happened.
    if (req.url === '/__reset' && req.method === 'POST') {
      posts.length = 0;
      byKey.clear();
      engagement.clear();
      mediaStore.clear();
      notifications.length = 0;
      return send(res, 200, { reset: true });
    }

    send(res, 404, { error: 'Record not found' });
  })
  .listen(port, () => console.log(`mock mastodon on http://localhost:${port}`));
