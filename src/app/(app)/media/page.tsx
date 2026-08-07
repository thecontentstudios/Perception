'use client';

import { useRef, useState } from 'react';
import { MediaThumb, SevIcon } from '@/components/ui';
import { Collapsible, CollapseAll } from '@/components/Collapsible';
import { BRANDS } from '@/lib/store';
import { useApp } from '@/lib/store';

export default function MediaPage() {
  const { state, dispatch, source, brandById } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Upload for real when there's somewhere to put it.
   *
   * The response says what the pipeline changed on the way in — EXIF removed,
   * photo resized — and that gets shown rather than swallowed. Silently
   * altering someone's file is the kind of thing that erodes trust slowly.
   */
  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadNote(null);
    try {
      const notes: string[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        if (state.activeBrandId !== 'all') form.append('brandId', state.activeBrandId);
        const res = await fetch('/api/media', { method: 'POST', body: form });
        const d = await res.json();
        if (!d.ok) {
          setUploadNote({ ok: false, text: `${file.name}: ${d.reason}` });
          return;
        }
        notes.push(
          d.stripped.length > 0
            ? `${file.name} — ${d.stripped.join(', ')} removed`
            : `${file.name} added`
        );
      }
      // Reload rather than patch: the server assigned the ids.
      const w = await fetch('/api/workspace').then((r) => r.json());
      if (w.source === 'database') dispatch({ type: 'hydrate', workspace: w.workspace });
      setUploadNote({ ok: true, text: notes.join(' · ') });
    } catch (e) {
      setUploadNote({ ok: false, text: (e as Error).message });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

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
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*,video/mp4,video/quicktime"
            style={{ display: 'none' }}
            onChange={(e) => upload(e.target.files)}
          />
          <button
            className="btn primary"
            disabled={uploading || source !== 'database'}
            title={source === 'database' ? undefined : 'Uploading needs a database connected — see the README.'}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>

      {uploadNote && (
        <div className={`warning-row ${uploadNote.ok ? 'info' : 'block'}`} style={{ marginBottom: 14 }} role="status">
          <div>
            {uploadNote.ok ? (
              <>
                <strong>Uploaded.</strong> {uploadNote.text}.{' '}
                {/* Say what happened to their file, and why. */}
                Location data is always removed before anything publishes.
              </>
            ) : (
              <><strong>Upload failed.</strong> {uploadNote.text}</>
            )}
          </div>
        </div>
      )}

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
        <CollapseAll prefix="media." count={BRANDS.length + 1} />
      </div>

      {/* Grouped by business: 14 assets in one flat grid is a wall, and the
          question people actually ask is "what do I have for this business?" */}
      <div style={{ display: 'grid', gap: 10 }}>
        {/* Unassigned first, and only when there are any. An upload made while
            "All businesses" is selected has no brand, and grouping strictly by
            brand made it invisible — the file was in the library and the owner
            could never find it. A group they have to look at is better than a
            file that quietly disappears. */}
        {[
          ...(assets.some((m) => !m.brandId)
            ? [{ id: '__unassigned', name: 'Not assigned to a business yet' }]
            : []),
          ...BRANDS.filter((b) => assets.some((m) => m.brandId === b.id)),
        ].map((b) => {
          const owned =
            b.id === '__unassigned'
              ? assets.filter((m) => !m.brandId)
              : assets.filter((m) => m.brandId === b.id);
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
