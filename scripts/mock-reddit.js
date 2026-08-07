/**
 * A stand-in Reddit API: /api/submit and /api/info, with Reddit's
 * signature behaviours — a mandatory User-Agent, and errors inside a 200.
 *
 *   node scripts/mock-reddit.js [port]
 */
const http = require('node:http');
const crypto = require('node:crypto');

const port = Number(process.argv[2] || 4327);
const TOKEN = process.env.MOCK_REDDIT_TOKEN || 'mock-reddit-token';
const posts = [];
const scores = new Map();

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const auth = (req.headers.authorization || '').replace(/^Bearer /, '');

      if (req.url === '/__reset' && req.method === 'POST') {
        posts.length = 0;
        scores.clear();
        return send(res, 200, { ok: true });
      }
      if (req.url === '/__posts') return send(res, 200, { count: posts.length, posts });
      if (req.url === '/__score' && req.method === 'POST') {
        const b = JSON.parse(raw || '{}');
        scores.set(String(b.id), { score: Number(b.score) || 0, num_comments: Number(b.comments) || 0 });
        return send(res, 200, { ok: true });
      }

      if (!req.headers['user-agent'] || /^curl|^node$/.test(req.headers['user-agent'])) {
        return send(res, 429, { message: 'Too Many Requests', error: 429 }); // what reddit does to anonymous UAs
      }
      if (auth !== TOKEN) return send(res, 401, { message: 'Unauthorized', error: 401 });

      if (req.url === '/api/submit' && req.method === 'POST') {
        const p = Object.fromEntries(new URLSearchParams(raw));
        if (!p.title) {
          // errors inside a 200 — the shape that catches naive clients
          return send(res, 200, { json: { errors: [['NO_TEXT', 'we need something here', 'title']] } });
        }
        const name = `t3_${crypto.randomBytes(5).toString('hex')}`;
        posts.push({ name, sr: p.sr, title: p.title, text: p.text || '' });
        return send(res, 200, { json: { errors: [], data: { name, url: `https://reddit.com/r/${p.sr}/${name}` } } });
      }

      if (req.url.startsWith('/api/info') && req.method === 'GET') {
        const id = new URL(req.url, 'http://x').searchParams.get('id');
        const post = posts.find((x) => x.name === id);
        if (!post) return send(res, 200, { data: { children: [] } });
        const s = scores.get(id) || { score: 0, num_comments: 0 };
        return send(res, 200, { data: { children: [{ data: { ...post, ...s, view_count: null } }] } });
      }

      send(res, 404, { message: 'Not Found', error: 404 });
    });
  })
  .listen(port, () => console.log(`mock reddit on http://localhost:${port}`));
