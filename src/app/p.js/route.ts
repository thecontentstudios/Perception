import { appUrl } from '@/lib/oauth/providers';

export const dynamic = 'force-dynamic';

/**
 * The drop-in snippet.
 *
 *   <script src="https://app.perception.example/p.js" async></script>
 *
 * One tag, no build step, no dependencies, and nothing to configure. It is
 * served from a route rather than a static file so the endpoint it posts to is
 * baked in from `APP_URL` — a snippet with a hardcoded host is a support
 * ticket waiting for the first self-hosted install.
 *
 * Three deliberate limits, because a tracking script that oversteps is worse
 * than no tracking script:
 *
 *   - **It does not auto-track every form.** Search boxes, logins, and
 *     newsletter widgets are forms too, and hoovering them up would send us
 *     data the site owner never meant to share. Tracking is opt-in per form,
 *     with `data-perception="quote_request"`.
 *   - **It sends no personal data unless asked.** An email goes only if a
 *     field is explicitly marked `data-perception-email`.
 *   - **It stores nothing on our domain.** Attribution lives in the visitor's
 *     own localStorage, first-party to the customer's site.
 */
export async function GET(req: Request) {
  const endpoint = `${appUrl()}/api/events`;
  // The snippet is served per-tenant: ?key=pk_... gets baked in so the
  // customer pastes one tag and nothing else. Public by design — it names a
  // workspace and authorizes nothing.
  const key = new URL(req.url).searchParams.get('key') ?? '';

  const js = `/* Perception — conversion tracking. One tag, no dependencies. */
(function () {
  'use strict';
  var ENDPOINT = ${JSON.stringify(endpoint)};
  var SITE_KEY = ${JSON.stringify(key)};
  var STORE = 'perception.attribution';
  // Matches the server's attribution window; a click older than this is not
  // credited, here or there.
  var WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

  function read() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return null;
      var a = JSON.parse(raw);
      return a && a.t && Date.now() - a.t < WINDOW_MS ? a : null;
    } catch (e) { return null; }
  }

  function write(a) {
    try { localStorage.setItem(STORE, JSON.stringify(a)); } catch (e) {}
  }

  /* Capture attribution off the landing URL. Last touch wins: the most recent
     click is the one credited, which is the model a small business can
     actually reason about. */
  function capture() {
    var q = new URLSearchParams(location.search);
    var click = q.get('pcp_click');
    var content = q.get('utm_content');
    var campaign = q.get('utm_campaign');
    if (!click && !content && !campaign) return;
    write({ click: click, content: content, campaign: campaign, t: Date.now() });
  }

  function send(kind, opts) {
    opts = opts || {};
    var a = read() || {};
    var body = {
      kind: kind,
      key: SITE_KEY || undefined,
      clickId: a.click || undefined,
      utmContent: a.content || undefined,
      utmCampaign: a.campaign || undefined,
      valueCents: opts.valueCents,
      email: opts.email,
      /* A stable id per submission, so a retry or a double-click counts once. */
      eventId: opts.eventId || (kind + ':' + (a.click || 'none') + ':' + Date.now())
    };
    var payload = JSON.stringify(body);
    /* sendBeacon survives the page navigating away, which is exactly what a
       form submission does — a plain fetch here loses a conversion on every
       form that actually posts somewhere.

       text/plain, not application/json, and that matters: a JSON content type
       makes this a preflighted cross-origin request, and sendBeacon queues
       *before* it knows whether the preflight passed. It returns true either
       way, so a failed preflight silently drops the conversion with no
       fallback. text/plain is a simple request — no preflight, no silent
       loss. The server parses the body regardless of what it is labelled. */
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon(ENDPOINT, blob)) return true;
      }
    } catch (e) {}
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: payload,
        keepalive: true
      });
    } catch (e) {}
    return true;
  }

  /* Opt-in form tracking. A form says what it is; we never guess. */
  function wire() {
    var forms = document.querySelectorAll('form[data-perception]');
    for (var i = 0; i < forms.length; i++) {
      (function (form) {
        if (form.__perceptionWired) return;
        form.__perceptionWired = true;
        form.addEventListener('submit', function () {
          var kind = form.getAttribute('data-perception');
          var emailField = form.querySelector('[data-perception-email]');
          var valueField = form.querySelector('[data-perception-value]');
          send(kind, {
            email: emailField && emailField.value ? emailField.value : undefined,
            valueCents: valueField && valueField.value
              ? Math.round(parseFloat(valueField.value) * 100)
              : undefined
          });
        });
      })(forms[i]);
    }
  }

  capture();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
  /* Single-page apps swap forms in after load, so re-wire on DOM changes.
     Wiring is idempotent per form, so this cannot double-count. */
  try {
    new MutationObserver(wire).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  window.perception = {
    track: send,
    attribution: read,
    /* Exposed so a site can wire a phone tap or a chat widget by hand. */
    version: 1
  };
})();
`;

  return new Response(js, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      // Short cache: the snippet is small and changing it should reach people
      // the same day, not next month.
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  });
}
