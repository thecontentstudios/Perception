'use client';

import { useState } from 'react';
import { ConnectFlow } from '@/components/ConnectFlow';
import { LiveConnect } from '@/components/LiveConnect';
import { connectSpecFor } from '@/lib/connect-specs';
import { BRANDS } from '@/lib/store';
import { CHANNEL_META, ChannelIcon } from '@/lib/channels';
import { fmtDateTime, fmtShort } from '@/lib/dates';
import { adapterFor } from '@/lib/connectors/registry';
import { useApp } from '@/lib/store';
import type { ConnectedAccount } from '@/lib/types';

const STATUS_TEXT: Record<ConnectedAccount['status'], { label: string; cls: string }> = {
  connected: { label: 'Connected', cls: 'published' },
  needs_reconnect: { label: 'Needs reconnection', cls: 'failed' },
  expiring: { label: 'Expiring soon', cls: 'review' },
  not_connected: { label: 'Not connected', cls: 'draft' },
};

function AccountCard({ account, onConnect }: { account: ConnectedAccount; onConnect: (c: ConnectedAccount['channel']) => void }) {
  const { dispatch, destinationsForAccount, destinationBlocker } = useApp();
  const [justConnected, setJustConnected] = useState(false);
  const [open, setOpen] = useState(false);
  const destinations = destinationsForAccount(account.id);
  const live = destinations.filter((d) => destinationBlocker(d) === null).length;
  const adapter = adapterFor(account.channel);
  const caps = adapter.capabilities;
  const st = STATUS_TEXT[account.status];
  /**
   * Connectable means "we have specified how to connect this", not "it's in
   * wave one". Bluesky needs no review at all and TikTok can be authorized
   * today (uploads just land as drafts until our audit clears) — gating those
   * behind a roadmap label would make the flow unreachable. Channels with no
   * spec yet (partner-gated Nextdoor, Snapchat, WhatsApp, SMS) stay Planned.
   */
  const connectable = connectSpecFor(account.channel) !== null;
  const planned = !connectable;

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ChannelIcon channel={account.channel} size={26} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{CHANNEL_META[account.channel].label}</div>
          <div style={{ color: 'var(--muted)', fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {account.status === 'not_connected' ? caps.api : account.displayName}
          </div>
        </div>
        <span className={`pill ${st.cls}`} style={{ marginLeft: 'auto' }}>
          {st.label}
        </span>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
        {account.status !== 'not_connected' && (
          <>
            {account.scopes.length > 0 && <div>Permissions: {account.scopes.join(', ')}</div>}
            {account.lastSyncAt && <div>Last sync {fmtDateTime(account.lastSyncAt)}</div>}
            {account.expiresAt && (
              <div>
                Authorization {account.status === 'needs_reconnect' ? 'expired' : 'renews'} {fmtShort(account.expiresAt)}
              </div>
            )}
          </>
        )}
        {account.status === 'not_connected' && <div>{caps.reviewNotes}</div>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 10.5 }}>
        <span className="pill neutral">{caps.supportsNativeScheduling ? 'native scheduling' : 'scheduled by Perception'}</span>
        {caps.supportsEdit && <span className="pill neutral">edit after publish</span>}
        {caps.supportsDelete && <span className="pill neutral">delete</span>}
        {caps.supportsMetrics && <span className="pill neutral">metrics</span>}
        {caps.supportsInboxEvents && <span className="pill neutral">inbox events</span>}
        {planned && <span className="pill review">second release</span>}
      </div>

      {destinations.length > 0 && (
        <>
          <button
            className="btn sm ghost"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            style={{ justifyContent: 'flex-start', padding: '2px 0' }}
          >
            {open ? '▾' : '▸'} {live} of {destinations.length} {destinations.length === 1 ? 'destination' : 'destinations'} can publish
          </button>
          {open && (
            <div className="dest-tree">
              {destinations.map((d) => {
                const blocker = destinationBlocker(d);
                return (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      aria-label={`Publish to ${d.name}`}
                      onChange={() => dispatch({ type: 'toggleDestination', destinationId: d.id })}
                    />
                    <span style={{ flex: 1, minWidth: 110 }}>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{d.name}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 10.5, display: 'block' }}>{d.kind}</span>
                    </span>
                    <select
                      className="select"
                      style={{ fontSize: 11, padding: '3px 22px 3px 7px' }}
                      aria-label={`Business for ${d.name}`}
                      value={d.brandId ?? ''}
                      onChange={(e) =>
                        dispatch({ type: 'mapDestination', destinationId: d.id, brandId: e.target.value || null })
                      }
                    >
                      <option value="">Unassigned</option>
                      {BRANDS.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    {blocker && (
                      <div style={{ flexBasis: '100%', color: 'var(--st-critical)', fontSize: 11 }}>{blocker}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        {account.status === 'needs_reconnect' || account.status === 'expiring' ? (
          <button
            className="btn primary sm"
            onClick={() => {
              dispatch({ type: 'reconnect', accountId: account.id });
              setJustConnected(true);
            }}
          >
            Reconnect
          </button>
        ) : account.status === 'not_connected' ? (
          <button
            className="btn sm"
            disabled={planned}
            title={planned ? 'Coming in the second release' : 'Starts the connection flow'}
            onClick={() => onConnect(account.channel)}
          >
            {planned ? 'Planned' : 'Connect'}
          </button>
        ) : (
          <button className="btn sm ghost">Manage</button>
        )}
        {justConnected && (
          <span style={{ color: 'var(--st-good-text)', fontSize: 11.5, fontWeight: 650 }}>
            ✓ Reconnected — held posts can retry now
          </span>
        )}
      </div>
    </div>
  );
}

export default function ConnectionsPage() {
  const { state } = useApp();
  const [connecting, setConnecting] = useState<ConnectedAccount['channel'] | null>(null);
  const attention = state.accounts.filter((a) => a.status === 'needs_reconnect' || a.status === 'expiring');
  const healthy = state.accounts.filter((a) => a.status === 'connected');
  const available = state.accounts.filter((a) => a.status === 'not_connected');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Connections</h1>
          <div className="sub">
            Official platform APIs only — no fragile browser automation. Tokens are encrypted, permissions are minimal,
            and you’re alerted before anything expires.
          </div>
        </div>
      </div>

      {attention.length > 0 && (
        <>
          <div className="section-label">Needs attention</div>
          <div className="grid cols-3" style={{ marginBottom: 6 }}>
            {attention.map((a) => (
              <AccountCard key={a.id} account={a} onConnect={setConnecting} />
            ))}
          </div>
        </>
      )}

      <div className="section-label">Connected</div>
      <div className="grid cols-3" style={{ marginBottom: 6 }}>
        {healthy.map((a) => (
          <AccountCard key={a.id} account={a} onConnect={setConnecting} />
        ))}
      </div>

      <div className="section-label">Available destinations</div>
      <div className="grid cols-3">
        {available.map((a) => (
          <AccountCard key={a.id} account={a} onConnect={setConnecting} />
        ))}
      </div>

      {connecting && <ConnectFlow channel={connecting} onClose={() => setConnecting(null)} />}

      <LiveConnect />

      <div className="card card-pad" style={{ marginTop: 14 }}>
        <h3 style={{ marginBottom: 6 }}>How connectors work</h3>
        <div style={{ color: 'var(--ink-2)', fontSize: 12.5, maxWidth: 720 }}>
          Every destination implements one shared contract — connect, refresh authorization, list destinations, validate
          content, upload media, publish, schedule, edit/delete where supported, report status, collect metrics, and
          feed the inbox. Adding a new platform is a new adapter, not a rewrite; platform review work (Meta App Review,
          TikTok audit, YouTube API compliance) starts during design, not after the interface is finished.
        </div>
      </div>
    </div>
  );
}
