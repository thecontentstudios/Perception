/** A stand-in Pinterest API v5: /v5/pins + analytics. node scripts/mock-pinterest.js [port] */
const http = require('node:http');
const crypto = require('node:crypto');
const port = Number(process.argv[2] || 4328);
const TOKEN = process.env.MOCK_PINTEREST_TOKEN || 'mock-pinterest-token';
const pins = [];
const analytics = new Map();
const send = (res, s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url === '/__reset' && req.method === 'POST') { pins.length = 0; analytics.clear(); return send(res, 200, { ok: true }); }
    if (req.url === '/__posts') return send(res, 200, { count: pins.length, pins });
    if (req.url === '/__metrics' && req.method === 'POST') {
      const b = JSON.parse(raw || '{}'); analytics.set(String(b.id), b); return send(res, 200, { ok: true });
    }
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (auth !== TOKEN) return send(res, 401, { code: 2, message: 'Authentication failed.' });
    if (req.url === '/v5/pins' && req.method === 'POST') {
      const b = JSON.parse(raw || '{}');
      if (!b.media_source?.url) return send(res, 400, { code: 100, message: 'media_source is required.' });
      if (!b.board_id) return send(res, 400, { code: 100, message: 'board_id is required.' });
      const id = crypto.randomBytes(8).toString('hex');
      pins.push({ id, ...b });
      return send(res, 201, { id });
    }
    const am = /^\/v5\/pins\/([^/]+)\/analytics/.exec(req.url || '');
    if (am && req.method === 'GET') {
      const a = analytics.get(am[1]);
      if (!pins.some((p) => p.id === am[1])) return send(res, 404, { code: 4, message: 'Pin not found.' });
      return send(res, 200, { all: { lifetime_metrics: { IMPRESSION: a?.impressions ?? 0, SAVE: a?.saves ?? 0, OUTBOUND_CLICK: a?.clicks ?? 0 } } });
    }
    send(res, 404, { code: 4, message: 'Not found.' });
  });
}).listen(port, () => console.log(`mock pinterest on http://localhost:${port}`));
