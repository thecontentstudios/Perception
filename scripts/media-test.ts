/**
 * Phase 4 acceptance tests: upload, renditions, and fixes.
 *
 *   npm run test:media
 *
 * Real files through the real pipeline. Sharp actually encodes, ffmpeg
 * actually cuts, and the assertions read the bytes back out — because the one
 * thing that must not be assumed here is that an image processing library did
 * what its documentation says.
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { db } from '../src/lib/db';
import { ingest } from '../src/lib/media/ingest';
import { storage, isSafeKey } from '../src/lib/storage';
import { cropImage, ratioDistance, targetFor, maxDurationFor } from '../src/lib/media/renditions';
import { trimVideo } from '../src/lib/media/renditions';
import { ffmpegAvailable, probe } from '../src/lib/media/video';
import { remediate, trimToWords } from '../src/lib/remediate';
import { suggestAltText } from '../src/lib/media/alt-text';

const run = promisify(execFile);
let failures = 0;
const ok = (m: string) => console.log('  PASS ' + m);
const bad = (m: string) => { failures++; console.log('  FAIL ' + m); };
const eq = (a: unknown, b: unknown, m: string) =>
  JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'perception-media-test-'));
  process.env.MEDIA_ROOT ||= join(dir, 'store');

  console.log('\n== 4.1 Upload: EXIF stripped, orientation kept ==');
  {
    // A landscape photo with GPS coordinates and an orientation tag that says
    // "rotate 90°" — exactly the shape of a phone photo taken in portrait.
    const base = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 30, g: 120, b: 60 } },
    }).jpeg().toBuffer();

    const withExif = await sharp(base)
      .withMetadata({
        orientation: 6, // 90° clockwise — the tag does the rotating
        // GPS is the field that actually matters here — it is a customer's
        // home address. sharp's types don't declare the GPS IFD, but it writes
        // it, which is exactly the point being tested.
        exif: {
          IFD0: { Copyright: 'GreenScape' },
          GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'W' },
        } as unknown as sharp.Exif,
      })
      .jpeg()
      .toBuffer();

    const before = await sharp(withExif).metadata();
    before.exif ? ok('test fixture really carries EXIF') : bad('fixture has no EXIF — the test proves nothing');
    eq(before.orientation, 6, 'fixture carries an orientation tag');

    const result = await ingest(withExif, 'job-photo.jpg', 'image/jpeg');
    const stored = await storage().get(result.key);
    const after = await sharp(stored).metadata();

    !after.exif ? ok('EXIF removed — no GPS coordinates published') : bad('EXIF survived the upload');
    result.strippedFields.some((f) => f.includes('location'))
      ? ok('the upload reports what it removed')
      : bad(`stripped fields not reported: ${result.strippedFields}`);

    // The subtlety: with orientation 6 the pixels must come out rotated, so
    // the 400×200 fixture becomes 200×400. If it is still 400×200 the tag was
    // dropped without being applied, and every phone photo would be sideways.
    after.width === 200 && after.height === 400
      ? ok(`orientation applied to the pixels before the tag was dropped (${after.width}×${after.height})`)
      : bad(`orientation not applied — stored ${after.width}×${after.height}, expected 200×400`);
    (after.orientation ?? 1) === 1
      ? ok('no orientation tag left to double-rotate')
      : bad(`orientation tag survived: ${after.orientation}`);

    isSafeKey(result.key) ? ok(`key is content-addressed (${result.key.slice(0, 20)}…)`) : bad(`unsafe key: ${result.key}`);

    // Same bytes, same key — uploading twice must not cost twice.
    const again = await ingest(withExif, 'job-photo.jpg', 'image/jpeg');
    again.key === result.key ? ok('re-uploading the same photo dedupes') : bad('duplicate upload produced a second object');

    // Oversized input is resized rather than stored at full resolution.
    const huge = await sharp({ create: { width: 5000, height: 3000, channels: 3, background: { r: 1, g: 1, b: 1 } } }).jpeg().toBuffer();
    const shrunk = await ingest(huge, 'huge.jpg', 'image/jpeg');
    (shrunk.width ?? 0) <= 2400 ? ok(`oversized photo resized to ${shrunk.width}px`) : bad(`stored at ${shrunk.width}px`);

    // Non-images must be refused with a message, not a stack trace.
    try {
      await ingest(Buffer.from('not an image at all'), 'notes.txt', 'text/plain');
      bad('a text file was accepted');
    } catch (e) {
      /can't use|images and mp4/i.test((e as Error).message)
        ? ok(`unsupported type refused clearly: "${(e as Error).message.slice(0, 50)}…"`)
        : bad(`unhelpful refusal: ${(e as Error).message}`);
    }
    // A file that lies about its type must be caught by its bytes.
    try {
      await ingest(Buffer.from('still not an image'), 'fake.jpg', 'image/jpeg');
      bad('a text file claiming to be a JPEG was accepted');
    } catch (e) {
      ok(`a mislabelled file is caught by its bytes: "${(e as Error).message.slice(0, 45)}…"`);
    }
  }

  console.log('\n== 4.2 Renditions: one upload, every shape ==');
  {
    // 1200×600 — 2:1, which no platform wants.
    const wide = await sharp({ create: { width: 1200, height: 600, channels: 3, background: { r: 80, g: 60, b: 140 } } })
      .jpeg().toBuffer();
    const src = await ingest(wide, 'wide-shot.jpg', 'image/jpeg');

    for (const ratio of ['1:1', '4:5', '9:16', '2:3'] as const) {
      const r = await cropImage(src.key, ratio);
      const d = ratioDistance(r.width, r.height, ratio);
      d < 0.02
        ? ok(`${ratio} rendition is actually ${ratio} (${r.width}×${r.height})`)
        : bad(`${ratio} rendition is ${r.width}×${r.height}, off by ${(d * 100).toFixed(1)}%`);
    }

    // The original must survive every crop.
    const original = await sharp(await storage().get(src.key)).metadata();
    original.width === 1200 && original.height === 600
      ? ok('the original is untouched after four crops')
      : bad(`original changed to ${original.width}×${original.height}`);

    // The capability sheet has to actually know what each destination wants.
    eq(targetFor('instagram', 'reel'), '9:16', 'Instagram Reels wants 9:16');
    eq(targetFor('instagram', 'post'), '4:5', 'Instagram feed wants 4:5');
    eq(targetFor('pinterest', 'pin'), '2:3', 'Pinterest wants 2:3');
    eq(maxDurationFor('instagram', 'reel'), 90, 'Reels caps at 90s');
  }

  console.log('\n== 4.3 Fix it for me ==');
  {
    // Caption trimming cuts at a word, never mid-word.
    const text = 'Fall cleanup slots are booking up fast for the season ahead';
    const cut = trimToWords(text, 30);
    cut.length <= 30 ? ok(`caption trimmed to ${cut.length} characters`) : bad(`trim overshot: ${cut.length}`);
    !text.slice(cut.length).startsWith('') || /\s|^$/.test(text[cut.length] ?? ' ')
      ? ok(`cut at a word boundary: "${cut}"`)
      : bad(`cut mid-word: "${cut}"`);
    eq(trimToWords('short', 30), 'short', 'text under the limit is returned unchanged');
    trimToWords('supercalifragilistic', 8).length === 8
      ? ok('a single long word still gets cut rather than vanishing')
      : bad('long single word handled wrong');

    // The remedy list is a set of decisions about what is safe to automate.
    const asset = {
      id: 'm-1', kind: 'video' as const, name: 'walkthrough.mp4', gradient: ['#000', '#111'] as [string, string],
      glyph: '🎬', altText: null, durationSec: 118, aspectRatio: '16:9' as const, tags: [],
      brandId: 'b-green', uploadedAt: '2026-09-01', sizeKB: 4000,
    };
    const warnings = [
      { id: 'video-too-long', severity: 'block' as const, message: 'This video is too long (118s, limit 90s).', fix: 'Trim it.' },
      { id: 'missing-alt', severity: 'warn' as const, message: 'Missing alternative text.', fix: 'Describe it.' },
      { id: 'not-connected', severity: 'block' as const, message: 'Not connected.', fix: 'Connect.' },
    ];
    const out = remediate(warnings, {
      variation: { body: 'x', hashtags: [], scheduledAt: '2026-10-01T09:00' } as never,
      assets: [asset],
      caps: { maxChars: null, maxHashtags: null, maxVideoSec: 90, allowedRatios: null },
      campaignCta: { label: 'Book now', url: 'https://example.com' },
      today: '2026-10-08',
    });

    const trimW = out.find((w) => w.id === 'video-too-long');
    trimW?.remedy?.kind === 'trim_video' ? ok('the 118s-on-Reels warning offers a trim') : bad('no trim offered');
    trimW?.remedy?.explains.includes('28')
      ? ok(`it says exactly what is lost: "${trimW.remedy!.explains}"`)
      : bad(`the explanation does not name the dropped seconds: ${trimW?.remedy?.explains}`);
    trimW?.remedy?.cost ? ok('and states the cost before applying') : bad('no cost stated');

    out.find((w) => w.id === 'missing-alt')?.remedy === null
      ? ok('missing alt text offers no button — we cannot see the image')
      : bad('offered to write alt text it cannot know');
    out.find((w) => w.id === 'not-connected')?.remedy === null
      ? ok('a missing connection offers no button — only the owner can authorize')
      : bad('offered to fix an authorization');
  }

  console.log('\n== 4.3 Fix it for real: trimming an actual video ==');
  if (!(await ffmpegAvailable())) {
    console.log('  SKIP ffmpeg not installed');
  } else {
    // Six seconds of test pattern, trimmed to two.
    const vdir = await mkdtemp(join(tmpdir(), 'perception-vid-'));
    const path = join(vdir, 'src.mp4');
    await run('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15:duration=6',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path,
    ]);
    const src = await ingest(await readFile(path), 'clip.mp4', 'video/mp4');
    src.durationSec === 6 ? ok(`probed the source at ${src.durationSec}s`) : bad(`probed ${src.durationSec}s, expected 6`);

    const trimmed = await trimVideo(src.key, 2);
    trimmed.durationSec === 2
      ? ok(`trimmed to ${trimmed.durationSec}s — read back from the file, not assumed`)
      : bad(`trim produced ${trimmed.durationSec}s`);
    trimmed.key !== src.key ? ok('the trim is a new object') : bad('the trim overwrote the original');

    const stillThere = await probe(src.key);
    stillThere.durationSec === 6 ? ok('the original video is still 6s') : bad('the original was modified');
    await rm(vdir, { recursive: true, force: true });
  }

  console.log('\n== 4.4 Alt text: suggested, never assumed ==');
  {
    const good = suggestAltText('fall-cleanup_before-after.jpg', { kind: 'image', width: 800, height: 1000, durationSec: null });
    good.text.includes('fall cleanup before after')
      ? ok(`a descriptive filename becomes a draft: "${good.text}"`)
      : bad(`unhelpful suggestion: ${good.text}`);
    good.note.includes('not from looking')
      ? ok('the note admits it never saw the image')
      : bad('the note oversells what this knows');

    const noisy = suggestAltText('IMG_4821.jpg', { kind: 'image', width: 800, height: 600, durationSec: null });
    noisy.text === ''
      ? ok('a meaningless filename produces no suggestion rather than a fake one')
      : bad(`invented a description from nothing: "${noisy.text}"`);
    noisy.note.length > 20 ? ok('and asks the owner for one instead') : bad('no prompt to write it');

    const vid = suggestAltText('site-walkthrough.mp4', { kind: 'video', width: 1080, height: 1920, durationSec: 30 });
    vid.text.startsWith('Video of') ? ok('videos are described as videos') : bad(`wrong noun: ${vid.text}`);
    vid.text.includes('upright') ? ok('and the shape is mentioned when it is distinctive') : bad('shape not noted');
  }

  console.log('\n== 4.3 End to end: an over-long video on a real post ==');
  if (!(await ffmpegAvailable())) {
    console.log('  SKIP ffmpeg not installed');
  } else if (!process.env.DATABASE_URL) {
    console.log('  SKIP no DATABASE_URL');
  } else {
    // The acceptance test as written in the plan, against real rows: a video
    // that is too long for Reels, on a real post, fixed through the same route
    // the button calls.
    const { ORG } = await import('../src/lib/demo-data');
    const vdir = await mkdtemp(join(tmpdir(), 'perception-e2e-'));
    const path = join(vdir, 'long.mp4');
    await run('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=8',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path,
    ]);
    const src = await ingest(await readFile(path), 'walkthrough.mp4', 'video/mp4');

    const item = await db.contentItem.findFirst();
    const asset = await db.mediaAsset.create({
      data: {
        organizationId: ORG.id, kind: 'video', storageKey: src.key,
        fileName: 'walkthrough.mp4', mimeType: 'video/mp4', sizeBytes: src.bytes,
        width: src.width, height: src.height, durationSec: src.durationSec,
        altText: 'A walkthrough of a finished job', tags: [],
      },
    });
    const variation = await db.channelVariation.create({
      data: {
        id: 'v-media-e2e', contentItemId: item!.id, channel: 'INSTAGRAM', format: 'reel',
        status: 'DRAFT', body: 'Take a look at this one.', hashtags: [],
        media: { create: [{ assetId: asset.id, position: 0 }] },
      },
    });

    // Apply the fix exactly as the button does — over HTTP, with a session.
    //
    // This used to import the route handler and call it as a function, which
    // stopped working the moment routes needed a session: `cookies()` has no
    // request to read outside a real one. Going over the wire is also simply a
    // better test, because it exercises the auth and tenant checks too.
    const BASE = process.env.BASE_URL || 'http://localhost:3000';
    let out: { ok?: boolean; applied?: string; asset?: { id: string; durationSec: number }; reason?: string } = {};
    const health = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
    if (!health) {
      console.log('  SKIP server not running — start it to cover the route');
      await cleanupE2E();
      return;
    }
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'dana@summitlocal.co',
        password: process.env.SEED_PASSWORD || 'demo-password-change-me',
      }),
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    login.ok && cookie ? ok('signed in to apply the fix') : bad(`could not sign in: ${login.status}`);

    const res = await fetch(`${BASE}/api/remediate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        kind: 'trim_video', variationId: variation.id, assetId: asset.id,
        params: { maxSeconds: 3 },
      }),
    });
    out = await res.json();
    out.ok ? ok(`the fix applied through the route (${out.applied})`) : bad(`fix failed: ${out.reason}`);
    out.asset?.durationSec === 3
      ? ok(`the post's video is now ${out.asset.durationSec}s, down from ${src.durationSec}s`)
      : bad(`expected 3s, got ${out.asset?.durationSec}`);

    // The swap must be on this post only, and the original must survive.
    const after = await db.channelVariation.findUnique({
      where: { id: variation.id }, include: { media: { include: { asset: true } } },
    });
    after?.media[0].assetId !== asset.id
      ? ok('the post now points at the trimmed copy')
      : bad('the post still points at the original');
    const originalStill = await db.mediaAsset.findUnique({ where: { id: asset.id } });
    originalStill?.durationSec === src.durationSec
      ? ok(`the original asset row is untouched (${originalStill.durationSec}s)`)
      : bad('the original row was modified');
    (await probe(src.key)).durationSec === src.durationSec
      ? ok('and the original bytes are untouched')
      : bad('the original file was overwritten');
    after?.media[0].asset.altText === asset.altText
      ? ok('alt text carried over — the picture still shows the same thing')
      : bad('alt text lost in the rendition');

    const audit = await db.auditEvent.findFirst({ where: { target: variation.id, action: 'media.trim_video' } });
    audit?.detail?.includes('original kept')
      ? ok('an audit row records the edit and says the original was kept')
      : bad('no audit row for the media edit');

    // Clean up so the demo workspace is unchanged.
    async function cleanupE2E() {
      await db.variationMedia.deleteMany({ where: { variationId: 'v-media-e2e' } });
      await db.auditEvent.deleteMany({ where: { target: 'v-media-e2e' } });
      await db.channelVariation.deleteMany({ where: { id: 'v-media-e2e' } });
      const ids = [asset.id, out.asset?.id].filter((x): x is string => Boolean(x));
      await db.mediaAsset.deleteMany({ where: { id: { in: ids } } });
      await rm(vdir, { recursive: true, force: true });
    }
    await cleanupE2E();
  }

  await rm(dir, { recursive: true, force: true });
}

main()
  .catch((e) => bad(`threw: ${(e as Error).stack}`))
  .finally(async () => {
    await db.$disconnect();
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nMEDIA CHECKS PASSED');
    process.exit(failures ? 1 : 0);
  });
