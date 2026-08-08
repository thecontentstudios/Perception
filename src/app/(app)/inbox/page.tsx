'use client';

import { useMemo, useState } from 'react';
import { Stars, UserChip } from '@/components/ui';
import { CHANNEL_META, ChannelIcon } from '@/lib/channels';
import { fmtDateTime } from '@/lib/dates';
import { useApp } from '@/lib/store';
import type { ConversationKind } from '@/lib/types';

const KIND_LABEL: Record<ConversationKind, string> = {
  comment: 'Comment',
  dm: 'Message',
  mention: 'Mention',
  review: 'Review',
  email_reply: 'Email reply',
};

const FILTERS: { key: ConversationKind | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'comment', label: 'Comments' },
  { key: 'dm', label: 'Messages' },
  { key: 'review', label: 'Reviews' },
  { key: 'mention', label: 'Mentions' },
  { key: 'email_reply', label: 'Email replies' },
];

export default function InboxPage() {
  const { state, dispatch, campaignById, brandById } = useApp();
  const [kind, setKind] = useState<ConversationKind | 'all'>('all');
  const [showDone, setShowDone] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sent, setSent] = useState<string | null>(null);

  const visible = useMemo(() => {
    const brandFiltered =
      state.activeBrandId === 'all'
        ? state.conversations
        : state.conversations.filter((c) => c.brandId === state.activeBrandId);
    return brandFiltered
      .filter((c) => (kind === 'all' ? true : c.kind === kind))
      .filter((c) => (showDone ? true : c.status !== 'done'))
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }, [state.conversations, state.activeBrandId, kind, showDone]);

  const selected = state.conversations.find((c) => c.id === selectedId) ?? visible[0] ?? null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <div className="sub">Comments, mentions, messages, reviews, and email replies from every connected channel — one queue.</div>
        </div>
      </div>

      <div className="cal-toolbar">
        <div className="seg" role="tablist" aria-label="Type filter">
          {FILTERS.map((f) => (
            <button key={f.key} className={kind === f.key ? 'on' : ''} onClick={() => setKind(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <button className={`btn sm ${showDone ? 'primary' : ''}`} onClick={() => setShowDone(!showDone)}>
          Show handled
        </button>
      </div>

      <div className="inbox-layout">
        <div className="card">
          <ul className="list-plain">
            {visible.map((c) => (
              <li key={c.id} className={`convo ${c.status === 'done' ? 'done' : ''}`}>
                <ChannelIcon channel={c.channel} size={18} />
                <div className="cv-body">
                  <div className="cv-top">
                    <button
                      className="cv-from"
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: selected?.id === c.id ? 'var(--accent)' : 'var(--ink)' }}
                      onClick={() => { setSelectedId(c.id); setSent(null); setReply(''); }}
                    >
                      {c.fromName}
                    </button>
                    <span className="pill neutral">{KIND_LABEL[c.kind]}</span>
                    {c.rating !== null && <Stars n={c.rating} />}
                    <span className="cv-time">{fmtDateTime(c.receivedAt)}</span>
                  </div>
                  <div className="cv-text">{c.excerpt}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>
                    {brandById(c.brandId)?.name}
                    {c.campaignId && <span>· {campaignById(c.campaignId)?.name}</span>}
                    {c.assigneeUserId && (
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        · assigned to <UserChip userId={c.assigneeUserId} size={16} />
                      </span>
                    )}
                    {c.status === 'replied' && <span>· replied</span>}
                  </div>
                </div>
                {c.status !== 'done' && (
                  <button className="btn sm ghost" title="Mark handled" onClick={() => dispatch({ type: 'conversationStatus', conversationId: c.id, status: 'done' })}>
                    ✓
                  </button>
                )}
              </li>
            ))}
            {visible.length === 0 && <li className="empty">Inbox zero. Enjoy it.</li>}
          </ul>
        </div>

        {selected && (
          <aside className="card card-pad">
            <div style={{ display: 'flex', gap: 9, alignItems: 'center', marginBottom: 8 }}>
              <ChannelIcon channel={selected.channel} size={18} />
              <div>
                <strong style={{ fontSize: 13 }}>{selected.fromName}</strong>
                <div className="card-sub">
                  {KIND_LABEL[selected.kind]} on {CHANNEL_META[selected.channel].label}
                  {selected.campaignId ? ` · ${campaignById(selected.campaignId)?.name}` : ''}
                </div>
              </div>
            </div>
            {selected.rating !== null && (
              <div style={{ marginBottom: 6 }}>
                <Stars n={selected.rating} />
              </div>
            )}
            <div className="warning-row info" style={{ marginBottom: 12 }}>
              <div>{selected.excerpt}</div>
            </div>
            <div className="field">
              <label htmlFor="reply">Reply as {brandById(selected.brandId)?.name}</label>
              <textarea
                id="reply"
                className="textarea"
                placeholder={
                  selected.kind === 'review'
                    ? 'Thank them by name, mention the specific job, invite them back…'
                    : 'Answer the question and include the campaign link if it helps…'
                }
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn primary"
                disabled={!reply.trim() || sending}
                onClick={() => {
                  // The reply actually goes out — a status with
                  // in_reply_to_id, a threaded Bluesky post, or a text
                  // through the same adapter campaigns use. The old version
                  // of this button flipped a flag and *claimed* it had sent.
                  setSending(true);
                  setSent(null);
                  fetch(`/api/inbox/${selected.id}/reply`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ text: reply }),
                  })
                    .then((r) => r.json())
                    .then((d) => {
                      if (d.ok) {
                        dispatch({ type: 'conversationStatus', conversationId: selected.id, status: 'replied' });
                        setSent(`Sent on ${selected.channel}.`);
                        setReply('');
                      } else {
                        setSent(`Not sent: ${d.reason ?? 'something went wrong.'}`);
                      }
                    })
                    .catch(() => setSent('Not sent: could not reach the server.'))
                    .finally(() => setSending(false));
                }}
              >
                {sending ? 'Sending…' : 'Send reply'}
              </button>
              <button className="btn" onClick={() => dispatch({ type: 'conversationStatus', conversationId: selected.id, status: 'done' })}>
                Mark handled
              </button>
            </div>
            {sent && (
              <div className={`notice ${sent.startsWith('Not sent') ? 'warn' : 'success'}`} style={{ marginTop: 10 }}>
                {sent.startsWith('Not sent') ? sent : `✓ ${sent}`}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
