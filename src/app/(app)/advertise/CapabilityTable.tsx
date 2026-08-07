'use client';

import { useState } from 'react';
import { CAPABILITIES, COMPARABLE, SUPPORT_LABEL, type Capability, type Support } from '@/lib/capabilities';
import { CHANNEL_META } from '@/lib/channels';

/**
 * What each channel can do, as a table you can actually read.
 *
 * A capability matrix is usually a wall of green ticks, which is the least
 * informative shape it could take: the ticks are the things everybody assumed
 * anyway. So the ticks here are deliberately quiet — grey, small — and the
 * "no" and "partly" cells carry the colour, because those are the cells that
 * turn into a campaign somebody has to rebuild.
 *
 * Each row also carries the one thing that most often surprises a first-time
 * user of that channel, which no vendor's feature list will ever contain.
 */

const ROWS: { key: keyof Capability; label: string }[] = [
  { key: 'images', label: 'Images' },
  { key: 'video', label: 'Video' },
  { key: 'links', label: 'Clickable links' },
  { key: 'personalisation', label: 'Personalised per person' },
  { key: 'twoWay', label: 'They can reply' },
  { key: 'scheduling', label: 'Schedule ahead' },
];

export function CapabilityTable() {
  const [openChannel, setOpenChannel] = useState<string | null>(null);
  const caps = COMPARABLE.map((c) => CAPABILITIES[c]).filter(Boolean) as Capability[];

  return (
    <div className="card">
      <div className="table-scroll cap-scroll">
        <table className="table cap-table">
          <thead>
            <tr>
              <th className="cap-corner">Can it…</th>
              {caps.map((c) => (
                <th key={c.channel} className="cap-col">
                  <span className="cap-dot" style={{ background: CHANNEL_META[c.channel]?.color ?? 'var(--muted)' }} />
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {caps.map((c) => {
                  const v = c[row.key] as Support;
                  return (
                    <td key={c.channel} className={`cap-cell ${v}`}>
                      <span>{SUPPORT_LABEL[v]}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th scope="row">Length limit</th>
              {caps.map((c) => (
                <td key={c.channel} className="cap-cell num">
                  {c.maxCharacters === null ? '—' : c.maxCharacters.toLocaleString('en-US')}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="cap-notes">
        {caps.map((c) => (
          <details
            key={c.channel}
            open={openChannel === c.channel}
            onToggle={(e) => setOpenChannel((e.currentTarget as HTMLDetailsElement).open ? c.channel : null)}
          >
            <summary>
              <span className="cap-dot" style={{ background: CHANNEL_META[c.channel]?.color ?? 'var(--muted)' }} />
              <b>{c.label}</b>
              <span className="cn-teaser">{c.surprise}</span>
            </summary>
            <dl className="cn-detail">
              <dt>What one use is</dt>
              <dd>{c.unit}</dd>
              <dt>Length</dt>
              <dd>{c.limitBehaviour}</dd>
              <dt>Who you can send to</dt>
              <dd>{c.targeting}</dd>
              <dt>What you can measure</dt>
              <dd>{c.measurement}</dd>
            </dl>
          </details>
        ))}
      </div>
    </div>
  );
}
