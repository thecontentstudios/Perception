'use client';

import { useEffect, useState } from 'react';

/**
 * Signup forms, and the number that says whether they work.
 *
 * The metric shown is **confirmed**, not sign-ups. A form with 200 sign-ups
 * and 12 confirmations is broken — almost always the confirmation email is not
 * arriving — and a bare sign-up count would report that as a triumph. Showing
 * both, with the gap named, is the difference between a dashboard and a tool.
 */

interface Form {
  id: string;
  name: string;
  slug: string;
  headline: string;
  consentText: string;
  askPhone: boolean;
  doubleOptIn: boolean;
  signups: number;
  confirmed: number;
}

export function FormsPanel() {
  const [forms, setForms] = useState<Form[]>([]);
  const [appUrl, setAppUrl] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('Newsletter');
  const [headline, setHeadline] = useState('Get our monthly tips');
  const [consentText, setConsentText] = useState(
    'Yes, email me occasional offers and tips. I can unsubscribe any time.'
  );
  const [askPhone, setAskPhone] = useState(false);
  const [smsConsentText, setSmsConsentText] = useState(
    'Yes, text me about bookings and offers. Message rates may apply. Reply STOP to opt out.'
  );
  const [doubleOptIn, setDoubleOptIn] = useState(true);

  const load = async () => {
    try {
      const data = await fetch('/api/forms').then((r) => r.json());
      if (data.ok) {
        setForms(data.forms);
        setAppUrl(data.appUrl);
      }
    } catch {
      /* the panel is still usable for creating one */
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/forms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, headline, consentText, askPhone, smsConsentText, doubleOptIn }),
      });
      const data = await res.json();
      if (data.ok) await load();
      else setError(data.reason ?? 'That did not work.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setCreating(false);
    }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section className="route-group" style={{ marginTop: 18 }}>
      <div className="rg-head">
        <h3>A form that keeps working</h3>
        <p>
          One link for a bio, a QR code or a counter card — and an embed for a site you can edit. Both collect the
          same consent and produce the same record.
        </p>
      </div>

      {loaded && forms.length > 0 && (
        <div className="forms-list">
          {forms.map((f) => {
            const url = `${appUrl}/f/${f.slug}`;
            const embed = `<script src="${appUrl}/p.js" data-form="${f.slug}" async></script>\n<div data-perception-form="${f.slug}"></div>`;
            const rate = f.signups > 0 ? Math.round((f.confirmed / f.signups) * 100) : null;
            return (
              <div key={f.id} className="form-card">
                <div className="fc-head">
                  <span className="fc-name">{f.name}</span>
                  {f.doubleOptIn ? (
                    <span className="pill approved">Confirms by email</span>
                  ) : (
                    <span className="pill review">Single opt-in</span>
                  )}
                  <span className="fc-counts">
                    <b>{f.confirmed.toLocaleString('en-US')}</b> confirmed of {f.signups.toLocaleString('en-US')}
                    {rate !== null && f.signups >= 10 && rate < 50 && (
                      <em className="fc-warn"> — {rate}% is low; check the confirmation email is arriving</em>
                    )}
                  </span>
                </div>

                <p className="fc-consent">&ldquo;{f.consentText}&rdquo;</p>

                <div className="fc-share">
                  <code className="mono">{url}</code>
                  <button className="btn" onClick={() => copy(url, `${f.id}-url`)}>
                    {copied === `${f.id}-url` ? 'Copied' : 'Copy link'}
                  </button>
                  <a className="btn" href={url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <button className="btn" onClick={() => copy(embed, `${f.id}-embed`)}>
                    {copied === `${f.id}-embed` ? 'Copied' : 'Copy embed'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <details className="card card-pad new-form">
        <summary>{forms.length === 0 ? 'Make your first form' : 'Make another form'}</summary>

        <div className="grid cols-2" style={{ marginTop: 12 }}>
          <label className="field">
            <span>Name it (only you see this)</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Headline people see</span>
            <input className="input" value={headline} onChange={(e) => setHeadline(e.target.value)} />
          </label>
        </div>

        <div className="field">
          <label htmlFor="consent">The sentence beside the checkbox</label>
          <textarea
            id="consent"
            className="textarea"
            rows={2}
            value={consentText}
            onChange={(e) => setConsentText(e.target.value)}
          />
          <span className="hint">
            Stored with every address this form collects. Write what you will actually do — &ldquo;occasional
            offers&rdquo; is a promise, and it is the one you will be held to.
          </span>
        </div>

        <div className="send-toggles">
          <label>
            <input type="checkbox" checked={askPhone} onChange={(e) => setAskPhone(e.target.checked)} />
            Also ask for a phone number
          </label>
          <label>
            <input type="checkbox" checked={doubleOptIn} onChange={(e) => setDoubleOptIn(e.target.checked)} />
            Confirm by email before subscribing
          </label>
        </div>

        {!doubleOptIn && (
          <p className="cost-flag" style={{ marginTop: 10 }}>
            Without confirmation your list fills with typos and addresses whose owners never asked. Both bounce, and
            bounces are what your delivery rate is scored on — so the bigger list usually reaches fewer people.
          </p>
        )}

        {askPhone && (
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="smsconsent">Separate wording for texts</label>
            <textarea
              id="smsconsent"
              className="textarea"
              rows={2}
              value={smsConsentText}
              onChange={(e) => setSmsConsentText(e.target.value)}
            />
            <span className="hint">
              Agreeing to emails is not agreeing to be texted. The difference is $500–$1,500 a message, so texts need
              their own box and their own sentence.
            </span>
          </div>
        )}

        {error && (
          <p className="send-result bad" style={{ marginTop: 10 }} role="alert">
            {error}
          </p>
        )}

        <button className="btn primary" style={{ marginTop: 12 }} disabled={creating} onClick={create}>
          {creating ? 'Creating…' : 'Create the form'}
        </button>
      </details>
    </section>
  );
}
