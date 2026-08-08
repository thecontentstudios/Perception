'use client';

import { useEffect, useState } from 'react';

/**
 * Connect the sending services from a screen.
 *
 * This panel is the wall between a demo and a real business coming down:
 * the senders read keys from the server environment, and an owner does not
 * have a .env file. Keys entered here are encrypted at rest, never echoed
 * back (the status line shows the last four characters only), and take
 * effect without a restart. The proof of setup is a test message arriving —
 * through the same adapter and the same ledger a campaign would use.
 */

interface ChannelStatus {
  ready: boolean;
  provider: string | null;
  why: string;
  source: 'settings' | 'env' | null;
  hint: string | null;
}

export function SendingPanel() {
  const [status, setStatus] = useState<{ email: ChannelStatus; sms: ChannelStatus; canStore: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [emailKey, setEmailKey] = useState('');
  const [emailFrom, setEmailFrom] = useState('');
  const [sid, setSid] = useState('');
  const [token, setToken] = useState('');
  const [smsFrom, setSmsFrom] = useState('');
  const [testTo, setTestTo] = useState('');

  const load = () =>
    fetch('/api/providers')
      .then((r) => r.json())
      .then((d) => d.ok && setStatus(d))
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);

  const act = async (fn: () => Promise<Response>) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fn();
      const d = await r.json();
      setNote(d.ok ? '✓ Done.' : `Not saved: ${d.reason ?? 'something went wrong.'}`);
      await load();
    } catch {
      setNote('Not saved: could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const line = (s: ChannelStatus | undefined) =>
    !s
      ? '…'
      : s.ready
        ? `${s.provider}${s.source === 'settings' ? ` — connected here${s.hint ? `, key ending ${s.hint}` : ''}` : ' — configured by the server environment'}`
        : 'Not connected. Messages are held, and nothing is charged, until it is.';

  return (
    <div className="card card-pad">
      <h3 style={{ marginBottom: 4 }}>Sending services</h3>
      <p className="card-sub" style={{ marginBottom: 12 }}>
        Email and texting send through your own provider accounts. Keys are encrypted, never shown again, and apply
        immediately — the proof is the test message.
      </p>
      {status && !status.canStore && (
        <div className="notice warn" style={{ marginBottom: 10 }}>
          This server has no encryption key configured, so credentials cannot be stored safely from here.
        </div>
      )}

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div>
          <div style={{ fontWeight: 650, marginBottom: 4 }}>Email — Resend</div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 8 }}>{line(status?.email)}</div>
          <input className="input" placeholder="API key (re_…)" type="password" value={emailKey} onChange={(e) => setEmailKey(e.target.value)} style={{ marginBottom: 6 }} />
          <input className="input" placeholder="From — Summit Local <hello@yourdomain.com>" value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} style={{ marginBottom: 6 }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className="btn primary"
              disabled={busy || !emailKey || !emailFrom}
              onClick={() =>
                void act(() =>
                  fetch('/api/providers', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ channel: 'email', apiKey: emailKey, from: emailFrom }),
                  })
                ).then(() => setEmailKey(''))
              }
            >
              Save
            </button>
            {status?.email.source === 'settings' && (
              <button className="btn ghost" disabled={busy} onClick={() => void act(() => fetch('/api/providers?channel=email', { method: 'DELETE' }))}>
                Disconnect
              </button>
            )}
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            Deliverability lives in DNS: add your domain in Resend and copy the DKIM and SPF records it shows you into
            your DNS host. Their dashboard reports when verification passes — mail sent before that lands in spam.
          </p>
        </div>

        <div>
          <div style={{ fontWeight: 650, marginBottom: 4 }}>Texting — Twilio</div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 8 }}>{line(status?.sms)}</div>
          <input className="input" placeholder="Account SID (AC…)" value={sid} onChange={(e) => setSid(e.target.value)} style={{ marginBottom: 6 }} />
          <input className="input" placeholder="Auth token" type="password" value={token} onChange={(e) => setToken(e.target.value)} style={{ marginBottom: 6 }} />
          <input className="input" placeholder="From number (+15551234567)" value={smsFrom} onChange={(e) => setSmsFrom(e.target.value)} style={{ marginBottom: 6 }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className="btn primary"
              disabled={busy || !sid || !token || !smsFrom}
              onClick={() =>
                void act(() =>
                  fetch('/api/providers', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ channel: 'sms', accountSid: sid, authToken: token, from: smsFrom }),
                  })
                ).then(() => setToken(''))
              }
            >
              Save
            </button>
            {status?.sms.source === 'settings' && (
              <button className="btn ghost" disabled={busy} onClick={() => void act(() => fetch('/api/providers?channel=sms', { method: 'DELETE' }))}>
                Disconnect
              </button>
            )}
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            US marketing texts also need 10DLC registration (brand + campaign) inside Twilio — the rate card on Spend
            already prices it. Texts sent unregistered are filtered by carriers.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="you@example.com or +1555…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        <button
          className="btn"
          disabled={busy || !testTo}
          onClick={() =>
            void act(() =>
              fetch('/api/providers/test', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ channel: testTo.includes('@') ? 'email' : 'sms', to: testTo }),
              })
            )
          }
        >
          Send a test
        </button>
        <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
          Costs the same cent a campaign message would — the test uses the real path.
        </span>
      </div>
      {note && <div className={`notice ${note.startsWith('✓') ? 'success' : 'warn'}`} style={{ marginTop: 10 }}>{note}</div>}
    </div>
  );
}
