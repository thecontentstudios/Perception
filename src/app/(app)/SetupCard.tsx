'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Collapsible } from '@/components/Collapsible';

/**
 * The workspace's setup, as a live checklist on Home.
 *
 * Convenience is not a wizard — it is knowing what is already true and what
 * one thing to do next. Every row here is computed from running state, so it
 * reopens when something breaks, and each row links to the exact screen that
 * fixes it. Fully set up, it folds itself down to one quiet line.
 */

interface Step {
  id: string;
  label: string;
  done: boolean;
  detail: string;
  href: string;
}

export function SetupCard() {
  const [data, setData] = useState<{ steps: Step[]; ready: number; total: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/setup')
      .then((r) => r.json())
      .then((d) => live && d.ok && setData(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!data) return null;
  const allDone = data.ready === data.total;

  return (
    <Collapsible
      id="home.setup"
      title="Get set up"
      defaultOpen={!allDone}
      summary={allDone ? 'everything is connected' : `${data.ready} of ${data.total} ready`}
      badge={
        <span className={`pill ${allDone ? 'approved' : 'review'}`}>
          {data.ready}/{data.total}
        </span>
      }
    >
      <ul className="list" data-testid="setup-steps">
        {data.steps.map((s) => (
          <li key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span aria-hidden style={{ width: 18, textAlign: 'center', color: s.done ? 'var(--st-good)' : 'var(--muted)' }}>
              {s.done ? '✓' : '○'}
            </span>
            {s.done ? (
              <span style={{ fontWeight: 600 }}>{s.label}</span>
            ) : (
              <Link href={s.href} style={{ fontWeight: 650 }}>
                {s.label} →
              </Link>
            )}
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{s.detail}</span>
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}
