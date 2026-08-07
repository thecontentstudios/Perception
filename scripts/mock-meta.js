/**
 * A stand-in Meta Graph API, just enough to post to a Page against.
 *
 *   node scripts/mock-meta.js [port]
 *
 * Real Meta needs a business app, App Review for pages_manage_posts, and a
 * reviewed privacy policy — weeks of queue for a test that posts "hello".
 * This speaks the same wire protocol: form-encoded POSTs, the `{ id }`
 * response, the `{ error: { code, type } }` failure shape the adapter
 * classifies, and the insights format for metrics.
 *
 * Unlike Bluesky and Mastodon, **this platform reports impressions** — which
 * makes Facebook the first channel where the platform-metrics reader returns
 * a real reach number instead of an honest null.
 *
 * Control endpoints, outside the Graph surface:
 *   POST /__reset                    forget everything
 *   GET  /__posts                    what was published
 *   POST /__insights {id, impressions, reactions, comments, shares}
 *   POST /__revoke                   make the token invalid (Graph code 190)
 */
const http = require('node:http');
const crypto = require('node:crypto');

const port = Number(process.argv[2] || 4325);
const TOKEN = process.env.MOCK_META_TOKEN || 'mock-page-token';
const PAGE_ID = process.env.MOCK_META_PAGE_ID || '108000000001';
const IG_ID = process.env.MOCK_META_IG_ID || '17840000000001';
const THREADS_ID = process.env.MOCK_META_THREADS_ID || '9990000000001';
/** Containers created and not yet published — the two-step's middle state. */
const containers = new Map();

const posts = [];
const insights = new Map();
let revoked = false;

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const graphError = (res, status, code, message) =>
  send(res, status, { error: { message, type: 'OAuthException', code } });

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw));
  });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const raw = req.method === 'POST' ? await readBody(req) : '';

    if (url.pathname === '/__reset' && req.method === 'POST') {
      posts.length = 0;
      insights.clear();
      containers.clear();
      revoked = false;
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/__posts') return send(res, 200, { count: posts.length, posts });
    if (url.pathname === '/__revoke' && req.method === 'POST') {
      revoked = true;
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/__insights' && req.method === 'POST') {
      // Stores whatever metric names the test supplies; the insights GET
      // answers with whichever names the adapter asks for. One mechanism
      // serves post_impressions, impressions, views and friends.
      const b = JSON.parse(raw || '{}');
      const id = String(b.id);
      delete b.id;
      insights.set(id, Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Number(v) || 0])));
      return send(res, 200, { ok: true });
    }

    // POST /v21.0/{page-id}/photos — a photo post; the text is its caption.
    if (url.pathname === `/v21.0/${PAGE_ID}/photos` && req.method === 'POST') {
      // multipart: token travels as a form field here, not a query param.
      const cap = /name="caption"\r\n\r\n([^\r]*)/.exec(raw);
      const alt = /name="alt_text_custom"\r\n\r\n([^\r]*)/.exec(raw);
      const tok = /name="access_token"\r\n\r\n([^\r]*)/.exec(raw);
      const file = /name="source"[^]*?\r\n\r\n([^]*?)\r\n--/.exec(raw);
      if ((tok ? tok[1] : '') !== TOKEN || revoked) {
        return graphError(res, 401, 190, 'Error validating access token: the session is invalid.');
      }
      if (!file) return graphError(res, 400, 100, 'The parameter source is required.');
      const id = `${PAGE_ID}_${crypto.randomBytes(8).toString('hex')}`;
      posts.push({ id, message: cap ? cap[1] : '', photo: true, altText: alt ? alt[1] : null, bytes: file[1].length });
      return send(res, 200, { id: crypto.randomBytes(6).toString('hex'), post_id: id });
    }

    // ---- the Graph API ---------------------------------------------------
    // Tokens travel as a form field or query param, never a header — one of
    // the small ways Graph differs from everything else.
    const params = new URLSearchParams(raw);
    const token = url.searchParams.get('access_token') || params.get('access_token');
    if (token !== TOKEN || revoked) {
      return graphError(res, 401, 190, 'Error validating access token: the session is invalid.');
    }

    // Instagram and Threads share the container → publish dance.
    const containerRoutes = [
      { create: `/v21.0/${IG_ID}/media`, publish: `/v21.0/${IG_ID}/media_publish`, kind: 'instagram', requireImage: true },
      { create: `/v1.0/${THREADS_ID}/threads`, publish: `/v1.0/${THREADS_ID}/threads_publish`, kind: 'threads', requireImage: false },
    ];
    for (const r of containerRoutes) {
      if (url.pathname === r.create && req.method === 'POST') {
        if (r.requireImage && !params.get('image_url')) {
          return graphError(res, 400, 100, 'Media type requires image_url.');
        }
        const id = `cont_${crypto.randomBytes(6).toString('hex')}`;
        containers.set(id, {
          kind: r.kind,
          text: params.get('caption') ?? params.get('text') ?? '',
          imageUrl: params.get('image_url') || null,
          altText: params.get('alt_text') || null,
          mediaType: params.get('media_type') || (r.kind === 'instagram' ? 'IMAGE' : null),
        });
        return send(res, 200, { id });
      }
      if (url.pathname === r.publish && req.method === 'POST') {
        const c = containers.get(params.get('creation_id') || '');
        if (!c) return graphError(res, 400, 100, 'Invalid creation_id.');
        containers.delete(params.get('creation_id'));
        const id = `${r.kind}_${crypto.randomBytes(8).toString('hex')}`;
        posts.push({ id, ...c });
        return send(res, 200, { id });
      }
    }

    // POST /v21.0/{page-id}/feed — publish to the Page.
    if (url.pathname === `/v21.0/${PAGE_ID}/feed` && req.method === 'POST') {
      const message = params.get('message');
      if (!message) return graphError(res, 400, 100, 'The parameter message is required.');
      const id = `${PAGE_ID}_${crypto.randomBytes(8).toString('hex')}`;
      posts.push({ id, message, link: params.get('link') || null });
      return send(res, 200, { id });
    }

    // GET /v21.0/{post-id}/insights?metric=post_impressions
    const insightsMatch = /^\/v(?:21|1)\.0\/([^/]+)\/insights$/.exec(url.pathname);
    if (insightsMatch && req.method === 'GET') {
      const id = insightsMatch[1];
      if (!posts.some((p) => p.id === id)) {
        return graphError(res, 404, 100, 'Unsupported get request. Object does not exist.');
      }
      const stored = insights.get(id) || {};
      const asked = (url.searchParams.get('metric') || 'post_impressions').split(',');
      return send(res, 200, {
        data: asked.map((name) => ({ name, period: 'lifetime', values: [{ value: stored[name] ?? 0 }] })),
      });
    }

    // GET /v21.0/{post-id}?fields=reactions.summary(true),comments.summary(true),shares
    const postMatch = /^\/v21\.0\/([^/]+)$/.exec(url.pathname);
    if (postMatch && req.method === 'GET') {
      const id = postMatch[1];
      const post = posts.find((p) => p.id === id);
      if (!post) return graphError(res, 404, 100, 'Unsupported get request. Object does not exist.');
      const i = insights.get(id) || {};
      return send(res, 200, {
        id,
        reactions: { summary: { total_count: i.reactions ?? 0 } },
        comments: { summary: { total_count: i.comments ?? 0 } },
        shares: { count: i.shares ?? 0 },
      });
    }

    send(res, 404, { error: { message: 'Unknown path', type: 'GraphMethodException', code: 100 } });
  })
  .listen(port, () => console.log(`mock meta graph on http://localhost:${port} (page ${PAGE_ID})`));
