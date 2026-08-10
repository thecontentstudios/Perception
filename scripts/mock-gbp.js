/** A stand-in Google Business Profile v4: localPosts + reportInsights. node scripts/mock-gbp.js [port] */
const http = require('node:http');
const crypto = require('node:crypto');
const port = Number(process.argv[2] || 4329);
const TOKEN = process.env.MOCK_GBP_TOKEN || 'mock-gbp-token';
const posts = [];
const insights = new Map();
const send = (res, s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url === '/__reset' && req.method === 'POST') { posts.length = 0; insights.clear(); return send(res, 200, { ok: true }); }
    if (req.url === '/__posts') return send(res, 200, { count: posts.length, posts });
    if (req.url === '/__metrics' && req.method === 'POST') {
      const b = JSON.parse(raw || '{}'); insights.set(String(b.name), b); return send(res, 200, { ok: true });
    }
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (auth !== TOKEN) return send(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } });
    const create = /^\/v4\/(accounts\/[^/]+\/locations\/[^/]+)\/localPosts$/.exec(req.url || '');
    if (create && req.method === 'POST') {
      const b = JSON.parse(raw || '{}');
      if (!b.summary) return send(res, 400, { error: { code: 400, message: 'summary is required.' } });
      const name = `${create[1]}/localPosts/${crypto.randomBytes(6).toString('hex')}`;
      posts.push({ name, ...b });
      return send(res, 200, { name, state: 'LIVE' });
    }
    if (/localPosts:reportInsights$/.test(req.url || '') && req.method === 'POST') {
      const b = JSON.parse(raw || '{}');
      const name = b.localPostNames?.[0];
      if (!posts.some((p) => p.name === name)) return send(res, 404, { error: { code: 404, message: 'Post not found.' } });
      const i = insights.get(name) || {};
      return send(res, 200, {
        localPostMetrics: [{
          localPostName: name,
          metricValues: [
            { metric: 'LOCAL_POST_VIEWS_SEARCH', totalValue: { value: String(i.views ?? 0) } },
            { metric: 'LOCAL_POST_ACTIONS_CALL_TO_ACTION', totalValue: { value: String(i.clicks ?? 0) } },
          ],
        }],
      });
    }
    send(res, 404, { error: { code: 404, message: 'Not found.' } });
  });
}).listen(port, () => console.log(`mock gbp on http://localhost:${port}`));
