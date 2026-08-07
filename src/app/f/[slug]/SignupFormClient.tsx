'use client';

import { useState } from 'react';

/**
 * The form itself.
 *
 * Three things it does that a default form does not:
 *
 * - **The consent sentence is next to the checkbox and is not pre-ticked.**
 *   A pre-ticked box is not consent in any jurisdiction that has thought about
 *   it, and it is the single most common way a list becomes legally
 *   indefensible.
 * - **The honeypot is hidden from people and from screen readers**, so it
 *   catches bots without confusing anybody using assistive technology — the
 *   usual `display:none` on a labelled input is a field a screen reader
 *   announces and a person then tries to fill in.
 * - **It says what happens next.** "Check your inbox" is the difference
 *   between someone confirming and someone assuming they are done.
 */
export function SignupFormClient({
  slug,
  consentText,
  askPhone,
  smsConsentText,
  doubleOptIn,
}: {
  slug: string;
  consentText: string;
  askPhone: boolean;
  smsConsentText: string | null;
  doubleOptIn: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [smsAgreed, setSmsAgreed] = useState(false);
  const [hp, setHp] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setState('sending');
    try {
      const res = await fetch(`/api/forms/${slug}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, phone: askPhone ? phone : undefined, smsConsent: smsAgreed, hp }),
      });
      const data = await res.json();
      if (data.ok) setState('done');
      else {
        setError(data.reason ?? 'That did not go through.');
        setState('idle');
      }
    } catch {
      setError('Could not reach the server. Try again in a moment.');
      setState('idle');
    }
  };

  if (state === 'done') {
    return (
      <div className="hf-done" role="status">
        <p className="hf-done-title">Thanks — one more step.</p>
        <p>
          {doubleOptIn
            ? 'We have sent you an email. Open it and press confirm, and you are on the list.'
            : 'You are on the list. You can unsubscribe from any message we send.'}
        </p>
      </div>
    );
  }

  return (
    <form className="hf-form" onSubmit={submit}>
      <label className="hf-field">
        <span>Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </label>

      <label className="hf-field">
        <span>
          Email <em>required</em>
        </span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
        />
      </label>

      {askPhone && (
        <label className="hf-field">
          <span>Mobile number</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            inputMode="tel"
          />
        </label>
      )}

      {/* Off-screen rather than display:none, and hidden from assistive
          technology, so it catches bots without ever reaching a person. */}
      <div aria-hidden className="hf-hp">
        <label>
          Company website
          <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
        </label>
      </div>

      <label className="hf-consent">
        <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>{consentText}</span>
      </label>

      {askPhone && smsConsentText && (
        <label className="hf-consent">
          <input type="checkbox" checked={smsAgreed} onChange={(e) => setSmsAgreed(e.target.checked)} />
          <span>{smsConsentText}</span>
        </label>
      )}

      {error && (
        <p className="hf-error" role="alert">
          {error}
        </p>
      )}

      <button className="hf-submit" type="submit" disabled={state === 'sending' || !agreed}>
        {state === 'sending' ? 'Signing you up…' : 'Sign up'}
      </button>

      <p className="hf-note">
        {doubleOptIn
          ? 'We will email you to confirm. Nothing is sent until you do.'
          : 'You can unsubscribe from any message we send.'}
      </p>
    </form>
  );
}
