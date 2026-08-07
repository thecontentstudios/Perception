'use client';

import { useState } from 'react';
import type { Brand } from '@/lib/types';

/**
 * Bringing a spreadsheet in, with the preview first.
 *
 * The button on `/contacts` said "Import CSV" and did nothing for four phases.
 * What it does now is deliberately two steps: a dry run that reports exactly
 * what would happen, and a separate commit. An import is close to impossible
 * to undo — a thousand rows merged into a live list cannot be picked apart
 * afterwards — so the shape of the interaction should match the shape of the
 * risk.
 */

interface Preview {
  headers: string[];
  mapping: string[];
  summary: {
    rows: number; newContacts: number; alreadyKnown: number; duplicatesInFile: number;
    suppressed: number; noAddress: number; badEmail: number; ragged: number;
  };
  sample: { line: number; name: string; email: string | null; phone: string | null; verdict: string; detail?: string }[];
  problems: { line: number; name: string; email: string | null; verdict: string; detail?: string }[];
  willSubscribe: number;
}

const VERDICT_LABEL: Record<string, string> = {
  ok: 'New',
  'already-known': 'Already on the list',
  'duplicate-in-file': 'Twice in this file',
  suppressed: 'Bounced before',
  'no-address': 'No email or phone',
  'bad-email': 'Unusable address',
};

export function ImportPanel({ brands }: { brands: Brand[] }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [brandId, setBrandId] = useState('');
  const [consentState, setConsentState] = useState<'pending' | 'subscribed'>('pending');
  const [evidence, setEvidence] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; merged: number } | null>(null);

  const read = async (file: File) => {
    setFileName(file.name);
    setCsv(await file.text());
    setPreview(null);
    setDone(null);
    setError(null);
  };

  const call = async (commit: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          csv,
          brandId: brandId || undefined,
          consentState,
          consentEvidence: evidence,
          commit,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.reason ?? 'That did not work.');
      } else if (commit) {
        setDone({ created: data.created, merged: data.merged });
        setPreview(null);
      } else {
        setPreview(data);
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="route-group" style={{ marginTop: 18 }}>
      <div className="rg-head">
        <h3>Import a spreadsheet</h3>
        <p>
          Nothing is written until you have seen what would happen. Column names are guessed and shown; addresses
          that bounced before are refused, because importing them again does not make them deliverable.
        </p>
      </div>

      <div className="card card-pad">
        <div className="import-controls">
          <label className="btn">
            {fileName ?? 'Choose a CSV file'}
            <input
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && read(e.target.files[0])}
            />
          </label>

          {brands.length > 0 && (
            <label className="field" style={{ marginBottom: 0, minWidth: 190 }}>
              <span>Which business</span>
              <select className="select" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                <option value="">Not assigned</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {csv && (
          <>
            {/* The consent question, asked properly. The permissive option
                costs a sentence of typing, which is the point: it is a claim
                the owner is making and it gets stored under their name. */}
            <div className="consent-choice">
              <label className={consentState === 'pending' ? 'on' : ''}>
                <input
                  type="radio"
                  checked={consentState === 'pending'}
                  onChange={() => setConsentState('pending')}
                />
                <span>
                  <b>Import as pending</b>
                  <em>
                    Nobody is emailed until they confirm. Safe for any list, and the only honest option for one you
                    did not collect yourself.
                  </em>
                </span>
              </label>
              <label className={consentState === 'subscribed' ? 'on' : ''}>
                <input
                  type="radio"
                  checked={consentState === 'subscribed'}
                  onChange={() => setConsentState('subscribed')}
                />
                <span>
                  <b>Import as subscribed</b>
                  <em>
                    Only if these people genuinely opted in. You will be asked to say how — that sentence is stored
                    with every address.
                  </em>
                </span>
              </label>
            </div>

            {consentState === 'subscribed' && (
              <div className="field" style={{ marginTop: 10 }}>
                <label htmlFor="evidence">How did these people agree?</label>
                <textarea
                  id="evidence"
                  className="textarea"
                  rows={2}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="e.g. Signed up at the counter on a paper form that says we email monthly offers, 2024–2026."
                />
                <span className="hint">
                  Stored against every address this import creates. If a mailbox provider or a customer asks why they
                  are on your list, this is the answer.
                </span>
              </div>
            )}

            <div className="import-actions">
              <button className="btn" disabled={busy} onClick={() => call(false)}>
                {busy ? 'Reading…' : 'Preview'}
              </button>
              {preview && (
                <button className="btn primary" disabled={busy} onClick={() => call(true)}>
                  Import {preview.summary.newContacts} new
                  {preview.summary.alreadyKnown > 0 ? `, update ${preview.summary.alreadyKnown}` : ''}
                </button>
              )}
            </div>
          </>
        )}

        {error && (
          <p className="send-result bad" style={{ margin: '12px 0 0' }} role="alert">
            {error}
          </p>
        )}

        {done && (
          <p className="send-result good" style={{ margin: '12px 0 0' }} role="status">
            Imported. {done.created} new {done.created === 1 ? 'contact' : 'contacts'}
            {done.merged > 0 ? `, ${done.merged} merged into people you already had` : ''}.
          </p>
        )}

        {preview && (
          <div className="import-preview">
            <div className="ip-summary">
              <Stat n={preview.summary.newContacts} label="new" tone="good" />
              <Stat n={preview.summary.alreadyKnown} label="already known" />
              <Stat n={preview.summary.duplicatesInFile} label="twice in the file" />
              <Stat n={preview.summary.suppressed} label="bounced before" tone={preview.summary.suppressed ? 'bad' : undefined} />
              <Stat n={preview.summary.noAddress} label="no address" />
              <Stat n={preview.summary.badEmail} label="unusable" tone={preview.summary.badEmail ? 'bad' : undefined} />
            </div>

            <div className="ip-mapping">
              <span className="ip-label">Columns read as</span>
              {preview.headers.map((h, i) => (
                <span key={h + i} className={`ip-col ${preview.mapping[i] === 'ignore' ? 'off' : ''}`}>
                  {h} <b>{preview.mapping[i]}</b>
                </span>
              ))}
            </div>

            {preview.summary.ragged > 0 && (
              <p className="cost-flag" style={{ marginTop: 10 }}>
                {preview.summary.ragged} row{preview.summary.ragged === 1 ? ' has' : 's have'} a different number of
                columns than the header. Usually an unescaped comma — worth checking before importing.
              </p>
            )}

            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((r) => (
                    <tr key={r.line}>
                      <td className="muted">{r.line}</td>
                      <td>{r.name || <span className="muted">—</span>}</td>
                      <td>{r.email ?? <span className="muted">—</span>}</td>
                      <td>
                        <span className={`ip-verdict ${r.verdict}`}>{VERDICT_LABEL[r.verdict] ?? r.verdict}</span>
                        {r.detail && <span className="ip-detail">{r.detail}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.summary.rows > preview.sample.length && (
              <p className="hint" style={{ marginTop: 8 }}>
                Showing the first {preview.sample.length} of {preview.summary.rows} rows.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'good' | 'bad' }) {
  return (
    <span className={`ip-stat ${tone ?? ''} ${n === 0 ? 'zero' : ''}`}>
      <b>{n.toLocaleString('en-US')}</b> {label}
    </span>
  );
}
