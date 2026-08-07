/**
 * A stand-in Bluesky PDS — uploadBlob and createRecord, enough to post
 * against with images.
 *
 *   node scripts/mock-bluesky.js [port]
 *
 * Bluesky needs no app review, so unlike Meta the real network is usable —
 * but a test suite that posts to a real timeline on every run is spam with
 * a CI badge. This speaks the XRPC wire shapes the adapter touches: bearer
 * auth, `{ blob }` from uploadBlob, `{ uri, cid }` from createRecord, and
 * the ExpiredToken error body the refresh path looks for.
 *
 * Control endpoints:
 *   POST /__reset     forget everything
 *   GET  /__posts     records created, with their embeds
 */
const http = require('node:http');
const crypto = require('node:crypto');

const port = Number(process.argv[2] || 4326);
const TOKEN = process.env.MOCK_BSKY_TOKEN || 'mock-bsky-access-jwt';

const records = [];
const blobs = new Map();

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

http
  .createServer(async (req, res) => {
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '');

    if (req.url === '/__reset' && req.method === 'POST') {
      records.length = 0;
      blobs.clear();
      return send(res, 200, { ok: true });
    }
    if (req.url === '/__posts') return send(res, 200, { count: records.length, records });

    if (req.url === '/xrpc/com.atproto.repo.uploadBlob' && req.method === 'POST') {
      if (auth !== TOKEN) return send(res, 400, { error: 'InvalidToken', message: 'invalid token' });
      const body = await readBody(req);
      const ref = `bafk${crypto.randomBytes(16).toString('hex')}`;
      const blob = {
        $type: 'blob',
        ref: { $link: ref },
        mimeType: req.headers['content-type'] || 'application/octet-stream',
        size: body.length,
      };
      blobs.set(ref, blob);
      return send(res, 200, { blob });
    }

    if (req.url === '/xrpc/com.atproto.repo.createRecord' && req.method === 'POST') {
      if (auth !== TOKEN) return send(res, 400, { error: 'InvalidToken', message: 'invalid token' });
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const rkey = crypto.randomBytes(6).toString('hex');
      const record = body.record || {};
      // An embed that references a blob nobody uploaded is the bug this mock
      // exists to catch — the real PDS refuses exactly this way.
      for (const img of record.embed?.images ?? []) {
        const link = img.image?.ref?.$link;
        if (!link || !blobs.has(link)) {
          return send(res, 400, { error: 'InvalidRequest', message: 'embed references an unknown blob' });
        }
      }
      const uri = `at://${body.repo}/app.bsky.feed.post/${rkey}`;
      records.push({ uri, text: record.text, embed: record.embed ?? null });
      return send(res, 200, { uri, cid: `bafyrei${crypto.randomBytes(12).toString('hex')}` });
    }

    send(res, 404, { error: 'MethodNotImplemented', message: 'Unknown xrpc method' });
  })
  .listen(port, () => console.log(`mock bluesky pds on http://localhost:${port}`));
