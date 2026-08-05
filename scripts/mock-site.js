/**
 * A stand-in customer website.
 *
 *   node scripts/mock-site.js [port]
 *
 * The snippet's whole job is to work on somebody else's domain, so testing it
 * against a page served from our own would test nothing. This serves a plain
 * HTML page from a different origin with one `<script>` tag and one marked
 * form — which is exactly the install instructions, executed.
 */
const http = require('node:http');

const port = Number(process.argv[2] || 4322);
const APP = process.env.APP_ORIGIN || 'http://localhost:3000';

const page = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>GreenScape Landscaping — Free Quote</title>
  <!-- The install line, exactly as a customer would paste it: one tag,
       carrying the workspace's public key. -->
  <script src="${APP}/p.js?key=pk_demo_greenscape_workspace" async></script>
</head>
<body>
  <h1>Get a free fall cleanup quote</h1>

  <!-- The one line of markup the install asks for: say what this form is. -->
  <form id="quote" data-perception="quote_request" onsubmit="event.preventDefault(); document.getElementById('done').hidden = false;">
    <input name="name" placeholder="Your name" value="Sam">
    <input name="email" data-perception-email value="dana@example.com">
    <input name="job" data-perception-value value="450">
    <button type="submit">Request a quote</button>
  </form>
  <p id="done" hidden>Thanks — we'll be in touch.</p>

  <!-- An untracked form, to prove the snippet leaves it alone. -->
  <form id="search" onsubmit="event.preventDefault();">
    <input name="q" placeholder="Search">
    <button type="submit">Search</button>
  </form>
</body>
</html>`;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  })
  .listen(port, () => console.log(`mock customer site on http://localhost:${port}`));
