'use client';

import { useState } from 'react';
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

function AccountCard({ account }: { account: ConnectedAccount }) {
  const { dispatch } = useApp();
  const [justConnected, setJustConnected] = useState(false);
  const adapter = adapterFor(account.channel);
  const caps = adapter.capabilities;
  const st = STATUS_TEXT[account.status];
  const planned = caps.availability === 'planned';

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
          <button className="btn sm" disabled={planned} title={planned ? 'Coming in the second release' : 'Starts the OAuth flow'}>
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
              <AccountCard key={a.id} account={a} />
            ))}
          </div>
        </>
      )}

      <div className="section-label">Connected</div>
      <div className="grid cols-3" style={{ marginBottom: 6 }}>
        {healthy.map((a) => (
          <AccountCard key={a.id} account={a} />
        ))}
      </div>

      <div className="section-label">Available destinations</div>
      <div className="grid cols-3">
        {available.map((a) => (
          <AccountCard key={a.id} account={a} />
        ))}
      </div>

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
