/**
 * A stand-in Resend, just enough of the API to send against.
 *
 *   node scripts/mock-resend.js [port]
 *
 * Real Resend is the right thing to test against and a terrible thing to
 * depend on in a test suite: it needs an account, a verified domain, and it
 * delivers real mail to real people. This speaks the same wire protocol —
 * bearer auth, `Idempotency-Key`, the `{ id }` response the adapter parses,
 * the error shapes it classifies — so the code under test is the real adapter
 * taking a real HTTP round trip.
 *
 * It also fires signed webhooks back, because the half of this phase that
 * matters most (a bounce suppressing an address) cannot be exercised any other
 * way.
 *
 * Control endpoints, all outside the Resend API surface so they cannot be
 * confused with it:
 *
 *   POST /__reset                      forget every message
 *   GET  /__messages                   everything "sent", for assertions
 *   POST /__fail    {status, times}    make the next N sends fail
 *   POST /__webhook {type, id, ...}    deliver a signed event to the app
 */
const http = require('node:http');
const crypto = require('node:crypto');

const port = Number(process.argv[2] || 4323);
const API_KEY = process.env.MOCK_RESEND_KEY || 'mock-resend-key';
const WEBHOOK_SECRET = process.env.MOCK_RESEND_WEBHOOK_SECRET || 'whsec_' + Buffer.alloc(24, 7).toString('base64');
const APP_URL = process.env.MOCK_APP_URL || 'http://localhost:3000';

const messages = [];
/** Idempotency-Key -> the id we already handed out for it. */
const byKey = new Map();
let failFor = { status: 0, times: 0 };

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw));
  });

/** Sign exactly the way Svix does, so the app's verifier is really exercised. */
function signWebhook(id, timestampSec, rawBody) {
  const key = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
  const mac = crypto.createHmac('sha256', key).update(`${id}.${timestampSec}.${rawBody}`).digest('base64');
  return `v1,${mac}`;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const raw = req.method === 'POST' ? await readBody(req) : '';

    // ---- control surface -------------------------------------------------

    if (url.pathname === '/__reset' && req.method === 'POST') {
      messages.length = 0;
      byKey.clear();
      failFor = { status: 0, times: 0 };
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/__messages') {
      return send(res, 200, { messages });
    }

    if (url.pathname === '/__fail' && req.method === 'POST') {
      const body = JSON.parse(raw || '{}');
      failFor = { status: Number(body.status) || 500, times: Number(body.times) || 1 };
      return send(res, 200, { ok: true, failFor });
    }

    // Deliver a signed webhook to the app, the way Resend would.
    if (url.pathname === '/__webhook' && req.method === 'POST') {
      const body = JSON.parse(raw || '{}');
      const payload = JSON.stringify({
        type: body.type,
        created_at: new Date().toISOString(),
        data: {
          email_id: body.email_id,
          to: body.to ? [body.to] : undefined,
          ...(body.bounce ? { bounce: body.bounce } : {}),
        },
      });
      const id = 'msg_' + crypto.randomBytes(8).toString('hex');
      const ts = Math.floor(Date.now() / 1000);
      const headers = {
        'content-type': 'application/json',
        'svix-id': id,
        'svix-timestamp': String(ts),
        'svix-signature': body.badSignature ? 'v1,AAAA' : signWebhook(id, ts, payload),
      };
      const target = `${APP_URL}/api/webhooks/resend`;
      try {
        const r = await fetch(target, { method: 'POST', headers, body: payload });
        return send(res, 200, { ok: true, appStatus: r.status, appBody: await r.json().catch(() => null) });
      } catch (e) {
        return send(res, 502, { ok: false, error: String(e) });
      }
    }

    // ---- the Resend API --------------------------------------------------

    if (url.pathname === '/emails' && req.method === 'POST') {
      const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (auth !== API_KEY) {
        return send(res, 401, { name: 'validation_error', message: 'API key is invalid' });
      }

      if (failFor.times > 0) {
        failFor.times -= 1;
        return send(res, failFor.status, { name: 'application_error', message: 'Injected failure' });
      }

      // Idempotency, the property the worker's retry policy depends on: the
      // same key returns the same id and does not deliver a second message.
      const key = req.headers['idempotency-key'];
      if (key && byKey.has(key)) {
        return send(res, 200, { id: byKey.get(key) });
      }

      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { name: 'validation_error', message: 'Body is not JSON' });
      }
      if (!body.from || !body.to?.length) {
        return send(res, 422, { name: 'validation_error', message: 'from and to are required' });
      }

      const id = crypto.randomUUID();
      if (key) byKey.set(key, id);
      messages.push({
        id,
        idempotencyKey: key ?? null,
        from: body.from,
        to: body.to,
        subject: body.subject,
        text: body.text,
        html: body.html,
        headers: body.headers ?? {},
      });
      return send(res, 200, { id });
    }

    send(res, 404, { name: 'not_found', message: 'No such endpoint' });
  })
  .listen(port, () => {
    console.log(`mock resend on http://localhost:${port}`);
    console.log(`  api key: ${API_KEY}`);
    console.log(`  webhook secret: ${WEBHOOK_SECRET}`);
  });
