'use client';

import { useState } from 'react';
import { MediaThumb, SevIcon } from '@/components/ui';
import { Collapsible, CollapseAll } from '@/components/Collapsible';
import { BRANDS } from '@/lib/store';
import { useApp } from '@/lib/store';

export default function MediaPage() {
  const { state, dispatch, brandById } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const assets =
    state.activeBrandId === 'all' ? state.media : state.media.filter((m) => m.brandId === state.activeBrandId);
  const missingAlt = assets.filter((m) => m.kind === 'image' && !m.altText).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Media Library</h1>
          <div className="sub">
            Photos, videos, and logos shared across campaigns. Alternative text lives here once and follows the asset
            everywhere it’s used.
          </div>
        </div>
        <div className="actions">
          <button className="btn primary">Upload</button>
        </div>
      </div>

      {missingAlt > 0 && (
        <div className="warning-row warn" style={{ marginBottom: 14 }}>
          <span className="w-icon">
            <SevIcon severity="warn" />
          </span>
          <div>
            <div style={{ fontWeight: 650 }}>
              {missingAlt} image{missingAlt > 1 ? 's are' : ' is'} missing alternative text.
            </div>
            <div className="fix">Posts that use them will show a warning until it’s added — fix it once here.</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <CollapseAll prefix="media." count={BRANDS.length} />
      </div>

      {/* Grouped by business: 14 assets in one flat grid is a wall, and the
          question people actually ask is "what do I have for this business?" */}
      <div style={{ display: 'grid', gap: 10 }}>
        {BRANDS.filter((b) => assets.some((m) => m.brandId === b.id)).map((b) => {
          const owned = assets.filter((m) => m.brandId === b.id);
          const noAlt = owned.filter((m) => m.kind === 'image' && !m.altText).length;
          return (
            <Collapsible
              key={b.id}
              id={`media.${b.id}`}
              title={b.name}
              badge={<span className="pill neutral">{owned.length}</span>}
              summary={`${owned.length} assets${noAlt > 0 ? ` · ${noAlt} missing alt text` : ' · all have alt text'}`}
            >
              <div className="grid cols-4">
                {owned.map((m) => (
          <div key={m.id} className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <MediaThumb asset={m} ratio />
            <div>
              <div style={{ fontWeight: 650, fontSize: 12.5 }}>{m.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                {m.kind} · {m.aspectRatio}
                {m.durationSec ? ` · ${m.durationSec}s` : ''} · {(m.sizeKB / 1000).toFixed(1)} MB ·{' '}
                {brandById(m.brandId)?.name}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                {m.tags.map((t) => (
                  <span key={t} className="pill neutral">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            {m.kind !== 'video' && (
              <div style={{ fontSize: 11.5 }}>
                {editing === m.id ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="input"
                      style={{ fontSize: 11.5, padding: '4px 8px' }}
                      value={draft}
                      placeholder="Describe the image…"
                      onChange={(e) => setDraft(e.target.value)}
                      autoFocus
                    />
                    <button
                      className="btn sm primary"
                      disabled={!draft.trim()}
                      onClick={() => {
                        dispatch({ type: 'setAltText', mediaId: m.id, altText: draft.trim() });
                        setEditing(null);
                        setDraft('');
                      }}
                    >
                      Save
                    </button>
                  </div>
                ) : m.altText ? (
                  <span style={{ color: 'var(--ink-2)' }}>
                    <strong>Alt:</strong> {m.altText}{' '}
                    <button className="btn sm ghost" onClick={() => { setEditing(m.id); setDraft(m.altText ?? ''); }}>
                      Edit
                    </button>
                  </span>
                ) : (
                  <button className="btn sm" onClick={() => { setEditing(m.id); setDraft(''); }}>
                    + Add alt text
                  </button>
                )}
              </div>
            )}
          </div>
                ))}
              </div>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
