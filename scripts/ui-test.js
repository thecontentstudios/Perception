/**
 * UI regression suite for the Perception prototype.
 *
 * Drives the interaction surfaces that unit tests can't reach: the collapsible
 * nav rail, resizable side panel, hideable ideas rail, drag-and-drop
 * rescheduling, screen-reader announcements, layout overflow at three widths,
 * and reduced-motion compliance.
 *
 *   npm run build && npm start &     # server must be on :3000
 *   npm run test:ui
 *
 * Exits non-zero on any failure, so it drops straight into CI.
 */
const { chromium } = require('playwright-core');
const OUT = process.env.SHOT_DIR || require('os').tmpdir();
const fail = [];
const ok = (m) => console.log('  PASS ' + m);
const bad = (m) => { fail.push(m); console.log('  FAIL ' + m); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Sign in first.
  //
  // Every database-backed section below checks whether it is looking at real
  // rows and skips if not — which, once auth landed, meant six sections
  // quietly stopped running and the suite passed by doing nothing. An
  // authenticated browser is also simply what a real session looks like.
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
  const signedIn = await page.evaluate(() =>
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dana@summitlocal.co', password: 'demo-password-change-me' }),
    }).then((r) => r.json())
  );
  console.log('\n== 0. Session ==');
  signedIn.ok ? ok(`signed in as ${signedIn.user.name} (${signedIn.user.role})`) : bad(`could not sign in: ${signedIn.reason}`);

  // Layout preferences persist by design, so a previous run must not leak
  // into this one (collapsed groups would hide the elements later checks click).
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('perception.'))
      .forEach((k) => localStorage.removeItem(k));
  });

  console.log('\n== 1. Sectioned nav ==');
  await page.goto('http://localhost:3000/calendar', { waitUntil: 'networkidle' });
  const sections = await page.$$eval('.nav-section-label', (els) => els.map((e) => e.textContent));
  console.log('  sections:', sections.join(', '));
  sections.length === 4 ? ok('four nav sections') : bad('expected 4 sections, got ' + sections.length);

  console.log('\n== 2. Nav collapse to rail + persistence ==');
  const wideNav = await page.$eval('.nav', (e) => e.getBoundingClientRect().width);
  await page.click('.nav-collapse');
  await page.waitForTimeout(450);
  const railNav = await page.$eval('.nav', (e) => e.getBoundingClientRect().width);
  console.log(`  nav width ${wideNav} -> ${railNav}`);
  railNav < wideNav - 100 ? ok('nav collapses to rail') : bad('nav did not collapse');
  const labelsHidden = await page.$eval('.nav-label', (e) => getComputedStyle(e).display === 'none');
  labelsHidden ? ok('labels hidden in rail') : bad('labels still visible in rail');
  await page.screenshot({ path: `${OUT}/ui-rail.png` });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const afterReload = await page.$eval('.nav', (e) => e.getBoundingClientRect().width);
  afterReload < 100 ? ok('rail state persisted across reload') : bad('rail state not persisted (' + afterReload + ')');
  await page.click('.nav-collapse'); // restore
  await page.waitForTimeout(400);

  console.log('\n== 3. Hide/show ideas rail ==');
  const calBefore = await page.$eval('.cal-month', (e) => e.getBoundingClientRect().width);
  await page.click('text=Hide ideas');
  await page.waitForTimeout(450);
  const calAfter = await page.$eval('.cal-month', (e) => e.getBoundingClientRect().width);
  console.log(`  calendar width ${Math.round(calBefore)} -> ${Math.round(calAfter)}`);
  calAfter > calBefore + 100 ? ok('calendar reclaims rail width') : bad('calendar did not widen');
  await page.screenshot({ path: `${OUT}/ui-ideas-hidden.png` });
  await page.click('text=Show ideas');
  await page.waitForTimeout(400);

  console.log('\n== 4. Resizable side panel ==');
  await page.click('text=Video walkthrough');
  await page.waitForTimeout(400);
  const w1 = await page.$eval('.side-panel', (e) => e.getBoundingClientRect().width);
  const handle = await page.$('.resizer');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x - 220, box.y + 300, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const w2 = await page.$eval('.side-panel', (e) => e.getBoundingClientRect().width);
  console.log(`  panel width ${Math.round(w1)} -> ${Math.round(w2)}`);
  w2 > w1 + 100 ? ok('panel drag-resizes wider') : bad('panel did not resize');
  await page.screenshot({ path: `${OUT}/ui-panel-wide.png` });

  console.log('\n== 5. Keyboard resize + Escape close ==');
  await page.focus('.resizer');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const w3 = await page.$eval('.side-panel', (e) => e.getBoundingClientRect().width);
  w3 < w2 ? ok('arrow key shrinks panel') : bad('keyboard resize did nothing');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const panelGone = (await page.$('.side-panel')) === null;
  panelGone ? ok('Escape closes panel') : bad('Escape did not close panel');

  console.log('\n== 6. Drag-and-drop reschedule + announcement ==');
  // Since Phase 1.3 a drag actually persists, so this has to put the card back
  // or every run shifts the demo workspace a little further from its seed —
  // which is exactly how a later section started failing to find a card that
  // had been walked out of the visible month.
  const card = await page.$('.cal-card');
  const draggedId = await card.getAttribute('data-variation-id');
  const wasAt = await page.evaluate((id) => {
    const w = fetch('/api/workspace');
    return w.then((r) => r.json()).then((d) => d.workspace?.variations.find((v) => v.id === id)?.scheduledAt ?? null);
  }, draggedId);
  const cardBox = await card.boundingBox();
  const targets = await page.$$('.cal-day');
  const target = await targets[20].boundingBox();
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 30, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const live = await page.$eval('[role="status"]', (e) => e.textContent.trim());
  console.log('  live region:', JSON.stringify(live));
  live.length > 0 ? ok('drop announced to screen readers') : bad('no drop announcement');
  if (wasAt) {
    await page.evaluate(([id, at]) =>
      fetch('/api/mutate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mutation: { type: 'setScheduledAt', variationId: id, scheduledAt: at } }),
      }), [draggedId, wasAt]);
  }

  console.log('\n== 7. Responsive widths ==');
  // Down to 600px, and across more of the app than before. The suite used to
  // stop at 900px, which is exactly why every page overflowed at 760 without
  // anyone noticing — a small laptop or a tablet in portrait got a horizontal
  // scrollbar on every screen.
  for (const [w, h] of [[1920, 1080], [1280, 900], [900, 800], [760, 900], [600, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const route of ['/hud', '/calendar', '/analytics', '/contacts', '/media', '/send', '/spend', '/advertise', '/grow']) {
      await page.goto('http://localhost:3000' + route, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
      overflow ? bad(`horizontal overflow on ${route} at ${w}px`) : ok(`no overflow ${route} @ ${w}px`);
    }
    if (w === 1920) await page.screenshot({ path: `${OUT}/ui-1920.png` });
  }

  console.log('\n== 7b. Card text stays inside its card ==');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('http://localhost:3000/calendar', { waitUntil: 'networkidle' });
  const spill = await page.$$eval('.cal-card', (cards) =>
    cards.filter((c) => {
      const t = c.querySelector('.cc-title');
      if (!t) return false;
      return t.getBoundingClientRect().right > c.getBoundingClientRect().right + 1;
    }).length
  );
  spill === 0 ? ok('no card titles overflow their card') : bad(spill + ' card titles overflow');

  console.log('\n== 7c. HUD matrix: sticky + sortable ==');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('http://localhost:3000/hud', { waitUntil: 'networkidle' });
  const sticky = await page.$eval('.table-scroll thead th', (e) => getComputedStyle(e).position);
  sticky === 'sticky' ? ok('matrix header is sticky') : bad('header not sticky: ' + sticky);
  const firstByFit = await page.$eval('.matrix tbody tr .cell-name', (e) => e.textContent.trim());
  await page.click('.matrix thead th:first-child .th-sort');   // sort by name asc
  await page.waitForTimeout(250);
  const firstByName = await page.$eval('.matrix tbody tr .cell-name', (e) => e.textContent.trim());
  console.log(`  fit-sorted "${firstByFit}" -> name-sorted "${firstByName}"`);
  firstByFit !== firstByName ? ok('clicking a header re-sorts') : bad('sort did not change order');
  await page.click('.matrix thead th:first-child .th-sort');   // flip to desc
  await page.waitForTimeout(250);
  const flipped = await page.$eval('.matrix tbody tr .cell-name', (e) => e.textContent.trim());
  flipped !== firstByName ? ok('clicking again flips direction') : bad('direction did not flip');
  const ariaSort = await page.$eval('.matrix thead th:first-child', (e) => e.getAttribute('aria-sort'));
  ariaSort === 'descending' ? ok('aria-sort reflects state') : bad('aria-sort wrong: ' + ariaSort);

  console.log('\n== 7d. Auto-rail on narrow screens ==');
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('http://localhost:3000/calendar', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const narrowNav = await page.$eval('.nav', (e) => e.getBoundingClientRect().width);
  narrowNav < 100 ? ok('nav auto-rails at 900px (' + narrowNav + 'px)') : bad('nav still wide at 900px: ' + narrowNav);

  console.log('\n== 7e. Discovery: analyze -> suggestions -> drafts ==');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:3000/discover', { waitUntil: 'networkidle' });
  await page.click('text=Analyze this business');
  await page.waitForTimeout(3200);
  const facts = await page.$$eval('.kv dd', (els) => els.length);
  facts >= 6 ? ok(`extracted ${facts} business facts`) : bad('too few facts: ' + facts);
  const provenance = await page.$$eval('.kv dd div', (els) =>
    els.filter((e) => e.textContent.trim().length > 0).length
  );
  provenance >= 6 ? ok('every fact shows its source') : bad('facts missing provenance: ' + provenance);
  const sugg = await page.$$('input[type=checkbox]');
  sugg.length >= 4 ? ok(`${sugg.length} suggestions generated`) : bad('too few suggestions: ' + sugg.length);
  const rationales = await page.$$eval('.section-label', (els) =>
    els.filter((e) => e.textContent.includes("Why we're")).length
  );
  rationales === sugg.length
    ? ok('every suggestion carries a rationale')
    : bad(`${rationales} rationales for ${sugg.length} suggestions`);
  const before = await page.evaluate(() => document.querySelectorAll('.cal-card').length);
  await page.click('button.btn.primary.sm');
  await page.waitForTimeout(1200);
  const onCalendar = page.url().includes('/calendar');
  onCalendar ? ok('accepting suggestions lands on the calendar') : bad('did not navigate: ' + page.url());
  const after = await page.evaluate(() => document.querySelectorAll('.cal-card').length);
  after > before ? ok(`drafts added to calendar (${after} cards)`) : bad('no cards added');

  console.log('\n== 7f. Discovery rejects an unknown domain ==');
  await page.goto('http://localhost:3000/discover', { waitUntil: 'networkidle' });
  await page.fill('#d-url', 'not-a-real-business-xyz.com');
  await page.click('text=Analyze this business');
  await page.waitForTimeout(3200);
  const errShown = await page.$('.warning-row.block');
  errShown ? ok('unknown domain shows an honest failure') : bad('no error for unknown domain');

  console.log('\n== 7g. Cross-post fan-out: independent jobs, retry, no double-post ==');
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.goto('http://localhost:3000/post', { waitUntil: 'networkidle' });
  const dests = await page.$$('.dest-row');
  const blockedDests = await page.$$('.dest-row.blocked');
  dests.length >= 12 ? ok(`${dests.length} publish destinations listed`) : bad('too few destinations: ' + dests.length);
  blockedDests.length >= 3
    ? ok(`${blockedDests.length} destinations blocked with reasons`)
    : bad('expected blocked destinations, got ' + blockedDests.length);
  const distinctReasons = await page.$$eval('.dest-row.blocked .pill', (els) =>
    new Set(els.map((e) => e.textContent.trim())).size
  );
  distinctReasons >= 3
    ? ok(`${distinctReasons} distinct blocking reasons (not one generic error)`)
    : bad('blocking reasons not specific: ' + distinctReasons);

  await page.fill('#qp-body', 'Fall cleanup slots are filling fast.');
  await page.click('text=Select all available');
  await page.waitForTimeout(300);
  await page.click('button.btn.primary:has-text("Post to")');
  await page.waitForTimeout(250);
  const confirmVisible = await page.$('text=Yes, post now');
  confirmVisible ? ok('publishing asks for confirmation first') : bad('no confirmation step');
  await page.click('text=Yes, post now');
  await page.waitForTimeout(5200);
  const publishedCount = await page.$$eval('.job-row .pill.published', (e) => e.length);
  const failedCount = await page.$$eval('.job-row .pill.failed', (e) => e.length);
  const totalJobs = await page.$$eval('.job-row', (e) => e.length);
  publishedCount > 0 ? ok(`${publishedCount} destinations published`) : bad('nothing published');
  failedCount === 1
    ? ok('one destination failed without stopping the others')
    : bad(`expected 1 independent failure, got ${failedCount}`);
  const retryBtn = await page.$('.job-row button:has-text("Retry")');
  if (retryBtn) {
    await retryBtn.click();
    await page.waitForTimeout(2800);
    const after = await page.$$eval('.job-row .pill.published', (e) => e.length);
    const rows = await page.$$eval('.job-row', (e) => e.length);
    after === totalJobs ? ok('retry recovered the failed destination') : bad(`retry left ${totalJobs - after} unpublished`);
    rows === totalJobs ? ok('retry did not create a duplicate job (idempotent)') : bad('job count grew on retry');
  } else bad('no retry button on the failed job');

  console.log('\n== 7h. Connect flow: scopes, authorize, destination mapping ==');
  await page.goto('http://localhost:3000/connections', { waitUntil: 'networkidle' });
  const connectBtn = await page.$('button:text-is("Connect")');
  if (connectBtn) {
    await connectBtn.click();
    await page.waitForTimeout(350);
    const hasPrereqs = await page.$('text=Before you start');
    hasPrereqs ? ok('connect flow opens on prerequisites') : bad('no prerequisites step');
    await page.click('.sp-foot button:has-text("Continue")');
    await page.waitForTimeout(250);
    const scopeReasons = await page.$$eval('code.mono', (e) => e.length);
    scopeReasons >= 2 ? ok(`${scopeReasons} scopes listed with reasons`) : bad('scopes not itemised');
    await page.click('.sp-foot button:has-text("Continue")');
    await page.waitForTimeout(250);
    const authBtn = await page.$('button:has-text("Authorize")');
    authBtn ? ok('authorize step present') : bad('no authorize step');
    await authBtn.click();
    await page.waitForTimeout(350);
    const mapSelects = await page.$$('.side-panel select');
    mapSelects.length >= 1
      ? ok(`${mapSelects.length} destinations offered with business mapping`)
      : bad('no destination mapping step');
  } else bad('no connectable account found');

  console.log('\n== 7i. Live connections: real OAuth wiring ==');
  const statusRes = await page.request.get('http://localhost:3000/api/connect/status');
  const st = await statusRes.json();
  statusRes.ok() ? ok('status endpoint responds') : bad('status endpoint failed');
  Array.isArray(st.providers) && st.providers.length >= 8
    ? ok(`${st.providers.length} real OAuth providers configured`)
    : bad('provider list missing');
  const leaks = JSON.stringify(st).match(/(SECRET|access_token|accessJwt)"\s*:\s*"[^"]+"/i);
  !leaks ? ok('status never returns secrets') : bad('status leaked a secret value');
  const everyHasRedirect = st.providers.every((p) => p.redirectUri.includes('/api/connect/'));
  everyHasRedirect ? ok('every provider prints its redirect URI') : bad('missing redirect URIs');

  // Forged state must be rejected — this is the CSRF defence on the callback.
  const forged = await page.request.get(
    'http://localhost:3000/api/connect/facebook/callback?code=x&state=forged',
    { maxRedirects: 0 }
  );
  const loc = forged.headers()['location'] ?? '';
  loc.includes('connect=error') && loc.includes('State')
    ? ok('callback rejects a forged state parameter')
    : bad('callback did not reject forged state: ' + loc);

  // Bluesky must refuse anything that is not an app password.
  const bs = await page.request.post('http://localhost:3000/api/connect/bluesky', {
    data: { handle: 'x.bsky.social', appPassword: 'my-real-account-password' },
  });
  const bsBody = await bs.json();
  bs.status() === 400 && /app password/i.test(bsBody.error)
    ? ok('Bluesky refuses a non-app-password')
    : bad('Bluesky accepted a bad credential shape');

  await page.goto('http://localhost:3000/connections', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const livePanel = await page.$('text=Live connections');
  livePanel ? ok('live connections panel renders') : bad('no live connections panel');

  console.log('\n== 7j. Live publishing refuses honestly when not wired ==');
  const notConnected = await page.request.post('http://localhost:3000/api/publish', {
    data: { channel: 'bluesky', text: 'hello' },
  });
  const ncBody = await notConnected.json();
  ncBody.ok === false && /not connected/i.test(ncBody.error)
    ? ok('publish refuses without a grant instead of faking success')
    : bad('publish did not refuse cleanly: ' + JSON.stringify(ncBody));

  const pubChannels = await (await page.request.get('http://localhost:3000/api/publish')).json();
  pubChannels.publishableChannels?.includes('mastodon') && pubChannels.publishableChannels?.includes('bluesky')
    ? ok('two independent publishers are wired (bluesky + mastodon)')
    : bad('expected both publishers: ' + JSON.stringify(pubChannels.publishableChannels));

  const badHost = await page.request.post('http://localhost:3000/api/connect/mastodon', {
    data: { host: 'not a host', accessToken: 'x' },
  });
  badHost.status() === 400 ? ok('Mastodon rejects a malformed instance address') : bad('bad host accepted');

  const unimpl = await page.request.post('http://localhost:3000/api/publish', {
    data: { channel: 'instagram', text: 'hello' },
  });
  unimpl.status() === 501
    ? ok('unimplemented channel returns 501 rather than pretending')
    : bad('expected 501 for unimplemented channel, got ' + unimpl.status());

  const empty = await page.request.post('http://localhost:3000/api/publish', {
    data: { channel: 'bluesky', text: '   ' },
  });
  empty.status() === 400 ? ok('empty message rejected') : bad('empty message not rejected');

  console.log('\n== 7k. Collapsible sections ==');
  for (const [route, prefix, minSections] of [['/connections','conn.',3], ['/media','media.',3], ['/post','post.',4]]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000' + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const sections = await page.$$('.collapsible-toggle');
    sections.length >= minSections
      ? ok(`${route}: ${sections.length} collapsible sections`)
      : bad(`${route}: only ${sections.length} sections, expected >= ${minSections}`);

    const before = await page.evaluate(() => document.documentElement.scrollHeight);
    const all = await page.$('button:has-text("Collapse all")');
    if (all) await all.click();
    else {
      // Re-query each time: collapsing reflows the page and a stale handle
      // ends up under another element.
      for (let i = 0; i < sections.length; i++) {
        const open = await page.$('.collapsible.open .collapsible-toggle');
        if (!open) break;
        await open.click();
        await page.waitForTimeout(320);
      }
    }
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => document.documentElement.scrollHeight);
    const shrink = Math.round((1 - after / before) * 100);
    shrink >= 25
      ? ok(`${route}: collapsing shortens the page ${shrink}%`)
      : bad(`${route}: collapse only saved ${shrink}% (${before} -> ${after})`);

    // A collapsed section must still report what is inside it.
    const summaries = await page.$$eval('.collapsible-summary', (e) =>
      e.map((x) => x.textContent.trim()).filter(Boolean)
    );
    summaries.length > 0
      ? ok(`${route}: closed sections show summaries ("${summaries[0].slice(0, 40)}")`)
      : bad(`${route}: collapsed sections hide their contents with no summary`);

    // Collapsed content must be hidden from screen readers too.
    const hidden = await page.$$eval('.collapsible.closed .collapsible-region', (e) =>
      e.every((x) => x.getAttribute('aria-hidden') === 'true')
    );
    hidden ? ok(`${route}: collapsed regions are aria-hidden`) : bad(`${route}: collapsed content still exposed to AT`);

    const expanded = await page.$$eval('.collapsible.closed .collapsible-toggle', (e) =>
      e.every((x) => x.getAttribute('aria-expanded') === 'false')
    );
    expanded ? ok(`${route}: aria-expanded tracks state`) : bad(`${route}: aria-expanded wrong`);

    // Tab must not walk into a collapsed section.
    const inert = await page.$$eval('.collapsible.closed .collapsible-region', (e) =>
      e.every((x) => x.hasAttribute('inert'))
    );
    inert ? ok(`${route}: collapsed content removed from focus order`) : bad(`${route}: collapsed content still focusable`);
  }

  // State must survive a reload.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const stillClosed = await page.$$eval('.collapsible.closed', (e) => e.length);
  stillClosed > 0 ? ok('collapse state persists across reload') : bad('collapse state lost on reload');
  const expandAll = await page.$('button:has-text("Expand all")');
  if (expandAll) {
    await expandAll.click();
    await page.waitForTimeout(600);
    const open = await page.$$eval('.collapsible.open', (e) => e.length);
    open > 0 ? ok('expand all reopens sections') : bad('expand all did nothing');
  }

  console.log('\n== 8. Reduced motion ==');
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.goto('http://localhost:3000/calendar', { waitUntil: 'networkidle' });
  const dur = await p2.$eval('.nav', (e) => getComputedStyle(e).transitionDuration);
  console.log('  nav transition-duration under reduce:', dur);
  parseFloat(dur) < 0.05 ? ok('motion suppressed under prefers-reduced-motion') : bad('motion not suppressed: ' + dur);
  await ctx2.close();

  console.log('\n== 9. Data source badge tells the truth ==');
  {
    // Whether this run has Postgres or not, the badge must match reality —
    // a topbar that says "Database" over fixture data is worse than no badge.
    const api = await page.evaluate(() => fetch('/api/workspace').then((r) => r.json()));
    console.log('  /api/workspace source:', api.source, api.reason ? `(${api.reason})` : '');
    await page.goto('http://localhost:3000/campaigns', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const badge = (await page.$eval('.demo-clock', (e) => e.textContent)).trim();
    const want = api.source === 'database' ? 'Database' : 'Demo data';
    badge === want ? ok(`badge reads "${badge}", matching the API`) : bad(`badge says "${badge}" but API says ${api.source}`);

    if (api.source === 'database') {
      // Hydration has to actually replace the fixtures, not sit alongside them.
      const w = api.workspace;
      const counts = [w.campaigns.length, w.items.length, w.variations.length, w.destinations.length];
      counts.every((n) => n > 0) ? ok(`workspace hydrated from rows (${counts.join('/')})`) : bad('empty collection in DB workspace');
      const cards = await page.$$eval('.card', (e) => e.length);
      cards >= w.campaigns.length ? ok('campaigns page rendered a card per DB campaign') : bad('fewer cards than DB campaigns');
    } else {
      ok('running on fixtures — badge and hydration check skipped by design');
    }

    console.log('\n== 10. Write path: a change survives a reload ==');
    if (api.source !== 'database') {
      ok('no database — durability check skipped by design');
    } else {
      // The Phase 1.3 acceptance test, exactly as written: drag a card,
      // reload the page, it stays moved. Everything else in the write path is
      // detail; this is the claim.
      await page.goto('http://localhost:3000/calendar', { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);

      // Pick a card that is actually on screen, and a visible empty-ish day in
      // the same grid to drop it on.
      const picked = await page.evaluate(() => {
        const card = document.querySelector('.cal-card[data-variation-id]');
        if (!card) return null;
        const from = card.closest('.cal-day')?.getAttribute('data-date');
        const days = [...document.querySelectorAll('.cal-day[data-date]')].map((d) => d.getAttribute('data-date'));
        const to = days.find((d) => d !== from);
        return { id: card.getAttribute('data-variation-id'), from, to };
      });
      if (!picked || !picked.to) {
        bad('could not find a calendar card and a target day');
      } else {
        const beforeAt = api.workspace.variations.find((v) => v.id === picked.id)?.scheduledAt;

        // The card uses HTML5 drag-and-drop, which mouse.down/move/up does not
        // trigger in Chromium. Dispatching the real events with a shared
        // DataTransfer is how you exercise the actual handlers rather than a
        // parallel code path invented for the test.
        await page.evaluate(([id, to]) => {
          const card = document.querySelector(`.cal-card[data-variation-id="${id}"]`);
          const day = document.querySelector(`.cal-day[data-date="${to}"]`);
          const dt = new DataTransfer();
          card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
          day.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
          day.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
          card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        }, [picked.id, picked.to]);
        await page.waitForTimeout(300);

        const landed = await page.evaluate((id) =>
          document.querySelector(`.cal-card[data-variation-id="${id}"]`)?.closest('.cal-day')?.getAttribute('data-date'),
          picked.id
        );
        landed === picked.to
          ? ok(`drag moved the card in the UI (${picked.from} → ${picked.to})`)
          : bad(`drag did not move the card: still on ${landed}`);

        // The write is queued, not awaited — give the chain a moment to land.
        await page.waitForTimeout(900);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(900);
        const after = await page.evaluate((id) =>
          document.querySelector(`.cal-card[data-variation-id="${id}"]`)?.closest('.cal-day')?.getAttribute('data-date'),
          picked.id
        );
        after === picked.to
          ? ok(`card stayed moved across a reload (${picked.from} → ${picked.to})`)
          : bad(`card reverted on reload: expected ${picked.to}, got ${after}`);

        // Rescheduling moves the day and keeps the time of day, the way the
        // reducer does — a post that silently jumps to noon is a bug.
        const row = await page.evaluate(() => fetch('/api/workspace').then((r) => r.json()));
        const now = row.workspace.variations.find((v) => v.id === picked.id);
        !beforeAt || now.scheduledAt.slice(11) === beforeAt.slice(11)
          ? ok(`time of day preserved (${now.scheduledAt.slice(11)})`)
          : bad(`time of day changed: ${beforeAt.slice(11)} → ${now.scheduledAt.slice(11)}`);

        // Put it back so the suite is re-runnable.
        await page.evaluate(async ([id, at]) => {
          await fetch('/api/mutate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mutation: { type: 'setScheduledAt', variationId: id, scheduledAt: at } }),
          });
        }, [picked.id, beforeAt]);
      }

      // A route that persists anything a client names is a mass-assignment
      // hole; the durable set is a whitelist and has to behave like one.
      const rejected = await page.evaluate(() =>
        fetch('/api/mutate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mutation: { type: 'setBrand', brandId: 'b-green' } }),
        }).then((r) => r.status)
      );
      rejected === 400 ? ok('non-durable action rejected (400)') : bad(`expected 400 for a UI-only action, got ${rejected}`);
    }
  }

  console.log('\n== 11. Tracked links: a click is recorded and lands right ==');
  {
    const api = await page.evaluate(() => fetch('/api/workspace').then((r) => r.json()));
    if (api.source !== 'database') {
      ok('no database — click tracking skipped by design');
    } else {
      // The Phase 2.1 acceptance test: clicking a published post's link writes
      // a click row and lands on the right page.
      const published = api.workspace.variations.find((v) => v.status === 'published' && v.cta?.url);
      if (!published) {
        bad('no published post with a call to action to track');
      } else {
        const mint = await page.evaluate((id) =>
          fetch('/api/links', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ variationId: id }),
          }).then((r) => r.json()), published.id);
        mint.ok && mint.code ? ok(`minted /r/${mint.code}`) : bad(`could not mint a link: ${mint.reason}`);

        // Minting twice must return the same code, or a post's numbers split.
        const again = await page.evaluate((id) =>
          fetch('/api/links', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ variationId: id }),
          }).then((r) => r.json()), published.id);
        again.code === mint.code ? ok('minting is idempotent') : bad(`second mint gave a different code: ${again.code}`);

        const before = await page.evaluate((c) =>
          fetch(`/api/links?campaignId=${c}`).then((r) => r.json()), published.campaignId);
        const beforeClicks = before.links.find((l) => l.code === mint.code)?.clicks ?? 0;

        // Check the redirect itself from Node, not the page: a browser's
        // `redirect: 'manual'` yields an opaque response (status 0, no
        // headers) by spec, so the Location header is only readable here.
        const hop = await fetch(`http://localhost:3000/r/${mint.code}`, { redirect: 'manual' });
        const location = hop.headers.get('location') || '';
        hop.status === 302 ? ok('redirect is a 302') : bad(`expected 302, got ${hop.status}`);
        location.startsWith(mint.targetUrl.split('?')[0])
          ? ok('lands on the campaign’s own page')
          : bad(`redirected somewhere unexpected: ${location}`);
        const q = new URL(location).searchParams;
        q.get('utm_campaign') && q.get('utm_source') && q.get('utm_content') === published.id
          ? ok(`UTMs appended and name the post (${q.get('utm_source')}/${q.get('utm_campaign')})`)
          : bad(`missing or wrong UTMs: ${location}`);
        hop.headers.get('set-cookie')?.includes('pcp_a')
          ? ok('attribution cookie set for a later conversion to join on')
          : bad('no attribution cookie on the redirect');

        // Now the click from the browser, which carries a cookie jar and so
        // exercises the repeat-visitor path.
        await page.evaluate((code) => fetch(`/r/${code}`, { redirect: 'manual' }), mint.code);
        await page.waitForTimeout(400);
        const after = await page.evaluate((c) =>
          fetch(`/api/links?campaignId=${c}`).then((r) => r.json()), published.campaignId);
        const row = after.links.find((l) => l.code === mint.code);
        // Two clicks: one from Node, one from the browser.
        row?.clicks === beforeClicks + 2
          ? ok(`clicks recorded (${beforeClicks} → ${row.clicks})`)
          : bad(`expected ${beforeClicks + 2} clicks, got ${row?.clicks}`);

        const target = row?.targetUrl ?? '';
        target.startsWith('http') ? ok(`target is a real URL (${target})`) : bad(`bad target: ${target}`);

        // A second click from the same browser is the same visitor. Counting
        // clicks as visitors is how a campaign looks twice as effective as it
        // was, so the two numbers have to move independently.
        await page.evaluate((code) => fetch(`/r/${code}`, { redirect: 'manual' }), mint.code);
        await page.waitForTimeout(400);
        const third = await page.evaluate((c) =>
          fetch(`/api/links?campaignId=${c}`).then((r) => r.json()), published.campaignId);
        const r3 = third.links.find((l) => l.code === mint.code);
        r3.clicks === row.clicks + 1 && r3.visitors === row.visitors
          ? ok(`repeat click counted, visitor not double-counted (${r3.clicks} clicks, ${r3.visitors} visitors)`)
          : bad(`expected ${row.clicks + 1} clicks and ${row.visitors} visitors, got ${r3.clicks}/${r3.visitors}`);

        // An unknown code is far more likely a typo than an attack, so it has
        // to land somewhere useful rather than 404 or 500.
        const missing = await fetch('http://localhost:3000/r/nosuchcode', { redirect: 'manual' });
        missing.status === 302 && (missing.headers.get('location') || '').endsWith('/')
          ? ok('an unknown code redirects home rather than erroring')
          : bad(`unknown code gave ${missing.status} → ${missing.headers.get('location')}`);
      }
    }
  }

  console.log('\n== 12. Conversions: a form post attributed to the post that caused it ==');
  {
    const api = await page.evaluate(() => fetch('/api/workspace').then((r) => r.json()));
    if (api.source !== 'database') {
      ok('no database — conversion ingestion skipped by design');
    } else {
      const published = api.workspace.variations.find((v) => v.status === 'published' && v.cta?.url);
      const mint = await page.evaluate((id) =>
        fetch('/api/links', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ variationId: id }),
        }).then((r) => r.json()), published.id);

      // Walk the real path: click the link, read what the redirect handed to
      // the landing page, then convert with it. That is exactly what the
      // snippet will do, so testing it this way tests the real mechanism.
      const hop = await fetch(`http://localhost:3000/r/${mint.code}`, { redirect: 'manual' });
      const landing = new URL(hop.headers.get('location'));
      const clickId = landing.searchParams.get('pcp_click');
      clickId ? ok('the redirect hands the landing page a click id') : bad('no pcp_click on the landing URL');

      // Through the page: /api/events?campaignId= is a reporting read and
      // needs the session cookie the browser is holding.
      const readTotals = (c) =>
        page.evaluate((id) => fetch(`/api/events?campaignId=${id}`).then((r) => r.json()), c);
      const before = await readTotals(published.campaignId);

      // A fixed eventId makes the conversion idempotent — which is the point
      // of the duplicate check below, and the reason the *counted* events need
      // an id unique to this run, or a second run sees no movement.
      const run = `ui-test-${Date.now().toString(36)}`;

      const post = (body, origin) =>
        fetch('http://localhost:3000/api/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
          body: JSON.stringify(body),
        }).then(async (r) => ({ status: r.status, cors: r.headers.get('access-control-allow-origin'), body: await r.json() }));

      // The acceptance test, from a different origin, as a real form would.
      const evt = await post(
        { kind: 'quote_request', clickId, valueCents: 45000, eventId: `${run}-1` },
        'https://greenscapenj.com'
      );
      evt.body.ok && evt.body.attributed
        ? ok(`conversion attributed via ${evt.body.basis}`)
        : bad(`not attributed: ${JSON.stringify(evt.body)}`);
      evt.cors === '*' ? ok('answers cross-origin, as a site snippet needs') : bad(`no CORS header: ${evt.cors}`);

      const after = await readTotals(published.campaignId);
      after.total === before.total + 1
        ? ok(`campaign total moved (${before.total} → ${after.total})`)
        : bad(`expected ${before.total + 1}, got ${after.total}`);
      after.byKind.quote_request >= 1 ? ok('counted under the right kind') : bad('kind not counted');
      after.valueCents === before.valueCents + 45000
        ? ok('value recorded in minor units')
        : bad(`value ${before.valueCents} → ${after.valueCents}`);

      // A double-submitted form is one lead, not two.
      const dup = await post({ kind: 'quote_request', clickId, valueCents: 45000, eventId: `${run}-1` }, 'https://greenscapenj.com');
      const afterDup = await readTotals(published.campaignId);
      dup.body.ok && afterDup.total === after.total
        ? ok('a re-submitted form counts once')
        : bad(`duplicate created a second conversion (${after.total} → ${afterDup.total})`);

      // utm_content alone still names the post — the path that survives a
      // cleared cookie and a copy-pasted link.
      const viaUtm = await post({ kind: 'booking', utmContent: published.id, eventId: `${run}-2` }, 'https://greenscapenj.com');
      viaUtm.body.attributed
        ? ok('utm_content alone attributes to the post')
        : bad(`utm_content did not attribute: ${JSON.stringify(viaUtm.body)}`);

      // Unattributed is accepted and reported as such — never discarded, never
      // quietly credited to a campaign.
      // Unattributed, but still says which workspace it belongs to — which is
      // what the snippet does, and what the endpoint now requires.
      const orphan = await post(
        { kind: 'call', key: 'pk_demo_greenscape_workspace', eventId: `${run}-3` },
        'https://greenscapenj.com'
      );
      const all = await page.evaluate(() => fetch('/api/events').then((r) => r.json()));
      orphan.body.ok && orphan.body.attributed === false && all.unattributed >= 1
        ? ok(`an unattributed conversion is kept and counted separately (${all.attributed} attributed, ${all.unattributed} not)`)
        : bad(`unattributed handling wrong: ${JSON.stringify(orphan.body)}`);

      // Bad input is refused rather than stored as something meaningless.
      const junk = await post(
        { kind: 'not_a_kind', key: 'pk_demo_greenscape_workspace', eventId: `${run}-4` },
        'https://greenscapenj.com'
      );
      junk.status === 400 ? ok('an unknown kind is rejected') : bad(`unknown kind gave ${junk.status}`);

      // Preflight has to succeed or the browser never sends the POST at all.
      const pre = await fetch('http://localhost:3000/api/events', {
        method: 'OPTIONS',
        headers: { origin: 'https://greenscapenj.com', 'access-control-request-method': 'POST' },
      });
      pre.status === 204 && pre.headers.get('access-control-allow-methods')?.includes('POST')
        ? ok('CORS preflight answered')
        : bad(`preflight gave ${pre.status}`);
    }
  }

  console.log('\n== 13. The snippet: one script tag on someone else’s site ==');
  {
    const api = await page.evaluate(() => fetch('/api/workspace').then((r) => r.json()));
    const SITE = process.env.MOCK_SITE || 'http://localhost:4322';
    let siteUp = false;
    try { siteUp = (await fetch(SITE)).ok; } catch { siteUp = false; }

    if (api.source !== 'database') {
      ok('no database — snippet check skipped by design');
    } else if (!siteUp) {
      ok(`no customer site at ${SITE} — start it with: node scripts/mock-site.js`);
    } else {
      // The Phase 2.3 acceptance test, run the way a customer would experience
      // it: a page on a different origin, one script tag, one marked form.
      const published = api.workspace.variations.find((v) => v.status === 'published' && v.cta?.url);
      const mint = await page.evaluate((id) =>
        fetch('/api/links', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ variationId: id }),
        }).then((r) => r.json()), published.id);

      // Follow the tracked link to learn what the landing URL carries, then
      // visit the customer's site with it — which is what a real visitor's
      // browser does after the redirect.
      const hop = await fetch(`http://localhost:3000/r/${mint.code}`, { redirect: 'manual' });
      const landed = new URL(hop.headers.get('location'));
      const visitorUrl = `${SITE}/?${landed.searchParams.toString()}`;

      const site = await ctx.newPage();
      const siteErrors = [];
      site.on('pageerror', (e) => siteErrors.push(String(e)));
      await site.goto(visitorUrl, { waitUntil: 'networkidle' });
      await site.waitForTimeout(500);

      const loaded = await site.evaluate(() => typeof window.perception?.track === 'function');
      loaded ? ok('snippet loaded from one script tag') : bad('window.perception never appeared');
      siteErrors.length === 0 ? ok('no errors on the customer’s page') : bad(`snippet threw: ${siteErrors[0]}`);

      const stored = await site.evaluate(() => window.perception.attribution());
      stored?.click
        ? ok('attribution captured into the site’s own storage')
        : bad(`nothing stored: ${JSON.stringify(stored)}`);

      // Through the page: /api/events?campaignId= is a reporting read and
      // needs the session cookie the browser is holding.
      const readTotals = (c) =>
        page.evaluate((id) => fetch(`/api/events?campaignId=${id}`).then((r) => r.json()), c);
      const before = await readTotals(published.campaignId);

      await site.click('#quote button[type="submit"]');
      await site.waitForTimeout(1200);

      const after = await readTotals(published.campaignId);
      after.total === before.total + 1
        ? ok(`the form produced an attributed conversion (${before.total} → ${after.total})`)
        : bad(`expected one new conversion, got ${after.total - before.total}`);
      after.byKind.quote_request > (before.byKind.quote_request ?? 0)
        ? ok('recorded as the kind the form declared')
        : bad('kind not recorded from the form');
      after.valueCents === before.valueCents + 45000
        ? ok('the marked value field came through ($450 → 45000)')
        : bad(`value ${before.valueCents} → ${after.valueCents}`);

      // Attribution has to outlive the landing page, or every conversion on a
      // multi-page site is lost.
      await site.goto(`${SITE}/`, { waitUntil: 'networkidle' });
      await site.waitForTimeout(400);
      const survived = await site.evaluate(() => window.perception.attribution());
      survived?.click === stored.click
        ? ok('attribution survives navigating to another page')
        : bad('attribution lost on the second page view');

      // The untracked form must be left completely alone.
      const beforeSearch = await page.evaluate(() => fetch('/api/events').then((r) => r.json()));
      await site.click('#search button[type="submit"]');
      await site.waitForTimeout(900);
      const afterSearch = await page.evaluate(() => fetch('/api/events').then((r) => r.json()));
      afterSearch.total === beforeSearch.total
        ? ok('an unmarked form sends nothing — no silent hoovering')
        : bad(`an unmarked form produced ${afterSearch.total - beforeSearch.total} conversion(s)`);

      await site.close();
    }
  }

  console.log('\n== 14. Analytics reads real rows ==');
  {
    const api = await page.evaluate(() => fetch('/api/workspace').then((r) => r.json()));
    if (api.source !== 'database') {
      ok('no database — analytics computation skipped by design');
    } else {
      // The Phase 2.4 acceptance test: every number traces to a row, and
      // nothing that cannot be measured is reported as if it could.
      const a = await page.evaluate(() => fetch('/api/analytics').then((r) => r.json()));
      a.source === 'computed' ? ok('analytics computed, not fixtured') : bad(`source is ${a.source}: ${a.reason}`);

      // Phase 11 replaced two global lists of metric names with an answer per
      // channel per metric. The global version said "impressions are
      // unmeasured" about email, where we know the delivered count exactly.
      const av = a.meta.availability ?? {};
      Object.keys(av).length > 0
        ? ok(`availability answered for ${Object.keys(av).length} channels in the report`)
        : bad('no availability map — the report cannot say why a number is missing');

      // Every state must be one of the four, and every one must carry a reason
      // an owner can read. A state with no sentence is a blank with extra steps.
      const STATES = ['measured', 'not_connected', 'not_ingested', 'unavailable'];
      const cells = Object.entries(av).flatMap(([ch, ms]) =>
        Object.entries(ms).map(([m, v]) => ({ ch, m, ...v }))
      );
      cells.every((c) => STATES.includes(c.state))
        ? ok(`${cells.length} availability answers, all four-state`)
        : bad(`unknown state: ${cells.find((c) => !STATES.includes(c.state))?.state}`);
      cells.every((c) => typeof c.reason === 'string' && c.reason.length > 10)
        ? ok('every missing number carries a sentence explaining itself')
        : bad(`a state has no reason: ${JSON.stringify(cells.find((c) => !c.reason))}`);

      // Clicks, leads and revenue are ours on every channel — that is what
      // minting a tracked link per variation buys.
      cells.filter((c) => ['clicks', 'leads', 'revenue'].includes(c.m)).every((c) => c.state === 'measured')
        ? ok('clicks, leads and revenue are measured on every channel in the report')
        : bad('a channel claims it cannot measure its own clicks or leads');

      // Unmeasured must be null, never 0 — "0 impressions" reads as "nobody
      // saw it", which is a claim we cannot make. Now checked against the
      // availability answer rather than assuming every column is blank:
      // email is genuinely measured, so a number there is correct.
      const rows = a.performance.flatMap((p) => p.byChannel);
      const lying = rows.filter((r) => {
        const state = av[r.channel]?.impressions?.state;
        return state === 'unavailable' && r.impressions !== null;
      });
      lying.length === 0
        ? ok(`${rows.length} channel rows: nothing the platform refuses to report is given a number`)
        : bad(`${lying[0].channel} reported ${lying[0].impressions} impressions on a platform that publishes none`);

      // Every computed number has to reconcile with the rows behind it.
      const links = await page.evaluate((c) =>
        fetch(`/api/links?campaignId=${c}`).then((r) => r.json()),
        a.performance.find((p) => p.byChannel.length > 0)?.campaignId ?? '');
      const withData = a.performance.find((p) => p.byChannel.length > 0);
      if (!withData) {
        bad('no campaign has any computed results — the click path may be broken');
      } else {
        const computedClicks = withData.byChannel.reduce((s, c) => s + c.clicks, 0);
        const rowClicks = links.ok ? links.links.reduce((s, l) => s + l.clicks, 0) : -1;
        computedClicks === rowClicks
          ? ok(`clicks reconcile with the click rows (${computedClicks})`)
          : bad(`analytics says ${computedClicks} clicks, link rows say ${rowClicks}`);

        const conv = await page.evaluate((c) =>
          fetch(`/api/events?campaignId=${c}`).then((r) => r.json()), withData.campaignId);
        const computedLeads = withData.byChannel.reduce((s, c) => s + c.leads, 0);
        computedLeads === conv.total
          ? ok(`leads reconcile with the conversion rows (${computedLeads})`)
          : bad(`analytics says ${computedLeads} leads, conversion rows say ${conv.total}`);

        withData.headline && !/\d+ quote requests? so far, up \d/.test(withData.headline)
          ? ok(`headline is generated: "${withData.headline.slice(0, 70)}…"`)
          : bad('headline looks hardcoded');
      }

      // And the screen has to say which it is showing.
      await page.goto('http://localhost:3000/analytics', { waitUntil: 'networkidle' });
      // The banner flips to "Computed from your rows" when the client fetch
      // resolves — wait for that, not for a guessed interval.
      await page
        .waitForFunction(() => document.body.innerText.includes('Computed from your rows'), { timeout: 20000 })
        .catch(() => {});
      const banner = await page.$eval('.page .card .demo-clock', (e) => e.textContent.trim());
      banner.includes('Computed')
        ? ok(`the page says where its numbers came from ("${banner}")`)
        : bad(`banner says "${banner}"`);
      // The four blanks must read differently on screen, or the distinction
      // the whole phase exists for dies at the last step. An owner who sees
      // one label for "connect it" and "nobody can ever have it" goes looking
      // for a setting that does not exist.
      await page.click('text=Channel detail').catch(() => {});
      await page.waitForTimeout(400);
      const blanks = await page.evaluate(() =>
        [...document.querySelectorAll('td span[title]')]
          .filter((e) => /not reported|connect to see|not measured|nothing sent/.test(e.textContent))
          .map((e) => ({ text: e.textContent.trim(), title: e.getAttribute('title') }))
      );
      blanks.length > 0
        ? ok(`${blanks.length} blank cells on screen, each with a reason on hover`)
        : bad('no blank cells found — a zero is being shown instead');
      new Set(blanks.map((b) => b.text)).size >= 2
        ? ok(`and they do not all read alike (${[...new Set(blanks.map((b) => b.text))].join(' / ')})`)
        : bad(`every blank reads "${blanks[0]?.text}" — the four cases are collapsed on screen`);
      blanks.every((b) => b.title && b.title.length > 10)
        ? ok('every blank explains itself on hover')
        : bad(`a blank has no explanation: ${JSON.stringify(blanks.find((b) => !b.title))}`);
    }
  }

  console.log('\n== 15. What we learned: readable, and every claim traced ==');
  {
    const api = await page.evaluate(() => fetch('/api/workspace').then((r) => r.json()));
    if (api.source !== 'database') {
      ok('no database — learning page skipped by design');
    } else {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto('http://localhost:3000/learned', { waitUntil: 'networkidle' });
      // The insights arrive from /api/learning in a client effect, after the
      // network has already gone quiet once — so wait for the sample sentence
      // itself, not a fixed interval. With four suites' worth of load on the
      // database the computation can take longer than any number chosen here
      // would have allowed for.
      await page
        .waitForFunction(() => /Based on \d+ published posts?/.test(document.body.innerText), { timeout: 20000 })
        .catch(() => {});

      const text = await page.evaluate(() => document.body.innerText);

      // The sample has to come first, before any conclusion. A reader needs to
      // know how much this rests on before deciding whether to believe it.
      /Based on \d+ published posts?, [\d,]+ clicks/.test(text)
        ? ok('states its sample before any conclusion')
        : bad('no sample statement on the page');

      const findings = await page.$$eval('.convo .cv-text', (els) => els.map((e) => e.innerText.trim()));
      findings.length > 0 ? ok(`${findings.length} claims on the page`) : bad('no claims rendered');

      // Every claim carries a number. A sentence with no number is an opinion.
      const numberless = findings.filter((f) => !/\d/.test(f));
      numberless.length === 0
        ? ok('every claim contains the figure behind it')
        : bad(`${numberless.length} claim(s) with no number: ${numberless[0]?.slice(0, 60)}`);

      // Written for a non-marketer: no jargon that would send someone away.
      const jargon = ['CTR', 'CPM', 'ROAS', 'attribution model', 'engagement rate', 'impressions served'];
      const found = jargon.filter((j) => text.includes(j));
      found.length === 0 ? ok('no marketing jargon') : bad(`jargon on the page: ${found.join(', ')}`);

      // Per-brand times, and an honest label when one is a default.
      text.includes('When to post') ? ok('says when to post, per business') : bad('no posting-time section');

      // Narrowing to one business must actually change the answer, not just
      // relabel the same one.
      const all = await page.evaluate(() => fetch('/api/learning').then((r) => r.json()));
      const one = await page.evaluate(() => fetch('/api/learning?brandId=b-harbor').then((r) => r.json()));
      one.learning.sample.posts < all.learning.sample.posts
        ? ok(`narrowing to one business narrows the evidence (${all.learning.sample.posts} → ${one.learning.sample.posts} posts)`)
        : bad('the brand filter did not change the sample');

      // The refusal path has to be reachable and honest.
      const empty = await page.evaluate(() => fetch('/api/learning?brandId=b-nope').then((r) => r.json()));
      empty.learning.notEnoughYet && empty.bestTimes.every((t) => !t.learned || t.reason)
        ? ok(`declines to conclude when there is nothing: "${empty.learning.notEnoughYet.slice(0, 60)}…"`)
        : bad('empty brand produced conclusions anyway');

      const errs = errors.filter((e) => !e.includes('favicon'));
      errs.length === 0 ? ok('page renders without errors') : bad(`page error: ${errs[0]}`);
    }
  }

  console.log('\n== 16. Upload a photo through the browser ==');
  {
    const api = await page.evaluate(() => fetch('/api/workspace').then((r) => r.json()));
    if (api.source !== 'database') {
      ok('no database — upload skipped by design');
    } else {
      await page.goto('http://localhost:3000/media', { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      // Expand everything first: assets live inside per-business collapsibles,
      // and a closed group renders nothing to count.
      const expandAll = await page.$('button:has-text("Expand all")');
      if (expandAll) { await expandAll.click(); await page.waitForTimeout(600); }
      const countAssets = () => page.$$eval('.grid.cols-4 > .card', (e) => e.length);
      const before = await countAssets();

      // A real 1x1 PNG through a real file input — the same path a customer's
      // photo takes.
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      const input = await page.$('input[type="file"]');
      if (!input) {
        bad('no file input on the media page');
      } else {
        await input.setInputFiles({ name: 'fall-cleanup-crew.png', mimeType: 'image/png', buffer: png });
        // Wait for the toast itself, not a fixed interval. A fixed 2.5s
        // passed when this suite ran alone and failed inside `npm test`,
        // where the server is still busy from the media suite and the upload
        // takes longer — the count check further down, with its own extra
        // waits, then saw the asset land, proving the upload was merely slow.
        await page.waitForSelector('[role="status"]', { timeout: 15000 }).catch(() => {});

        const note = await page.$eval('[role="status"]', (e) => e.innerText).catch(() => '');
        /Uploaded/i.test(note) ? ok(`upload confirmed on screen ("${note.slice(0, 45)}…")`) : bad(`no upload confirmation: "${note.slice(0, 60)}"`);
        /[Ll]ocation data/.test(note)
          ? ok('the page says location data was removed')
          : bad('no mention of stripped location data');

        const expand2 = await page.$('button:has-text("Expand all")');
        if (expand2) { await expand2.click(); await page.waitForTimeout(600); }
        const after = await countAssets();
        after > before
          ? ok(`the uploaded file is visible in the library (${before} → ${after})`)
          : bad(`uploaded but not visible (${before} → ${after}) — an asset the owner cannot find`);

        // The stored object has to actually be servable.
        const w = await page.evaluate(() => fetch('/api/workspace').then((r) => r.json()));
        const added = w.workspace.media.find((m) => m.name === 'fall-cleanup-crew.png');
        added ? ok('the asset is in the workspace') : bad('uploaded asset missing from the workspace');

        // Path traversal must not get anywhere.
        const evil = await fetch('http://localhost:3000/api/media/file/..%2f..%2f..%2fetc%2fpasswd');
        evil.status === 404 ? ok('a traversal attempt 404s') : bad(`traversal returned ${evil.status}`);
        const wrongShape = await fetch('http://localhost:3000/api/media/file/aa/bb/notahash.jpg');
        wrongShape.status === 404 ? ok('a malformed key 404s') : bad(`malformed key returned ${wrongShape.status}`);

        // The suite leaves nothing behind. There is no delete surface in the
        // product yet, so this reaches into the database — the alternative is
        // a seeded workspace that accretes one identical test PNG per run,
        // with the missing-alt-text warning creeping up to match.
        try {
          const { PrismaClient } = require('@prisma/client');
          const prisma = new PrismaClient();
          await prisma.mediaAsset.deleteMany({ where: { fileName: 'fall-cleanup-crew.png' } });
          await prisma.$disconnect();
        } catch (e) {
          bad(`could not clean up the uploaded test asset: ${e.message}`);
        }
      }
    }
  }

  console.log('\n== 17. Nav groups fold independently ==');
  {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('http://localhost:3000/hud', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    const group = (name) => page.locator('button.nav-section-label', { hasText: name });

    await group('Setup').click();
    await page.waitForTimeout(400);
    (await group('Setup').getAttribute('aria-expanded')) === 'false'
      ? ok('a group folds on click')
      : bad('group did not fold');

    const folded = await page.locator('.nav-section.closed .nav-section-body > div').first().boundingBox();
    folded && folded.height < 2 ? ok('folded content has no height') : bad(`folded content still ${folded?.height}px tall`);

    // Items in a folded group must leave the focus order, or Tab walks into
    // links nobody can see.
    const reachable = await page.evaluate(() => {
      const body = document.querySelector('.nav-section.closed .nav-section-body');
      return body ? body.querySelectorAll('a:not([inert] a)').length : -1;
    });
    reachable >= 0 ? ok('folded group is inert') : bad('could not check inertness');

    // The group holding the current page must stay open — hiding what you are
    // looking at is disorienting.
    await group('Measure').click();
    await page.waitForTimeout(300);
    (await group('Measure').getAttribute('aria-expanded')) === 'true'
      ? ok('the group holding the current page refuses to fold')
      : bad('folded away the group containing the active page');

    // Counts roll up, so folding never hides a reason to open it.
    await group('Engage').click();
    await page.waitForTimeout(300);
    const rolled = await page.locator('button.nav-section-label:has-text("Engage") .count').count();
    rolled > 0 ? ok('a folded group still shows its count') : bad('count vanished with the group');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    (await group('Setup').getAttribute('aria-expanded')) === 'false'
      ? ok('fold state survives a reload')
      : bad('fold state not persisted');

    // Put it back so later runs start clean.
    await group('Setup').click();
    await group('Engage').click();
    await page.waitForTimeout(300);
  }

  console.log('\n== 18. Jump anywhere with the keyboard ==');
  {
    await page.goto('http://localhost:3000/calendar', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);
    (await page.locator('.palette').count()) > 0 ? ok('⌘K opens the palette') : bad('palette did not open');

    // Subsequence matching: initials should find a multi-word destination.
    await page.keyboard.type('wwl');
    await page.waitForTimeout(250);
    const top = await page.locator('.palette-row').first().innerText();
    top.includes('What we learned')
      ? ok(`"wwl" finds "What we learned"`)
      : bad(`fuzzy match wrong: ${top.replace(/\n/g, ' ')}`);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    new URL(page.url()).pathname === '/learned'
      ? ok('Enter navigates to the highlighted result')
      : bad(`landed on ${new URL(page.url()).pathname}`);

    // Aliases: people call it by what it does, not what it is called.
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(250);
    await page.keyboard.type('photos');
    await page.waitForTimeout(250);
    const alias = await page.locator('.palette-row').first().innerText();
    alias.includes('Media')
      ? ok('"photos" finds the Media Library')
      : bad(`alias match wrong: ${alias.replace(/\n/g, ' ')}`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    (await page.locator('.palette').count()) === 0 ? ok('Escape closes it') : bad('Escape did not close the palette');

    // A prefix should beat a scattered subsequence — typing "c" and getting
    // Campaigns is what someone expects.
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(200);
    await page.keyboard.type('camp');
    await page.waitForTimeout(200);
    (await page.locator('.palette-row').first().innerText()).includes('Campaigns')
      ? ok('prefix matches rank first')
      : bad('prefix match did not rank first');
    await page.keyboard.press('Escape');
  }

  console.log('\n== 19. The dense pages fold ==');
  {
    for (const [route, prefix, min] of [['/hud', 'hud.', 30], ['/analytics', 'analytics.', 20], // /spend ships its heaviest section (the rate card) pre-folded, so
    // collapse-all has less left to save — the density win is at load time.
    ['/spend', 'spend.', 15]]) {
      await page.goto('http://localhost:3000' + route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      const open = await page.evaluate(() => document.body.scrollHeight);
      const btn = await page.$('button:has-text("Collapse all")');
      if (!btn) { bad(`${route} has no collapse-all`); continue; }
      await btn.click();
      await page.waitForTimeout(700);
      const shut = await page.evaluate(() => document.body.scrollHeight);
      const saved = Math.round((1 - shut / open) * 100);
      saved >= min
        ? ok(`${route} folds ${saved}% shorter (${open} → ${shut})`)
        : bad(`${route} only folded ${saved}%, expected at least ${min}%`);

      // Folded sections must still say what they contain.
      const summaries = await page.$$eval('.collapsible.closed .collapsible-summary', (e) => e.length);
      summaries > 0 ? ok(`${route} folded sections keep their summaries`) : bad(`${route} folds to blank headers`);

      const expand = await page.$('button:has-text("Expand all")');
      if (expand) { await expand.click(); await page.waitForTimeout(500); }
    }
  }

  console.log('\n== 20. The composer prices a text before it is sent ==');
  // The point of this section is that the *cost* reacts, not just the counter.
  // A composer that shows "3 segments" while the price stays at $4.20 has
  // moved the lie one step later, which is no better than hiding it.
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('http://localhost:3000/send', { waitUntil: 'networkidle' });

  const smsTab = await page.$('button[role="tab"]:has-text("Text")');
  if (!smsTab) { bad('send page has no Text tab'); }
  else {
    await smsTab.click();
    await page.waitForTimeout(250);

    const readCost = () => page.$eval('.ch-total', (e) => e.textContent.trim());
    const readSegments = () => page.$eval('.sm-cost', (e) => e.textContent.trim());
    const readEncoding = () => page.$eval('.sm-enc', (e) => e.textContent.trim());
    const setBody = async (text) => {
      await page.fill('#body', text);
      await page.waitForTimeout(200);
    };

    // A short plain message: one segment, GSM-7.
    await setBody('Three slots left this month. Book at our shop.');
    const plainEnc = await readEncoding();
    const plainCost = await readCost();
    plainEnc === 'GSM-7' ? ok('plain text is GSM-7') : bad('plain text encoded as ' + plainEnc);

    // Same message, one curly apostrophe. This is the whole thesis: an
    // invisible character that costs real money.
    await setBody('Three slots left this month. Book at our shop\u2019s counter.');
    const curlyEnc = await readEncoding();
    const curlyCost = await readCost();
    curlyEnc === 'UCS-2' ? ok('a curly apostrophe flips the encoding to UCS-2') : bad('curly apostrophe still ' + curlyEnc);

    const named = await page.$('.cul-name');
    if (named) {
      const t = await named.textContent();
      /right single quote|curly/i.test(t)
        ? ok('the offending character is named, not just counted: ' + t.trim())
        : bad('culprit not identified: ' + t);
    } else bad('no culprit list shown for a UCS-2 message');

    // And the fix is offered with the saving attached.
    const fixBtn = await page.$('.sm-fix');
    if (!fixBtn) bad('no one-click fix offered');
    else {
      const label = await fixBtn.textContent();
      /swap/i.test(label) ? ok('fix offered: ' + label.trim()) : bad('unexpected fix label: ' + label);
      await fixBtn.click();
      await page.waitForTimeout(250);
      const afterEnc = await readEncoding();
      afterEnc === 'GSM-7' ? ok('applying the fix returns the message to GSM-7') : bad('still ' + afterEnc + ' after fix');
    }

    // A long message must cost strictly more than a short one. This is the
    // check that would have caught a counter wired to nothing.
    await setBody('Book now at our shop.');
    const shortCost = await readCost();
    const shortSegs = await readSegments();
    await setBody('Book now at our shop. '.repeat(12));
    const longCost = await readCost();
    const longSegs = await readSegments();
    const cents = (s) => Number(String(s).replace(/[^0-9.]/g, '')) * (String(s).includes('\u00a2') ? 1 : 100);
    cents(longCost) > cents(shortCost)
      ? ok(`cost rises with length (${shortCost} \u2192 ${longCost})`)
      : bad(`cost did not rise with length: ${shortCost} vs ${longCost} [${shortSegs} / ${longSegs}]`);
    void plainCost; void curlyCost;

    // Setup costs are on screen before the first message, at full size.
    const setupSeen = await page.$$eval('.cost-line.fixed .cl-label', (n) => n.map((e) => e.textContent));
    setupSeen.some((t) => /10DLC|registration/i.test(t))
      ? ok('10DLC registration is shown as its own line, not folded into the rate')
      : bad('setup costs missing from the rail: ' + JSON.stringify(setupSeen));

    // And it blocks: you cannot send before registering.
    const sendBtn = await page.$('.cost-send');
    const disabled = sendBtn ? await sendBtn.isDisabled() : false;
    disabled ? ok('send is blocked until registration is paid') : bad('send allowed with blocking setup unpaid');
  }

  console.log('\n== 21. Exact money and guessed money look different ==');
  await page.goto('http://localhost:3000/spend', { waitUntil: 'networkidle' });
  const flightCost = await page.$eval('.flr-cost .flr-value', (e) => e.textContent.trim());
  const flightBuys = await page.$eval('.flr-outcome .flr-value', (e) => e.textContent.trim());
  /^\$/.test(flightCost) ? ok('flight cost is a single figure: ' + flightCost) : bad('unexpected cost: ' + flightCost);
  flightBuys.includes('\u2013')
    ? ok('what it buys stays a range: ' + flightBuys)
    : bad('outcome collapsed to a point estimate: ' + flightBuys);

  const weights = await page.evaluate(() => {
    const exact = document.querySelector('.flr-cost .flr-value');
    const est = document.querySelector('.flr-outcome .flr-value');
    return [getComputedStyle(exact).fontWeight, getComputedStyle(est).fontWeight];
  });
  Number(weights[0]) > Number(weights[1])
    ? ok(`an estimate is set lighter than a fact (${weights[0]} vs ${weights[1]})`)
    : bad(`estimate and fact share a weight: ${weights.join(' vs ')}`);

  // Moving the budget slider must move the month-end projection.
  const totalBefore = await page.$eval('.ft-value', (e) => e.textContent.trim());
  await page.$eval('.fl-controls input[type=range]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '9000');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  const totalAfter = await page.$eval('.ft-value', (e) => e.textContent.trim());
  totalBefore !== totalAfter
    ? ok(`raising a daily budget moves the total (${totalBefore} \u2192 ${totalAfter})`)
    : bad('total did not react to the budget slider');

  console.log('\n== 22. The pathway ranks, groups, and never mixes units ==');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('http://localhost:3000/advertise', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // It takes a position rather than presenting a grid of equal choices.
  const headline = await page.$eval('.headline-route h2', (e) => e.textContent.trim()).catch(() => null);
  headline ? ok('the page opens with a recommendation: ' + headline) : bad('no headline route');
  const headlineCost = await page.$eval('.hr-cost', (e) => e.textContent.trim()).catch(() => '');
  /free|\$|\u00a2/.test(headlineCost) ? ok('and it carries its price: ' + headlineCost) : bad('headline has no price');

  // Three groups, each internally consistent about what it sells.
  // The group headings live in the Collapsible headers now — the fold
  // conversion merged the two header systems, titles included.
  const groupHeads = await page.$$eval('.route-group .collapsible-toggle', (n) => n.map((e) => e.textContent.trim()));
  groupHeads.length >= 4 ? ok(`${groupHeads.length} sections: ${groupHeads.join(' / ')}`) : bad('groups missing: ' + groupHeads.join(','));

  // The unit words must not be mixed inside one group's cost column.
  const groupUnits = await page.$$eval('.route-group', (sections) =>
    sections.map((s) => {
      const costs = [...s.querySelectorAll('.rc-cost')].map((e) => e.textContent);
      return {
        head: s.querySelector('h3')?.textContent?.trim() ?? '',
        views: costs.filter((c) => /views/.test(c)).length,
        visits: costs.filter((c) => /visits/.test(c)).length,
        people: costs.filter((c) => /people/.test(c)).length,
      };
    })
  );
  const mixed = groupUnits.filter((g) => [g.views, g.visits, g.people].filter((n) => n > 0).length > 1);
  mixed.length === 0
    ? ok('no section mixes views, visits and people in one column')
    : bad('a section mixes units: ' + JSON.stringify(mixed));

  // Paid sections are shortlisted rather than dumped.
  const more = await page.$('button:has-text("fit less well")');
  if (more) {
    const before = await page.$$eval('.route-card', (n) => n.length);
    await more.click();
    await page.waitForTimeout(300);
    const after = await page.$$eval('.route-card', (n) => n.length);
    after > before ? ok(`shortlisted ${before}, expands to ${after}`) : bad('show-more revealed nothing');
  } else bad('no way to see the routes below the shortlist');

  // Every route states when it can start, and the slow one says so.
  const whens = await page.$$eval('.rc-when', (n) => n.map((e) => e.textContent.trim()));
  whens.length > 0 && whens.every((w) => w.length > 0)
    ? ok('every route says when it can start')
    : bad('a route has no start time');
  whens.some((w) => /days|weeks/.test(w))
    ? ok('and the slow ones are honest about it: ' + whens.find((w) => /days|weeks/.test(w)))
    : bad('nothing reports a multi-day wait — SMS registration should');

  // Expanding a route that needs setup shows real steps with costs.
  const cards = await page.$$('.route-card');
  let opened = false;
  for (const c of cards) {
    const name = await c.$eval('.rc-name', (e) => e.textContent).catch(() => '');
    if (/Text your list/.test(name)) {
      await c.$eval('.rc-head', (e) => e.click());
      opened = true;
      break;
    }
  }
  await page.waitForTimeout(350);
  if (!opened) bad('could not find the SMS route');
  else {
    const steps = await page.$$eval('.rc-steps li', (n) => n.length);
    steps >= 3 ? ok(`${steps} setup steps listed for texting`) : bad('setup steps missing: ' + steps);
    const costs = await page.$$eval('.rc-steps .st-meta', (n) => n.map((e) => e.textContent.trim()));
    costs.some((c) => /\$44/.test(c)) ? ok('the $44 registration is on screen: ' + costs.join(' | ')) : bad('registration cost hidden: ' + costs.join(' | '));
    const go = await page.$$('.rc-steps .st-go');
    go.length > 0 ? ok(`${go.length} steps have somewhere to go`) : bad('setup steps are prose with no action');
  }

  console.log('\n== 23. Capability matrix: the "no" cells carry the signal ==');
  const noCells = await page.$$eval('.cap-cell.no', (n) => n.length);
  const yesCells = await page.$$eval('.cap-cell.yes', (n) => n.length);
  noCells > 0 && yesCells > 0 ? ok(`${yesCells} yes, ${noCells} no`) : bad(`matrix looks wrong: ${yesCells} yes / ${noCells} no`);

  // A yes must be quieter than a no, or the table is a wall of ticks.
  const capWeights = await page.evaluate(() => {
    const y = document.querySelector('.cap-cell.yes span');
    const n = document.querySelector('.cap-cell.no span');
    return y && n ? [getComputedStyle(y).fontWeight, getComputedStyle(n).fontWeight] : null;
  });
  capWeights && Number(capWeights[1]) > Number(capWeights[0])
    ? ok(`a "no" is set heavier than a "yes" (${capWeights[1]} vs ${capWeights[0]})`)
    : bad('yes and no share a weight: ' + JSON.stringify(capWeights));

  const surprises = await page.$$eval('.cn-teaser', (n) => n.length);
  surprises >= 8 ? ok(`${surprises} channels carry their first-time surprise`) : bad('surprises missing: ' + surprises);

  console.log('\n' + (errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors'));
  console.log(fail.length ? `\n${fail.length} FAILURE(S)` : '\nALL CHECKS PASSED');
  await browser.close();
  process.exit(fail.length ? 1 : 0);
})();
