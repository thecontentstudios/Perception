'use client';

import { useEffect, useState } from 'react';

/**
 * Sign in.
 *
 * Deliberately plain. The one design decision worth stating is that the error
 * message never distinguishes "no such account" from "wrong password" — the
 * server refuses to, and echoing anything more specific here would undo that.
 */
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoHint, setDemoHint] = useState<string | null>(null);

  useEffect(() => {
    // Only shown when the server says it is running the sample workspace, so
    // a real deployment never advertises a default password.
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => {
        if (h.status !== 'ok') setDemoHint(null);
      })
      .catch(() => {});
    if (process.env.NODE_ENV !== 'production') {
      setDemoHint('Seeded demo: dana@summitlocal.example / demo-password-change-me');
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.reason ?? 'Could not sign in.');
        return;
      }
      // Full reload rather than a router push: the whole app hydrates from
      // /api/workspace, and it needs to do that as the newly signed-in user.
      window.location.href = '/';
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}>
      <div className="card card-pad" style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span
            aria-hidden
            style={{
              width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center',
              background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: '#fff', fontWeight: 800,
            }}
          >
            P
          </span>
          <div>
            <div style={{ fontWeight: 700 }}>Perception</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Campaign operating system</div>
          </div>
        </div>

        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="section-label">Email</span>
            <input
              className="input"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="section-label">Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && (
            <div className="warning-row block" role="alert">
              <div>{error}</div>
            </div>
          )}

          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {demoHint && (
          <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--muted)' }}>{demoHint}</div>
        )}
      </div>
    </div>
  );
}
