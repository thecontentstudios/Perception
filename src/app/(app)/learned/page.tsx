'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BRANDS, useApp } from '@/lib/store';
import { CHANNEL_META } from '@/lib/channels';
import { SOURCE_LABEL, type Suggestion } from '@/lib/suggest';
import type { Learning } from '@/lib/learning';

/**
 * "What we learned about your business."
 *
 * Its own page, not a panel on Analytics, because it is a different kind of
 * thing: Analytics answers "how did this campaign do", and this answers "what
 * should I do differently". The second question is the one an owner with
 * twenty minutes a week actually has.
 *
 * Written for someone who does not work in marketing. No rates without the
 * counts behind them, no jargon, and every claim carries the number of posts
 * it came from — so a reader can decide for themselves whether to believe it.
 */

interface BestTime {
  brandId: string;
  brandName: string;
  time: string;
  weekday: string | null;
  reason: string | null;
  learned: boolean;
}

interface Payload {
  ok: boolean;
  learning: Learning;
  bestTimes: BestTime[];
  suggestions: Suggestion[];
  reason?: string;
}

function prettyTime(t: string): string {
  const h = Number(t.slice(0, 2));
  const ampm = h < 12 ? 'am' : 'pm';
  return `${h % 12 === 0 ? 12 : h % 12}${ampm}`;
}

export default function LearnedPage() {
  const { state } = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const brandId = state.activeBrandId === 'all' ? undefined : state.activeBrandId;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/learning${brandId ? `?brandId=${brandId}` : ''}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [brandId]);

  const brandName = brandId ? BRANDS.find((b) => b.id === brandId)?.name : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>What we learned</h1>
          <div className="sub">
            {brandName ? `About ${brandName}, ` : 'Across your businesses, '}
            drawn from your own posts and what they produced — not general advice.
          </div>
        </div>
      </div>

      {loading && <div className="card card-pad">Reading your results…</div>}

      {!loading && (!data || !data.ok) && (
        <div className="card card-pad">
          <strong>Nothing to read yet.</strong>{' '}
          {data?.reason === 'no-database'
            ? 'This page reads real results, so it needs a database connected. See the README for setup.'
            : 'Publish a few posts with tracked links and check back.'}
        </div>
      )}

      {!loading && data?.ok && (
        <>
          {/* The sample, first and plainly. A reader should know how much this
              is built on before they read a single conclusion. */}
          <div className="card card-pad" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13.5 }}>
              Based on <strong>{data.learning.sample.posts}</strong> published{' '}
              {data.learning.sample.posts === 1 ? 'post' : 'posts'},{' '}
              <strong>{data.learning.sample.clicks.toLocaleString('en-US')}</strong> clicks on their
              links, and <strong>{data.learning.sample.conversions}</strong>{' '}
              {data.learning.sample.conversions === 1 ? 'result' : 'results'} we could trace back to
              a specific post.
            </div>
          </div>

          {data.learning.notEnoughYet ? (
            <div className="card card-pad">
              <h3 style={{ marginBottom: 6 }}>Not enough to draw conclusions yet</h3>
              <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 13 }}>
                {data.learning.notEnoughYet}
              </p>
              <p style={{ marginBottom: 0, color: 'var(--ink-2)', fontSize: 13 }}>
                We would rather say nothing than guess. Keep posting and this fills in.
              </p>
            </div>
          ) : (
            <div className="card card-pad" style={{ marginBottom: 12 }}>
              <h3 style={{ marginBottom: 10 }}>What your results say</h3>
              <ul className="list-plain">
                {data.learning.findings.map((f) => (
                  <li key={f.dimension} className="convo">
                    <div className="cv-body">
                      <div className="cv-top">
                        <span className="cv-from" style={{ textTransform: 'capitalize' }}>
                          {f.dimension === 'hour' ? 'Time of day' : f.dimension}
                        </span>
                        {f.lift && <span className="pill published">{f.lift.toFixed(1)}× difference</span>}
                      </div>
                      <div className="cv-text">{f.sentence}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                        {f.best.posts} {f.best.posts === 1 ? 'post' : 'posts'} · {f.best.clicks} clicks
                        {f.versus && ` · compared against ${f.versus.posts} ${f.versus.posts === 1 ? 'post' : 'posts'}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card card-pad" style={{ marginBottom: 12 }}>
            <h3 style={{ marginBottom: 10 }}>When to post</h3>
            <ul className="list-plain">
              {data.bestTimes.map((t) => (
                <li key={t.brandId} className="convo">
                  <div className="cv-body">
                    <div className="cv-top">
                      <span className="cv-from">{t.brandName}</span>
                      <span className={`pill ${t.learned ? 'published' : 'draft'}`}>
                        {prettyTime(t.time)}
                        {t.weekday ? ` · ${t.weekday}s` : ''}
                      </span>
                    </div>
                    <div className="cv-text">
                      {/* A default dressed up as a finding is the exact failure
                          this page exists to avoid. */}
                      {t.reason ?? 'Not enough of this business’s own history yet — this is our general starting point, not something we learned.'}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {data.suggestions.length > 0 && (
            <div className="card card-pad">
              <h3 style={{ marginBottom: 10 }}>What to do next</h3>
              <ul className="list-plain">
                {data.suggestions.map((s) => (
                  <li key={s.id} className="convo">
                    <div className="cv-body">
                      <div className="cv-top">
                        <span className="cv-from">{s.title}</span>
                        <span className="pill neutral">{SOURCE_LABEL[s.source]}</span>
                      </div>
                      <div className="cv-text">
                        {s.reasons.map((r, i) => (
                          <div key={i} style={{ marginBottom: 2 }}>{r}</div>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        Suggested for {s.channels.map((c) => CHANNEL_META[c].label).join(', ')}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 10 }}>
                <Link href="/create" className="btn sm primary">Start a campaign</Link>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
