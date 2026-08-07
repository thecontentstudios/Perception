'use client';

import { useEffect, useState } from 'react';
import { TODAY, useApp } from '@/lib/store';
import { adapterFor } from '@/lib/connectors/registry';
import { remediate, type RemediableWarning } from '@/lib/remediate';
import { CHANNEL_META } from '@/lib/channels';
import { dateKeyOf, fmtDateTime, timeOf } from '@/lib/dates';
import { useResizable } from '@/lib/use-ui';
import type { ChannelVariation } from '@/lib/types';
import { STATUS_LABEL, StatusPill, WarningsList } from './ui';
import { PlatformPreview } from './PlatformPreview';

/**
 * The side-panel editor: edit a channel variation without leaving the
 * calendar. Edits apply live; the safeguard checks re-run on every change.
 */
export function VariationEditor({ variationId, onClose }: { variationId: string; onClose: () => void }) {
  const { state, dispatch, campaignById, brandById, itemById, assetsFor, preflightFor } = useApp();
  const { size: width, dragging, handleProps } = useResizable({
    key: 'perception.panel.width',
    initial: 460,
    min: 380,
    max: 900,
    edge: 'left',
  });

  // Escape closes the panel; the resize drag paints a global cursor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    document.body.classList.toggle('resizing', dragging);
    return () => document.body.classList.remove('resizing');
  }, [dragging]);

  const v = state.variations.find((x) => x.id === variationId);
  if (!v) return null;
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixNote, setFixNote] = useState<string | null>(null);
  const campaign = campaignById(v.campaignId);
  const brand = campaign ? brandById(campaign.brandId) : undefined;
  const item = itemById(v.contentItemId);
  if (!campaign || !brand) return null;

  const rawWarnings = preflightFor(v);
  const blocked = rawWarnings.some((w) => w.severity === 'block');

  /**
   * Attach a fix to each warning that has one. The capability sheet supplies
   * the limits, so the offered fix always targets *this* destination's rules
   * rather than a generic guess.
   */
  const caps = adapterFor(v.channel).capabilities;
  const warnings = remediate(rawWarnings, {
    variation: v,
    assets: assetsFor(v),
    caps: {
      maxChars: caps.maxChars,
      maxHashtags: caps.maxHashtags,
      maxVideoSec: caps.maxVideoSec,
      allowedRatios: caps.allowedRatios,
    },
    campaignCta: campaign.cta,
    today: TODAY,
  });

  /**
   * Apply a fix. Optimistic like every other mutation, then reconciled — but
   * media fixes come back with a new asset id the client cannot predict, so
   * those reload the workspace rather than guessing.
   */
  const applyFix = async (w: RemediableWarning) => {
    if (!w.remedy) return;
    setFixing(w.id);
    setFixNote(null);
    try {
      const res = await fetch('/api/remediate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: w.remedy.kind,
          variationId: v.id,
          assetId: w.remedy.assetId,
          params: w.remedy.params,
        }),
      });
      const d = await res.json();
      if (!d.ok) {
        setFixNote(d.reason);
        return;
      }
      // Pull the workspace back rather than patching locally: a crop creates a
      // row, and a client-side guess at its id would be wrong.
      const w2 = await fetch('/api/workspace').then((r) => r.json());
      if (w2.source === 'database') dispatch({ type: 'hydrate', workspace: w2.workspace });
      setFixNote(null);
    } catch (e) {
      setFixNote((e as Error).message);
    } finally {
      setFixing(null);
    }
  };
  const patch = (p: Partial<ChannelVariation>) => dispatch({ type: 'updateVariation', variationId: v.id, patch: p });

  const dateVal = v.scheduledAt ? dateKeyOf(v.scheduledAt) : '';
  const timeVal = v.scheduledAt ? timeOf(v.scheduledAt) : '';

  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden />
      <aside
        className="side-panel"
        aria-label="Edit content"
        style={{ width: `min(${width}px, 96vw)` }}
      >
        <button className={`resizer ${dragging ? 'dragging' : ''}`} {...handleProps} />
        <div className="sp-head">
          <div>
            <h3 style={{ fontSize: 14.5 }}>{item?.title}</h3>
            <div className="card-sub">
              {campaign.name} · {CHANNEL_META[v.channel].label}
              {v.overridden && ' · customized for this channel'}
            </div>
          </div>
          <span style={{ marginLeft: 'auto' }}>
            <StatusPill status={v.status} />
          </span>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close editor">
            ✕
          </button>
        </div>

        <div className="sp-body">
          <PlatformPreview variation={v} assets={assetsFor(v)} brand={brand} />

          <div className="section-label">Checks before publishing</div>
          <WarningsList warnings={warnings} onFix={applyFix} busy={fixing} />
          {fixNote && (
            <div className="warning-row block" role="alert">
              <div><strong>Could not apply that fix.</strong> {fixNote}</div>
            </div>
          )}

          <div className="section-label">Edit this version</div>
          {v.channel === 'email' && (
            <>
              <div className="field">
                <label htmlFor="ve-subject">Subject</label>
                <input id="ve-subject" className="input" value={v.subject ?? ''} onChange={(e) => patch({ subject: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ve-preheader">Preview text</label>
                <input id="ve-preheader" className="input" value={v.preheader ?? ''} onChange={(e) => patch({ preheader: e.target.value })} />
              </div>
              <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  id="ve-footer"
                  type="checkbox"
                  checked={v.hasUnsubscribeFooter}
                  onChange={(e) => patch({ hasUnsubscribeFooter: e.target.checked })}
                />
                <label htmlFor="ve-footer" style={{ marginBottom: 0 }}>
                  Include unsubscribe footer (required to send)
                </label>
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="ve-body">{v.channel === 'email' ? 'Email body' : 'Text'}</label>
            <textarea id="ve-body" className="textarea" value={v.body} onChange={(e) => patch({ body: e.target.value })} />
            <span className="hint">
              {v.body.length.toLocaleString()} characters
              {v.overridden ? ' · this channel no longer follows the shared campaign message' : ''}
            </span>
          </div>
          <div className="field">
            <label htmlFor="ve-cta">Call to action</label>
            <input
              id="ve-cta"
              className="input"
              value={v.cta?.label ?? ''}
              placeholder={`e.g. ${campaign.cta.label}`}
              onChange={(e) =>
                patch({ cta: e.target.value ? { label: e.target.value, url: v.cta?.url ?? campaign.cta.url } : null })
              }
            />
          </div>
          <div className="field">
            <label>Scheduled for</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="date"
                className="input"
                style={{ width: 'auto' }}
                value={dateVal}
                aria-label="Date"
                onChange={(e) =>
                  dispatch({
                    type: 'setScheduledAt',
                    variationId: v.id,
                    scheduledAt: e.target.value ? `${e.target.value}T${timeVal || '12:00'}` : null,
                  })
                }
              />
              <input
                type="time"
                className="input"
                style={{ width: 'auto' }}
                value={timeVal}
                aria-label="Time"
                onChange={(e) =>
                  dateVal && dispatch({ type: 'setScheduledAt', variationId: v.id, scheduledAt: `${dateVal}T${e.target.value}` })
                }
              />
            </div>
            {v.scheduledAt && <span className="hint">{fmtDateTime(v.scheduledAt)}</span>}
          </div>

          {v.failure && (
            <>
              <div className="section-label">Publish failure</div>
              <div className="warning-row block">
                <div>
                  <div style={{ fontWeight: 650 }}>{v.failure.message}</div>
                  <div className="fix">
                    {v.failure.attempts} attempts · last tried {fmtDateTime(v.failure.lastTriedAt)} ·{' '}
                    {v.failure.willRetry ? 'automatic retries continue' : 'automatic retries stopped'}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="sp-foot">
          {(v.status === 'idea' || v.status === 'draft') && (
            <button className="btn" onClick={() => dispatch({ type: 'setStatus', variationId: v.id, status: 'review' })}>
              Submit for review
            </button>
          )}
          {(v.status === 'draft' || v.status === 'review') && (
            <button
              className="btn primary"
              disabled={blocked}
              title={blocked ? 'Fix the blocking issues first' : undefined}
              onClick={() => dispatch({ type: 'setStatus', variationId: v.id, status: 'approved' })}
            >
              Approve
            </button>
          )}
          {v.status === 'review' && (
            <button className="btn" onClick={() => dispatch({ type: 'setStatus', variationId: v.id, status: 'draft' })}>
              Request changes
            </button>
          )}
          {v.status === 'approved' && (
            <button
              className="btn primary"
              disabled={blocked || !v.scheduledAt}
              title={blocked ? 'Fix the blocking issues first' : !v.scheduledAt ? 'Pick a time first' : undefined}
              onClick={() => dispatch({ type: 'setStatus', variationId: v.id, status: 'scheduled' })}
            >
              Schedule
            </button>
          )}
          {v.status === 'scheduled' && (
            <button className="btn" onClick={() => dispatch({ type: 'setStatus', variationId: v.id, status: 'approved' })}>
              Unschedule
            </button>
          )}
          {v.status === 'failed' && (
            <button className="btn primary" onClick={() => dispatch({ type: 'retryFailed', variationId: v.id })}>
              Retry now
            </button>
          )}
          <button className="btn" onClick={() => dispatch({ type: 'duplicateVariation', variationId: v.id })}>
            Duplicate
          </button>
          <span style={{ marginLeft: 'auto', alignSelf: 'center', color: 'var(--muted)', fontSize: 11 }}>
            {STATUS_LABEL[v.status]}
          </span>
        </div>
      </aside>
    </>
  );
}
