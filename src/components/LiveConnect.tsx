'use client';

import { useEffect, useState } from 'react';
import { CHANNEL_META, ChannelIcon } from '@/lib/channels';
import type { Channel } from '@/lib/types';

/**
 * Live connections — the real thing, alongside the demo workspace.
 *
 * Two honest states, and the panel never blurs them:
 *   • Bluesky connects for real right now. No app registration, no review.
 *   • Everything else needs credentials you obtain from the platform. We show
 *     exactly which env vars are missing and the redirect URI to register.
 */

interface ProviderStatus {
  channel: Channel;
  label: string;
  configured: boolean;
  missing: string[];
  consoleUrl: string;
  redirectUri: string;
  scopes: string[];
  destinationsHint: string;
}

interface StatusPayload {
  appUrl: string;
  encryptionKeySet: boolean;
  bluesky: { howTo: string };
  providers: ProviderStatus[];
  configuredCount: number;
  grants: {
    channel: Channel;
    accountLabel: string;
    connectedAt: number;
    expired: boolean;
    hasRefreshToken: boolean;
    scopes: string[];
  }[];
  storeError: string | null;
}

function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn sm"
      style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, maxWidth: '100%' }}
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      title="Copy"
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      <span style={{ color: copied ? 'var(--st-good-text)' : 'var(--muted)', flex: 'none' }}>
        {copied ? '✓' : '⧉'}
      </span>
    </button>
  );
}

function MastodonConnect({ onDone }: { onDone: () => void }) {
  const [host, setHost] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; fix?: string } | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/connect/mastodon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, accessToken }),
      });
      const data = await res.json();
      if (res.ok && data.connected) {
        setResult({
          ok: true,
          message: `Connected as ${data.account}`,
          fix: data.note ?? `Character limit read from the server: ${data.characterLimit}.`,
        });
        setAccessToken('');
        onDone();
      } else {
        setResult({ ok: false, message: data.error ?? 'Connection failed.', fix: data.fix });
      }
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ borderColor: 'var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
        <ChannelIcon channel="mastodon" size={22} />
        <div>
          <strong style={{ fontSize: 13 }}>Mastodon</strong>
          <div className="card-sub">Connects for real — your instance, your token</div>
        </div>
        <span className="pill published" style={{ marginLeft: 'auto' }}>
          ready now
        </span>
      </div>

      <p style={{ color: 'var(--ink-2)', fontSize: 12.5, marginTop: 4 }}>
        On your own instance go to <strong>Preferences → Development → New application</strong>, tick{' '}
        <code className="mono">write:statuses</code>, and copy the access token. No developer console,
        no review.
      </p>

      <div className="field">
        <label htmlFor="ma-host">Instance</label>
        <input
          id="ma-host"
          className="input"
          placeholder="mastodon.social"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ma-token">Access token</label>
        <input
          id="ma-token"
          className="input"
          type="password"
          placeholder="your access token"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && submit()}
        />
      </div>

      <button className="btn primary" onClick={submit} disabled={busy || !host || !accessToken}>
        {busy ? 'Connecting…' : 'Connect Mastodon'}
      </button>

      {result && (
        <div className={`notice ${result.ok ? 'success' : 'info'}`} style={{ marginTop: 10, display: 'block' }}>
          <div style={{ fontWeight: 650 }}>
            {result.ok ? '✓ ' : ''}
            {result.message}
          </div>
          {result.fix && <div style={{ fontSize: 11.5, marginTop: 3 }}>{result.fix}</div>}
        </div>
      )}
    </div>
  );
}

function BlueskyConnect({ onDone }: { onDone: () => void }) {
  const [handle, setHandle] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; fix?: string } | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/connect/bluesky', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, appPassword }),
      });
      const data = await res.json();
      if (res.ok && data.connected) {
        setResult({ ok: true, message: `Connected as @${data.handle}` });
        setAppPassword('');
        onDone();
      } else {
        setResult({ ok: false, message: data.error ?? 'Connection failed.', fix: data.fix });
      }
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ borderColor: 'var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
        <ChannelIcon channel="bluesky" size={22} />
        <div>
          <strong style={{ fontSize: 13 }}>Bluesky</strong>
          <div className="card-sub">Connects for real — no developer app, no review</div>
        </div>
        <span className="pill published" style={{ marginLeft: 'auto' }}>
          ready now
        </span>
      </div>

      <p style={{ color: 'var(--ink-2)', fontSize: 12.5, marginTop: 4 }}>
        In the Bluesky app go to <strong>Settings → App Passwords</strong> and create one. It looks like{' '}
        <code className="mono">xxxx-xxxx-xxxx-xxxx</code>. Use that, never your main password — app
        passwords can be revoked on their own.
      </p>

      <div className="field">
        <label htmlFor="bs-handle">Handle</label>
        <input
          id="bs-handle"
          className="input"
          placeholder="yourbusiness.bsky.social"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="bs-pw">App password</label>
        <input
          id="bs-pw"
          className="input"
          type="password"
          placeholder="xxxx-xxxx-xxxx-xxxx"
          value={appPassword}
          onChange={(e) => setAppPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && submit()}
        />
      </div>

      <button className="btn primary" onClick={submit} disabled={busy || !handle || !appPassword}>
        {busy ? 'Connecting…' : 'Connect Bluesky'}
      </button>

      {result && (
        <div className={`notice ${result.ok ? 'success' : 'info'}`} style={{ marginTop: 10, display: 'block' }}>
          <div style={{ fontWeight: 650 }}>
            {result.ok ? '✓ ' : ''}
            {result.message}
          </div>
          {result.fix && <div style={{ fontSize: 11.5, marginTop: 3 }}>{result.fix}</div>}
        </div>
      )}
    </div>
  );
}

export function LiveConnect() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [open, setOpen] = useState(false);

  const load = () =>
    fetch('/api/connect/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));

  useEffect(() => {
    load();
  }, []);

  if (!status) return null;

  const ready = status.encryptionKeySet;

  return (
    <div className="card card-pad" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h3>Live connections</h3>
          <div className="card-sub">
            Everything above is the demo workspace. This is the real OAuth pipeline —{' '}
            {status.configuredCount} of {status.providers.length} providers have credentials.
          </div>
        </div>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide setup' : 'Set up real connections'}
        </button>
      </div>

      {status.grants.length > 0 && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 }}>
          {status.grants.map((g) => (
            <span key={g.channel} className={`pill ${g.expired ? 'failed' : 'published'}`} style={{ gap: 5 }}>
              <ChannelIcon channel={g.channel} size={12} />
              {g.accountLabel} {g.expired ? '· expired' : '· live'}
            </span>
          ))}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
          {!ready && (
            <div className="warning-row block">
              <div>
                <div style={{ fontWeight: 650 }}>No encryption key set — connections are disabled.</div>
                <div className="fix">
                  Tokens are stored encrypted, so a key is required before anything can connect. Run{' '}
                  <code className="mono">openssl rand -base64 32</code> and put the result in{' '}
                  <code className="mono">.env.local</code> as{' '}
                  <code className="mono">TOKEN_ENCRYPTION_KEY</code>.
                </div>
              </div>
            </div>
          )}

          <div className="section-label" style={{ marginTop: 0 }}>
            Ready now — no app registration needed
          </div>
          <div className="grid cols-2">
            <BlueskyConnect onDone={load} />
            <MastodonConnect onDone={load} />
          </div>

          <div>
            <div className="section-label" style={{ marginTop: 0 }}>
              Providers that need an app you register
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {status.providers.map((p) => (
                <div key={p.channel} className="card card-pad" style={{ padding: '11px 13px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <ChannelIcon channel={p.channel} size={18} />
                    <strong style={{ fontSize: 12.5 }}>{p.label}</strong>
                    <span className={`pill ${p.configured ? 'published' : 'draft'}`}>
                      {p.configured ? 'credentials set' : 'not configured'}
                    </span>
                    {p.configured && ready && (
                      <a className="btn primary sm" style={{ marginLeft: 'auto' }} href={`/api/connect/${p.channel}/start`}>
                        Connect {CHANNEL_META[p.channel].label}
                      </a>
                    )}
                  </div>

                  {!p.configured && (
                    <div style={{ marginTop: 8, display: 'grid', gap: 6, fontSize: 11.5 }}>
                      <div>
                        <span style={{ color: 'var(--ink-2)' }}>1. Create an app at </span>
                        <a href={p.consoleUrl} target="_blank" rel="noreferrer">
                          {p.consoleUrl.replace('https://', '')}
                        </a>
                      </div>
                      <div>
                        <span style={{ color: 'var(--ink-2)' }}>2. Register this redirect URI:</span>
                        <div style={{ marginTop: 3 }}>
                          <Copyable value={p.redirectUri} />
                        </div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--ink-2)' }}>3. Put these in </span>
                        <code className="mono">.env.local</code>:
                        <div style={{ marginTop: 3, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {p.missing.map((m) => (
                            <Copyable key={m} value={`${m}=`} />
                          ))}
                        </div>
                      </div>
                      <div style={{ color: 'var(--muted)' }}>
                        Scopes requested: {p.scopes.join(', ')} · Destinations via {p.destinationsHint}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="notice info" style={{ display: 'block' }}>
            <div style={{ fontWeight: 650, marginBottom: 3 }}>What we can and can&apos;t do for you</div>
            The authorization code, PKCE, state verification, token exchange, encryption, and storage are
            all implemented and real. Registering the app and passing each platform&apos;s review is yours
            to do — no tool can do it on your behalf. Bluesky is the exception and needs neither.
          </div>
        </div>
      )}
    </div>
  );
}
