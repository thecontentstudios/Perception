'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { PlatformPreview } from '@/components/PlatformPreview';
import { MediaThumb, SevIcon, WarningsList, fmtNum } from '@/components/ui';
import { CHANNEL_META, ChannelIcon } from '@/lib/channels';
import { addDays, fmtDateTime } from '@/lib/dates';
import { adapterFor } from '@/lib/connectors/registry';
import { BRANDS, TODAY, useApp } from '@/lib/store';
import { PUBLISH_STAGE_LABEL } from '@/lib/types';
import type { Channel, ChannelVariation, PublishDestination, PublishJob, PublishStage } from '@/lib/types';

/**
 * Quick Post — one message, many destinations, now or later.
 *
 * This is the cross-posting pipeline made visible. Writing once and fanning
 * out is the easy half; the half that matters is that each destination
 * succeeds or fails on its own. A dead LinkedIn token must never stop the
 * Instagram post, so every destination gets its own job, its own idempotency
 * key, its own retry, and its own error.
 */

const STAGE_ORDER: PublishStage[] = ['queued', 'validating', 'uploading', 'publishing', 'verifying', 'done'];

function DestAvatar({ d, size = 26 }: { d: PublishDestination; size?: number }) {
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `hsl(${d.hue} 45% 42%)`,
        flex: 'none',
      }}
      aria-hidden
    >
      {d.name.replace('@', '').slice(0, 1).toUpperCase()}
    </span>
  );
}

function JobRow({ job, dest, onRetry }: { job: PublishJob; dest?: PublishDestination; onRetry: () => void }) {
  const idx = STAGE_ORDER.indexOf(job.stage);
  const failed = job.stage === 'failed';
  const done = job.stage === 'done';

  return (
    <div className="job-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <ChannelIcon channel={job.channel} size={16} />
        <span style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {dest?.name ?? job.destinationId}
        </span>
      </div>

      {/* Stage track — each destination advances independently. */}
      <div className="job-track" aria-hidden>
        {STAGE_ORDER.slice(0, 5).map((st, i) => (
          <span
            key={st}
            className={`job-pip ${failed && i >= idx ? 'fail' : i < idx || done ? 'on' : i === idx ? 'active' : ''}`}
          />
        ))}
      </div>

      <span
        className={`pill ${done ? 'published' : failed ? 'failed' : 'scheduled'}`}
        style={{ justifySelf: 'start' }}
      >
        {failed ? 'Failed' : PUBLISH_STAGE_LABEL[job.stage]}
      </span>

      <div className="job-detail" style={{ color: failed ? 'var(--st-critical)' : 'var(--muted)' }}>
        {failed ? (
          <>
            <span>{job.error}</span>
            <button className="btn sm" onClick={onRetry}>
              Retry
            </button>
          </>
        ) : done ? (
          <span>
            post <code className="mono">{job.externalId}</code>
            {job.attempt > 1 && ` · succeeded on attempt ${job.attempt}`}
          </span>
        ) : (
          <span>attempt {job.attempt}</span>
        )}
      </div>
    </div>
  );
}

export default function QuickPostPage() {
  const {
    state,
    dispatch,
    destinationBlocker,
    destinationById,
    preflightFor,
    brandById,
  } = useApp();

  const [body, setBody] = useState('');
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [date, setDate] = useState(addDays(TODAY, 1));
  const [time, setTime] = useState('09:30');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [, setFlaky] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /**
   * Destinations backed by a real grant. These publish for real through
   * /api/publish rather than through the simulated pipeline, so they are kept
   * separate and labelled — a demo post and a post the world can see must
   * never look the same in this UI.
   */
  const [live, setLive] = useState<{ channel: Channel; accountLabel: string; canPublish: boolean }[]>([]);
  const [liveResults, setLiveResults] = useState<
    Record<string, { ok: boolean; url?: string; error?: string; busy?: boolean }>
  >({});
  const [livePicked, setLivePicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/publish')
      .then((r) => r.json())
      .then((d) => setLive(d.live ?? []))
      .catch(() => setLive([]));
  }, []);

  const brandFiltered = state.destinations.filter(
    (d) => state.activeBrandId === 'all' || d.brandId === state.activeBrandId || d.brandId === null
  );

  /** Grouped by channel so the picker reads like the platforms themselves. */
  const grouped = useMemo(() => {
    const map = new Map<string, PublishDestination[]>();
    for (const d of brandFiltered) {
      const list = map.get(d.channel) ?? [];
      list.push(d);
      map.set(d.channel, list);
    }
    return [...map.entries()];
  }, [brandFiltered]);

  const selected = brandFiltered.filter((d) => picked.has(d.id));
  const assets = state.media.filter((m) => mediaIds.includes(m.id));

  /** Build the variation we'd publish to a destination, for preview + checks. */
  const variationFor = (d: PublishDestination): ChannelVariation => ({
    id: `qp-${d.id}`,
    contentItemId: 'qp',
    campaignId: 'qp',
    channel: d.channel,
    destinationId: d.id,
    format: d.channel === 'google_business' ? 'update' : d.channel === 'email' ? 'email' : 'post',
    status: 'draft',
    scheduledAt: when === 'later' ? `${date}T${time}` : `${TODAY}T09:45`,
    publishedAt: null,
    body,
    subject: d.channel === 'email' ? body.split('\n')[0].slice(0, 60) : null,
    preheader: null,
    hasUnsubscribeFooter: true,
    mediaIds,
    cta: null,
    hashtags: [],
    assigneeUserId: null,
    overridden: false,
    failure: null,
  });

  /** Per-destination channel checks, run live as the message is typed. */
  const checksFor = (d: PublishDestination) => adapterFor(d.channel).validate(variationFor(d), assets);

  const blockedSelected = selected.filter(
    (d) => destinationBlocker(d) !== null || checksFor(d).some((w) => w.severity === 'block')
  );
  const readySelected = selected.filter((d) => !blockedSelected.includes(d));

  const jobs = batchId ? state.jobs.filter((j) => j.id.startsWith(batchId)) : [];

  /**
   * Walk one job through the stages on its own timer, so each destination's
   * independence is visible rather than asserted.
   *
   * `failAt` models the failures preflight cannot predict — a rate limit, a
   * platform 5xx, a media rejection. The demo trips one on the first attempt
   * of one destination per batch, because the retry path is the part of a
   * publishing pipeline most worth seeing work.
   */
  function runJob(job: PublishJob, attempt: number, failAt: boolean) {
    const dest = destinationById(job.destinationId);
    if (!dest) return;
    const steps: PublishStage[] = ['validating', 'uploading', 'publishing', 'verifying', 'done'];
    const path = mediaIds.length > 0 ? steps : steps.filter((s) => s !== 'uploading');

    // Chain the stages rather than scheduling them all upfront: a failure has
    // to stop the pipeline, and pre-scheduled timers would fire straight past
    // it and overwrite the failed state with 'done'.
    const step = (si: number) => {
      if (si >= path.length) return;
      const stage = path[si];
      timers.current.push(
        setTimeout(() => {
          if (stage === 'publishing' && failAt && attempt === 1) {
            dispatch({
              type: 'advanceJob',
              jobId: job.id,
              stage: 'failed',
              error: 'Rate limited by the platform — safe to retry',
            });
            return; // chain stops here
          }
          dispatch({
            type: 'advanceJob',
            jobId: job.id,
            stage,
            // The external id derives from the idempotency key, so a retry
            // that reaches the platform again resolves to the same post
            // rather than creating a second one.
            externalId: stage === 'done' ? `${dest.externalId}_${job.idempotencyKey.slice(-6)}` : undefined,
          });
          step(si + 1);
        }, 420)
      );
    };
    step(0);
  }

  /** Fan out: one job per destination, all in flight at once. */
  function publishNow() {
    const batch = `job-${Date.now().toString(36)}`;
    const created: PublishJob[] = readySelected.map((d) => ({
      id: `${batch}-${d.id}`,
      destinationId: d.id,
      channel: d.channel,
      stage: 'queued',
      // Stable per (content, destination, slot) — a retry reuses it, so a
      // worker that died after the platform accepted cannot double-post.
      idempotencyKey: `${batch}:${d.externalId}`,
      attempt: 1,
      error: null,
      externalId: null,
      startedAt: `${TODAY}T09:45`,
      finishedAt: null,
    }));
    setBatchId(batch);
    setConfirming(false);
    setFlaky(created.length > 2 ? created[2].id : null);
    dispatch({ type: 'startJobs', jobs: created });

    created.forEach((job, i) => {
      // Stagger slightly; platforms rate-limit, so real fan-out is not
      // simultaneous to the millisecond.
      timers.current.push(
        setTimeout(() => runJob(job, 1, created.length > 2 && i === 2), 220 + i * 120)
      );
    });
  }

  /** Publish to the live, really-connected destinations. */
  async function publishLive() {
    for (const l of live.filter((x) => x.canPublish && livePicked.has(x.channel))) {
      setLiveResults((r) => ({ ...r, [l.channel]: { ok: false, busy: true } }));
      try {
        const res = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: l.channel, text: body }),
        });
        const data = await res.json();
        setLiveResults((r) => ({
          ...r,
          [l.channel]: { ok: !!data.ok, url: data.url, error: data.error },
        }));
      } catch (e) {
        setLiveResults((r) => ({ ...r, [l.channel]: { ok: false, error: (e as Error).message } }));
      }
    }
  }

  function retry(job: PublishJob) {
    dispatch({ type: 'retryJob', jobId: job.id });
    timers.current.push(setTimeout(() => runJob(job, job.attempt + 1, false), 200));
  }

  function schedule() {
    // Scheduling creates one held item per destination — the same fan-out,
    // handed to the scheduler instead of the publisher.
    const batch = `sch-${Date.now().toString(36)}`;
    setBatchId(null);
    setConfirming(false);
    dispatch({
      type: 'addCampaign',
      campaign: {
        id: `c-${batch}`,
        brandId: selected[0]?.brandId ?? BRANDS[0].id,
        name: `Cross-post · ${date} ${time}`,
        status: 'scheduled',
        goal: 'awareness',
        audience: 'Followers across the selected destinations',
        startDate: date,
        endDate: date,
        offer: null,
        cta: { label: 'Learn more', url: '' },
        colorIndex: 1,
        utmCode: `crosspost-${date}`,
        createdByUserId: 'u-dana',
        templateId: null,
        description: `One message scheduled to ${readySelected.length} destinations.`,
      },
      items: [{ id: `ci-${batch}`, campaignId: `c-${batch}`, title: body.slice(0, 48) || 'Cross-post', kind: 'social', coreMessage: body }],
      variations: readySelected.map((d) => ({ ...variationFor(d), id: `v-${batch}-${d.id}`, contentItemId: `ci-${batch}`, campaignId: `c-${batch}`, status: 'scheduled' as const })),
      auditDetail: `Scheduled one message to ${readySelected.length} destinations for ${date} ${time}.`,
    });
    setScheduled(`Scheduled to ${readySelected.length} destinations for ${fmtDateTime(`${date}T${time}`)}.`);
  }

  const [scheduled, setScheduled] = useState<string | null>(null);

  const allDone = jobs.length > 0 && jobs.every((j) => j.stage === 'done' || j.stage === 'failed');
  const succeeded = jobs.filter((j) => j.stage === 'done').length;
  const failedJobs = jobs.filter((j) => j.stage === 'failed');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Quick Post</h1>
          <div className="sub">
            Write it once, send it everywhere — right now or at a time you pick. Every destination
            publishes independently, so one bad connection can't take the rest down with it.
          </div>
        </div>
        <div className="actions">
          <Link href="/create" className="btn">
            Need a full campaign?
          </Link>
        </div>
      </div>

      <div className="post-layout">
        {/* Compose + destinations */}
        <div>
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <div className="field">
              <label htmlFor="qp-body">Your message</label>
              <textarea
                id="qp-body"
                className="textarea"
                style={{ minHeight: 116 }}
                placeholder="What do you want to say? We'll adapt it for each destination."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <span className="hint">{body.length} characters</span>
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label>Attach photos or video</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {state.media
                  .filter((m) => m.kind !== 'logo')
                  .slice(0, 10)
                  .map((m) => {
                    const on = mediaIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => setMediaIds(on ? mediaIds.filter((x) => x !== m.id) : [...mediaIds, m.id])}
                        aria-pressed={on}
                        title={m.name}
                        style={{ border: on ? '2px solid var(--accent)' : '2px solid transparent', borderRadius: 9, padding: 2, background: 'none' }}
                      >
                        <MediaThumb asset={m} size={46} />
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* Destination picker */}
          <div className="card">
            <div className="card-head">
              <h3>Where should it go?</h3>
              <span className="card-sub">{selected.length} selected</span>
              <div className="right">
                <button
                  className="btn sm"
                  onClick={() => {
                    const ok = brandFiltered.filter((d) => destinationBlocker(d) === null);
                    setPicked(picked.size >= ok.length ? new Set() : new Set(ok.map((d) => d.id)));
                  }}
                >
                  {picked.size > 0 ? 'Clear' : 'Select all available'}
                </button>
              </div>
            </div>
            <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
              {/* Really-connected destinations, kept visually apart from the
                  demo workspace: a post the world can see must never look the
                  same as one that goes nowhere. */}
              {live.length > 0 && (
                <div className="live-block">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
                    <span className="live-dot" aria-hidden />
                    <strong style={{ fontSize: 12 }}>Live accounts</strong>
                    <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                      these publish for real
                    </span>
                  </div>
                  <div style={{ display: 'grid', gap: 5 }}>
                    {live.map((l) => {
                      const on = livePicked.has(l.channel);
                      const res = liveResults[l.channel];
                      return (
                        <label
                          key={l.channel}
                          className={`dest-row ${on ? 'on' : ''} ${l.canPublish ? '' : 'blocked'}`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!l.canPublish}
                            onChange={() => {
                              const next = new Set(livePicked);
                              if (next.has(l.channel)) next.delete(l.channel);
                              else next.add(l.channel);
                              setLivePicked(next);
                            }}
                          />
                          <ChannelIcon channel={l.channel} size={20} />
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ fontWeight: 600, fontSize: 12.5, display: 'block' }}>
                              {l.accountLabel}
                            </span>
                            <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                              {CHANNEL_META[l.channel].label} · connected account
                            </span>
                          </span>
                          {!l.canPublish && (
                            <span className="pill draft" style={{ textTransform: 'none', letterSpacing: 0 }}>
                              publishing not implemented yet
                            </span>
                          )}
                          {res?.busy && <span className="pill scheduled">posting…</span>}
                          {res && !res.busy && res.ok && (
                            <a className="pill published" href={res.url} target="_blank" rel="noreferrer">
                              posted ↗
                            </a>
                          )}
                          {res && !res.busy && !res.ok && (
                            <span className="pill failed" style={{ textTransform: 'none', letterSpacing: 0, maxWidth: 240, whiteSpace: 'normal' }}>
                              {res.error}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {grouped.map(([channel, dests]) => (
                <div key={channel}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                    <ChannelIcon channel={channel as PublishDestination['channel']} size={15} />
                    <strong style={{ fontSize: 12 }}>{CHANNEL_META[channel as PublishDestination['channel']].label}</strong>
                  </div>
                  <div style={{ display: 'grid', gap: 5 }}>
                    {dests.map((d) => {
                      const blocker = destinationBlocker(d);
                      const on = picked.has(d.id);
                      return (
                        <label
                          key={d.id}
                          className={`dest-row ${on ? 'on' : ''} ${blocker ? 'blocked' : ''}`}
                          title={blocker ?? undefined}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!!blocker}
                            onChange={() => {
                              const next = new Set(picked);
                              if (next.has(d.id)) next.delete(d.id);
                              else next.add(d.id);
                              setPicked(next);
                            }}
                          />
                          <DestAvatar d={d} />
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ fontWeight: 600, fontSize: 12.5, display: 'block' }}>{d.name}</span>
                            <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                              {d.kind}
                              {d.followers !== null && ` · ${fmtNum(d.followers)} followers`}
                              {d.brandId && ` · ${brandById(d.brandId)?.name}`}
                            </span>
                          </span>
                          {blocker && (
                            <span className="pill failed" style={{ maxWidth: 260, whiteSpace: 'normal', textTransform: 'none', letterSpacing: 0 }}>
                              {blocker}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Previews, checks, and the send controls */}
        <div>
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <h3 style={{ marginBottom: 8 }}>Send</h3>
            <div className="seg" style={{ marginBottom: 10 }}>
              <button className={when === 'now' ? 'on' : ''} onClick={() => setWhen('now')}>
                Post now
              </button>
              <button className={when === 'later' ? 'on' : ''} onClick={() => setWhen('later')}>
                Schedule
              </button>
            </div>

            {when === 'later' && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input type="date" className="input" style={{ width: 'auto' }} value={date} aria-label="Date" onChange={(e) => setDate(e.target.value)} />
                <input type="time" className="input" style={{ width: 'auto' }} value={time} aria-label="Time" onChange={(e) => setTime(e.target.value)} />
              </div>
            )}

            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 10 }}>
              {readySelected.length} ready
              {livePicked.size > 0 && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--st-good-text)', fontWeight: 650 }}>
                    {livePicked.size} live
                  </span>
                </>
              )}
              {blockedSelected.length > 0 && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--st-critical)', fontWeight: 650 }}>
                    {blockedSelected.length} held back
                  </span>
                </>
              )}
            </div>

            {!confirming ? (
              <button
                className="btn primary"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={(readySelected.length === 0 && livePicked.size === 0) || !body.trim()}
                onClick={() => setConfirming(true)}
              >
                {when === 'now'
                  ? `Post to ${readySelected.length} destination${readySelected.length === 1 ? '' : 's'} now`
                  : `Schedule for ${readySelected.length} destination${readySelected.length === 1 ? '' : 's'}`}
              </button>
            ) : (
              // Publishing is outward-facing and hard to undo — confirm first.
              <div className="notice info" style={{ display: 'block' }}>
                <div style={{ fontWeight: 650, marginBottom: 6 }}>
                  {when === 'now'
                    ? `This posts publicly to ${readySelected.length} destinations right away.`
                    : `This schedules ${readySelected.length} posts for ${fmtDateTime(`${date}T${time}`)}.`}
                </div>
                {when === 'now' && livePicked.size > 0 && (
                  <div style={{ color: 'var(--st-critical)', fontWeight: 650, marginBottom: 6 }}>
                    {livePicked.size} of these is a live account — that post will be publicly visible
                    and cannot be un-posted from here.
                  </div>
                )}
                <div style={{ fontSize: 11.5, marginBottom: 8 }}>
                  {readySelected.map((d) => d.name).join(' · ')}
                </div>
                <div style={{ display: 'flex', gap: 7 }}>
                  <button
                    className="btn primary sm"
                    onClick={
                      when === 'now'
                        ? () => {
                            publishNow();
                            publishLive();
                          }
                        : schedule
                    }
                  >
                    {when === 'now' ? 'Yes, post now' : 'Yes, schedule it'}
                  </button>
                  <button className="btn sm" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {scheduled && (
              <div className="notice success" style={{ marginTop: 10 }}>
                ✓ {scheduled} <Link href="/calendar">See it on the calendar →</Link>
              </div>
            )}

            {blockedSelected.length > 0 && (
              <>
                <div className="section-label">Held back</div>
                <div className="warnings">
                  {blockedSelected.map((d) => {
                    const reason = destinationBlocker(d) ?? checksFor(d).find((w) => w.severity === 'block')?.message;
                    return (
                      <div key={d.id} className="warning-row block">
                        <span className="w-icon">
                          <SevIcon severity="block" />
                        </span>
                        <div>
                          <div style={{ fontWeight: 650 }}>{d.name}</div>
                          <div className="fix">{reason}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
                  These are skipped, not silently dropped — the rest still go out.{' '}
                  <Link href="/connections">Fix in Connections →</Link>
                </div>
              </>
            )}
          </div>

          {/* Live pipeline */}
          {jobs.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-head">
                <h3>Publishing</h3>
                <span className="card-sub">
                  {allDone ? `${succeeded} of ${jobs.length} published` : `${jobs.length} destinations in flight`}
                </span>
              </div>
              <div className="card-pad" style={{ display: 'grid', gap: 8 }}>
                {jobs.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    dest={destinationById(j.destinationId)}
                    onRetry={() => retry(j)}
                  />
                ))}
                {allDone && failedJobs.length > 0 && (
                  <div className="notice info">
                    {succeeded} went out fine. {failedJobs.length} failed independently and can be retried
                    without affecting the ones that already published — the idempotency key is reused, so a
                    retry can never double-post.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Per-destination previews */}
          {selected.length > 0 && body.trim() && (
            <div className="card">
              <div className="card-head">
                <h3>How it will look</h3>
                <span className="card-sub">Adapted per destination</span>
              </div>
              <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
                {selected.slice(0, 4).map((d) => {
                  const v = variationFor(d);
                  const brand = BRANDS.find((b) => b.id === d.brandId) ?? BRANDS[0];
                  const checks = checksFor(d);
                  return (
                    <div key={d.id}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                        <DestAvatar d={d} size={20} />
                        <strong style={{ fontSize: 12 }}>{d.name}</strong>
                      </div>
                      <PlatformPreview variation={v} assets={assets} brand={brand} />
                      {checks.length > 0 && (
                        <div style={{ marginTop: 7 }}>
                          <WarningsList warnings={checks} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {selected.length > 4 && (
                  <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                    + {selected.length - 4} more destinations
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
