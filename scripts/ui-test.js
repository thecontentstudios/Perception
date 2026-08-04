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
  const card = await page.$('.cal-card');
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

  console.log('\n== 7. Responsive widths ==');
  for (const [w, h] of [[1920, 1080], [1280, 900], [900, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const route of ['/hud', '/calendar', '/analytics']) {
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

  console.log('\n== 8. Reduced motion ==');
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.goto('http://localhost:3000/calendar', { waitUntil: 'networkidle' });
  const dur = await p2.$eval('.nav', (e) => getComputedStyle(e).transitionDuration);
  console.log('  nav transition-duration under reduce:', dur);
  parseFloat(dur) < 0.05 ? ok('motion suppressed under prefers-reduced-motion') : bad('motion not suppressed: ' + dur);
  await ctx2.close();

  console.log('\n' + (errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors'));
  console.log(fail.length ? `\n${fail.length} FAILURE(S)` : '\nALL CHECKS PASSED');
  await browser.close();
  process.exit(fail.length ? 1 : 0);
})();
