/**
 * The publishing worker.
 *
 *   npm run worker
 *
 * This is the process that makes the calendar mean something. Without it,
 * "scheduled" is a label on a card; with it, a post goes out at the time the
 * owner picked whether or not anyone has the app open.
 *
 * Two loops, on purpose:
 *   - a scan every 30 seconds that moves due rows from Postgres into the queue
 *   - a BullMQ worker that drains the queue, with retries and backoff
 *
 * Run one or many. Claiming is a compare-and-swap on the row, so a second
 * worker adds throughput and cannot cause a double post.
 */
import 'dotenv/config';
import { Worker } from 'bullmq';
import { PUBLISH_QUEUE, redisConnection, type PublishJobData } from './src/lib/queue';
import { scanAndEnqueue } from './src/lib/queue/scheduler';
import { runPublishJob } from './src/lib/queue/publish-job';
import { dispatchAll } from './src/lib/queue/dispatch';
import { pollSocialInbox } from './src/lib/listen';
import { refreshPlatformMetrics } from './src/lib/metrics';
import { db } from './src/lib/db';

const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 30_000);
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a: unknown[]) => console.log(`[${stamp()}]`, ...a);

const worker = new Worker<PublishJobData>(
  PUBLISH_QUEUE,
  async (job) => {
    const r = await runPublishJob(job.data);
    log(`job ${job.id} → ${r.status}: ${r.detail}`);
    // Throwing is how BullMQ is told to retry. Returning normally on a
    // terminal failure is correct: another attempt cannot help, and burning
    // three more of them just delays the owner finding out.
    if (r.status === 'failed' && r.retryable) throw new Error(r.detail);
    return r;
  },
  { connection: redisConnection(), concurrency: 4 }
);

worker.on('failed', (job, err) => log(`job ${job?.id} attempt failed: ${err.message}`));
worker.on('error', (err) => log('worker error:', err.message));

let scanning = false;
const lastHeld: Record<string, number> = {};
async function scan() {
  // Skip rather than stack. A scan that outlives its interval would otherwise
  // overlap with the next one, and two scans racing is pointless work.
  if (scanning) return;
  scanning = true;
  try {
    const r = await scanAndEnqueue();
    if (r.enqueued > 0) log(`scan: ${r.due} due, ${r.enqueued} enqueued`);

    // Queued email and text messages, which are a different kind of work from
    // scheduled posts: nothing enqueues them into BullMQ because there is no
    // per-message job worth the overhead. The dispatcher drains the table.
    //
    // With no sending service configured this reports held messages once per
    // pass rather than failing them. Held work can be rescued by connecting a
    // provider; failed work has to be composed again, and turning a setup gap
    // into lost work would be the wrong trade.
    for (const d of await dispatchAll()) {
      if (d.sent > 0 || d.failed > 0 || d.suppressed > 0) {
        log(
          `dispatch ${d.channel}: ${d.sent} sent, ${d.failed} failed, ${d.suppressed} suppressed, ${d.chargedCents}c charged`
        );
      } else if (d.note && d.held !== lastHeld[d.channel]) {
        // Say it when the number changes, not every thirty seconds forever.
        log(`dispatch ${d.channel}: ${d.note}`);
        lastHeld[d.channel] = d.held;
      }
    }
  } catch (e) {
    log('scan failed:', (e as Error).message);
  } finally {
    scanning = false;
  }
}

const timer = setInterval(scan, SCAN_INTERVAL_MS);
void scan();

/**
 * The listening pass: social replies into the inbox, platform numbers into
 * the report. Minutes apart rather than seconds — notifications and like
 * counts move at human speed, and each pass spends the owner's API quota.
 * Both writes an audit row, which is what lets the screen say "as of".
 */
const LISTEN_INTERVAL_MS = Number(process.env.LISTEN_INTERVAL_MS || 5 * 60_000);
let listening = false;
async function listen() {
  if (listening) return;
  listening = true;
  try {
    for (const org of await db.organization.findMany({ select: { id: true } })) {
      const heard = await pollSocialInbox(org.id);
      if (heard.created > 0) log(`inbox: ${heard.created} new from ${heard.checked.join(', ')}`);
      const read = await refreshPlatformMetrics(org.id, { limit: 100 });
      if (read.written > 0) log(`metrics: ${read.written} readings`);
    }
  } catch (e) {
    log('listen failed:', (e as Error).message);
  } finally {
    listening = false;
  }
}
const listenTimer = setInterval(listen, LISTEN_INTERVAL_MS);
void listen();

log(`worker up — scanning every ${SCAN_INTERVAL_MS / 1000}s, concurrency 4`);

async function shutdown(signal: string) {
  log(`${signal} — finishing in-flight jobs`);
  clearInterval(timer);
  clearInterval(listenTimer);
  await worker.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
