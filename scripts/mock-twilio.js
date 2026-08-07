/**
 * A stand-in Twilio, just enough of the API to text against.
 *
 *   node scripts/mock-twilio.js [port]
 *
 * Real Twilio needs an account, a registered 10DLC campaign and a rented
 * number, and every test message goes to a real handset. This speaks the same
 * wire protocol — Basic auth, form-encoded bodies, the `{ sid, num_segments }`
 * response the adapter parses, the error codes it classifies — so the code
 * under test is the real adapter taking a real HTTP round trip.
 *
 * It counts segments itself, using the same GSM-7 rule a carrier does, which
 * is the point: `sms.ts` has computed that number since Phase 5 with nothing
 * to contradict it, and a counter nothing has ever disagreed with is a counter
 * nobody has tested.
 *
 * Control endpoints, outside the Twilio surface so they cannot be confused
 * with it:
 *
 *   POST /__reset                       forget every message
 *   GET  /__messages                    everything "sent", for assertions
 *   POST /__fail    {status, code}      make the next send fail
 *   POST /__inbound {from, body}        deliver a signed inbound SMS
 *   POST /__status  {sid, status, code} deliver a signed delivery receipt
 */
const http = require('node:http');
const crypto = require('node:crypto');

const port = Number(process.argv[2] || 4324);
const SID = process.env.MOCK_TWILIO_SID || 'ACmock00000000000000000000000000';
const TOKEN = process.env.MOCK_TWILIO_TOKEN || 'mock-twilio-auth-token';
const APP_URL = process.env.MOCK_APP_URL || 'http://localhost:3000';

const messages = [];
const byKey = new Map();
let failNext = null;

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

/**
 * Segment counting, the way a carrier does it.
 *
 * Written independently of src/lib/sms.ts on purpose. A stand-in that imported
 * the implementation it is meant to check would agree with it by construction
 * and prove nothing.
 */
const GSM = new Set(
  ('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà').split('')
);
const GSM_EXT = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);

function countSegments(body) {
  let gsm = true;
  for (const ch of body) {
    if (!GSM.has(ch) && !GSM_EXT.has(ch)) { gsm = false; break; }
  }
  if (!gsm) {
    const units = body.length; // UTF-16 code units, which is what is billed
    return units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67);
  }
  let septets = 0;
  for (const ch of body) septets += GSM_EXT.has(ch) ? 2 : 1;
  if (septets === 0) return 0;
  if (septets <= 160) return 1;
  // Escape pairs cannot straddle a boundary.
  let segments = 1;
  let used = 0;
  for (const ch of body) {
    const cost = GSM_EXT.has(ch) ? 2 : 1;
    if (used + cost > 153) { segments += 1; used = cost; } else { used += cost; }
  }
  return segments;
}

function signRequest(url, params) {
  const payload = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha1', TOKEN).update(Buffer.from(payload, 'utf8')).digest('base64');
}

async function postSigned(path, params, { badSignature } = {}) {
  const url = `${APP_URL}${path}`;
  const form = new URLSearchParams(params).toString();
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': badSignature ? 'AAAA' : signRequest(url, params),
    },
    body: form,
  });
  return { status: r.status, body: await r.text() };
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const raw = req.method === 'POST' ? await readBody(req) : '';

    // ---- control surface -------------------------------------------------

    if (url.pathname === '/__reset' && req.method === 'POST') {
      messages.length = 0;
      byKey.clear();
      failNext = null;
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/__messages') return send(res, 200, { messages });

    if (url.pathname === '/__fail' && req.method === 'POST') {
      const b = JSON.parse(raw || '{}');
      failNext = { status: Number(b.status) || 400, code: Number(b.code) || 0, message: b.message || 'Injected failure' };
      return send(res, 200, { ok: true, failNext });
    }

    if (url.pathname === '/__inbound' && req.method === 'POST') {
      const b = JSON.parse(raw || '{}');
      const out = await postSigned(
        '/api/webhooks/twilio/inbound',
        {
          From: b.from,
          To: b.to || '+15550001111',
          Body: b.body ?? '',
          MessageSid: b.sid || 'SM' + crypto.randomBytes(8).toString('hex'),
          AccountSid: SID,
        },
        { badSignature: b.badSignature }
      );
      return send(res, 200, { ok: true, appStatus: out.status, appBody: out.body.slice(0, 200) });
    }

    if (url.pathname === '/__status' && req.method === 'POST') {
      const b = JSON.parse(raw || '{}');
      const params = { MessageSid: b.sid, MessageStatus: b.status, AccountSid: SID };
      if (b.code) params.ErrorCode = String(b.code);
      const out = await postSigned('/api/webhooks/twilio/status', params, { badSignature: b.badSignature });
      return send(res, 200, { ok: true, appStatus: out.status, appBody: out.body.slice(0, 200) });
    }

    // ---- the Twilio API --------------------------------------------------

    if (url.pathname === `/2010-04-01/Accounts/${SID}/Messages.json` && req.method === 'POST') {
      const header = req.headers.authorization || '';
      const decoded = Buffer.from(header.replace(/^Basic /, ''), 'base64').toString();
      if (decoded !== `${SID}:${TOKEN}`) {
        return send(res, 401, { code: 20003, message: 'Authentication Error' });
      }

      if (failNext) {
        const f = failNext;
        failNext = null;
        return send(res, f.status, { code: f.code, message: f.message });
      }

      const key = req.headers['i-twilio-idempotency-token'];
      if (key && byKey.has(key)) return send(res, 201, byKey.get(key));

      const params = Object.fromEntries(new URLSearchParams(raw));
      if (!params.To || !params.From || params.Body === undefined) {
        return send(res, 400, { code: 21604, message: 'To, From and Body are required' });
      }

      const sid = 'SM' + crypto.randomBytes(16).toString('hex');
      const payload = {
        sid,
        status: 'queued',
        to: params.To,
        from: params.From,
        body: params.Body,
        num_segments: String(countSegments(params.Body)),
      };
      if (key) byKey.set(key, payload);
      messages.push({ ...payload, idempotencyKey: key ?? null, statusCallback: params.StatusCallback ?? null });
      return send(res, 201, payload);
    }

    send(res, 404, { code: 20404, message: 'Not Found' });
  })
  .listen(port, () => {
    console.log(`mock twilio on http://localhost:${port}`);
    console.log(`  account sid: ${SID}`);
    console.log(`  auth token:  ${TOKEN}`);
  });
