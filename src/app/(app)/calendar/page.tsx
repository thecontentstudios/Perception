'use client';

import { useMemo, useState } from 'react';
import { CalendarCard } from '@/components/CalendarCard';
import { VariationEditor } from '@/components/VariationEditor';
import { CampaignSwatch, StatusPill, UserChip, WarnBadge } from '@/components/ui';
import { ALL_CHANNELS, CHANNEL_META, ChannelIcon } from '@/lib/channels';
import {
  addDays, addMonths, dayOfMonth, dayShortName, fmtMonthYear, fmtShort, fmtTime,
  isSameMonth, monthGrid, weekOf,
} from '@/lib/dates';
import { byDay, TODAY, useApp } from '@/lib/store';
import { useAnnouncer, usePersisted } from '@/lib/use-ui';
import { fmtDate } from '@/lib/dates';
import type { ChannelVariation } from '@/lib/types';

type View = 'month' | 'week' | 'lanes' | 'list';

export default function CalendarPage() {
  const { visibleVariations, campaignById, itemById, preflightFor, dispatch } = useApp();
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(TODAY);
  const [selected, setSelected] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [approvalsOnly, setApprovalsOnly] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [ideasHidden, setIdeasHidden] = usePersisted('perception.calendar.ideasHidden', false);
  const [announcement, announce] = useAnnouncer();

  const filtered = useMemo(
    () => (approvalsOnly ? visibleVariations.filter((v) => v.status === 'review') : visibleVariations),
    [visibleVariations, approvalsOnly]
  );
  const dayMap = useMemo(() => byDay(filtered), [filtered]);
  const unscheduled = visibleVariations.filter((v) => !v.scheduledAt);

  const dropHandlers = (dateKey: string) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDropDay(dateKey);
    },
    onDragLeave: () => setDropDay((d) => (d === dateKey ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      if (id) {
        const moved = visibleVariations.find((v) => v.id === id);
        dispatch({ type: 'reschedule', variationId: id, dateKey });
        announce(`Moved ${itemById(moved?.contentItemId ?? '')?.title ?? 'item'} to ${fmtDate(dateKey)}.`);
      }
      setDropDay(null);
      setDraggingId(null);
    },
  });

  const cardProps = (v: ChannelVariation) => ({
    variation: v,
    onOpen: setSelected,
    onDragStart: setDraggingId,
    onDragEnd: () => setDraggingId(null),
    dragging: draggingId === v.id,
  });

  const weekDays = weekOf(anchor);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <div className="sub">Every scheduled item in one place. Drag a card to reschedule it; click to edit without leaving the calendar.</div>
        </div>
      </div>

      <div className="cal-toolbar">
        <div className="seg" role="tablist" aria-label="Calendar view">
          {(['month', 'week', 'lanes', 'list'] as View[]).map((w) => (
            <button key={w} className={view === w ? 'on' : ''} onClick={() => setView(w)}>
              {w === 'lanes' ? 'Platform lanes' : w[0].toUpperCase() + w.slice(1)}
            </button>
          ))}
        </div>
        <div className="seg">
          <button onClick={() => setAnchor(view === 'month' ? addMonths(anchor, -1) : addDays(anchor, -7))} aria-label="Previous">
            ‹
          </button>
          <button className="on" onClick={() => setAnchor(TODAY)}>
            Today
          </button>
          <button onClick={() => setAnchor(view === 'month' ? addMonths(anchor, 1) : addDays(anchor, 7))} aria-label="Next">
            ›
          </button>
        </div>
        <h2 style={{ fontSize: 15 }}>{view === 'month' ? fmtMonthYear(anchor) : `Week of ${fmtShort(weekDays[0])}`}</h2>
        <span style={{ flex: 1 }} />
        <button className={`btn sm ${approvalsOnly ? 'primary' : ''}`} onClick={() => setApprovalsOnly(!approvalsOnly)}>
          Needs approval {approvalsOnly ? '· on' : ''}
        </button>
        {view !== 'list' && (
          <button
            className="btn sm"
            onClick={() => setIdeasHidden(!ideasHidden)}
            aria-expanded={!ideasHidden}
            title={ideasHidden ? 'Show the unscheduled ideas rail' : 'Hide the rail and widen the calendar'}
          >
            {ideasHidden ? '‹ Show ideas' : 'Hide ideas ›'}
            {unscheduled.length > 0 && <span className="pill neutral">{unscheduled.length}</span>}
          </button>
        )}
      </div>

      {/* Drag results have no focus change — announce them politely. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      <div className={view === 'list' ? '' : `cal-layout ${ideasHidden ? 'railed' : ''}`}>
        <div>
          {view === 'month' && (
            <div className="cal-month">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="cal-dow">
                  {d}
                </div>
              ))}
              {monthGrid(anchor)
                .flat()
                .map((dateKey) => {
                  const cards = dayMap.get(dateKey) ?? [];
                  const shown = cards.slice(0, 3);
                  return (
                    <div
                      key={dateKey}
                      className={`cal-day ${isSameMonth(dateKey, anchor) ? '' : 'dim'} ${dateKey === TODAY ? 'today' : ''} ${dropDay === dateKey ? 'drop' : ''}`}
                      data-date={dateKey}
                      {...dropHandlers(dateKey)}
                    >
                      <span className="dnum">
                        {dayOfMonth(dateKey)}
                        {dateKey === TODAY && <span className="today-tag">Today</span>}
                      </span>
                      {shown.map((v) => (
                        <CalendarCard key={v.id} dense {...cardProps(v)} />
                      ))}
                      {cards.length > 3 && (
                        <button
                          className="cal-more"
                          style={{ background: 'none', border: 'none', textAlign: 'left' }}
                          onClick={() => {
                            setAnchor(dateKey);
                            setView('week');
                          }}
                        >
                          +{cards.length - 3} more
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {view === 'week' && (
            <div className="cal-week">
              {weekDays.map((dateKey) => (
                <div key={dateKey} className={`wk-col ${dropDay === dateKey ? 'drop' : ''}`} {...dropHandlers(dateKey)}>
                  <div className="wk-head">
                    {dayShortName(dateKey)} <span className="d">{dayOfMonth(dateKey)}</span>
                    {dateKey === TODAY && <span className="today-tag" style={{ background: 'var(--accent)', color: '#fff', borderRadius: 99, padding: '0 6px', fontSize: 9.5, marginLeft: 6 }}>Today</span>}
                  </div>
                  {(dayMap.get(dateKey) ?? []).map((v) => (
                    <CalendarCard key={v.id} {...cardProps(v)} />
                  ))}
                </div>
              ))}
            </div>
          )}

          {view === 'lanes' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="lane">
                <div className="lane-label" style={{ background: 'transparent' }} />
                <div className="lane-days">
                  {weekDays.map((d) => (
                    <div
                      key={d}
                      className="lane-cell"
                      style={{ minHeight: 0, fontWeight: 700, fontSize: 11, color: d === TODAY ? 'var(--accent)' : 'var(--muted)' }}
                    >
                      {dayShortName(d)} {dayOfMonth(d)}
                    </div>
                  ))}
                </div>
              </div>
              {ALL_CHANNELS.filter((ch) => filtered.some((v) => v.channel === ch)).map((ch) => (
                <div key={ch} className="lane">
                  <div className="lane-label">
                    <ChannelIcon channel={ch} size={16} /> {CHANNEL_META[ch].label}
                  </div>
                  <div className="lane-days">
                    {weekDays.map((d) => (
                      <div key={d} className={`lane-cell ${dropDay === d ? 'drop' : ''}`} {...dropHandlers(d)}>
                        {(dayMap.get(d) ?? [])
                          .filter((v) => v.channel === ch)
                          .map((v) => (
                            <CalendarCard key={v.id} dense {...cardProps(v)} />
                          ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === 'list' && (
            <div className="card">
              <div className="card-head">
                <h3>
                  {approvalsOnly ? 'Waiting for approval' : 'All scheduled items'} ·{' '}
                  {filtered.filter((v) => v.scheduledAt).length}
                </h3>
                <div className="right">
                  <button
                    className="btn sm"
                    disabled={checked.size === 0}
                    onClick={() => {
                      dispatch({ type: 'bulkSetStatus', variationIds: [...checked], status: 'approved' });
                      setChecked(new Set());
                    }}
                  >
                    Approve selected ({checked.size})
                  </button>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 30 }} aria-label="Select" />
                      <th>When</th>
                      <th>Content</th>
                      <th>Campaign</th>
                      <th>Channel</th>
                      <th>Status</th>
                      <th>Checks</th>
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered
                      .filter((v) => v.scheduledAt)
                      .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1))
                      .map((v) => {
                        const c = campaignById(v.campaignId);
                        return (
                          <tr key={v.id} className="rowlink" onClick={() => setSelected(v.id)}>
                            <td onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                aria-label="Select row"
                                checked={checked.has(v.id)}
                                onChange={(e) => {
                                  const next = new Set(checked);
                                  if (e.target.checked) next.add(v.id);
                                  else next.delete(v.id);
                                  setChecked(next);
                                }}
                              />
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {fmtShort(v.scheduledAt!.slice(0, 10))} · {fmtTime(v.scheduledAt!)}
                            </td>
                            <td style={{ fontWeight: 600 }}>{itemById(v.contentItemId)?.title}</td>
                            <td>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <CampaignSwatch colorIndex={c?.colorIndex ?? 0} /> {c?.name}
                              </span>
                            </td>
                            <td>
                              <span className="channel-chip">
                                <ChannelIcon channel={v.channel} size={15} /> {CHANNEL_META[v.channel].short}
                              </span>
                            </td>
                            <td>
                              <StatusPill status={v.status} />
                            </td>
                            <td>
                              <WarnBadge warnings={preflightFor(v)} />
                            </td>
                            <td>
                              <UserChip userId={v.assigneeUserId} />
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {view !== 'list' && (
          <aside className="card ideas-panel">
            <div className="card-head">
              <h3>Unscheduled ideas</h3>
              <span className="card-sub">{unscheduled.length}</span>
            </div>
            <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {unscheduled.length === 0 && <div className="empty">Nothing waiting — nice.</div>}
              {unscheduled.map((v) => (
                <div
                  key={v.id}
                  className="idea-card"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', v.id);
                    setDraggingId(v.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                >
                  <ChannelIcon channel={v.channel} size={15} />
                  <button
                    style={{ background: 'none', border: 'none', textAlign: 'left', flex: 1, fontWeight: 600, padding: 0 }}
                    onClick={() => setSelected(v.id)}
                  >
                    {itemById(v.contentItemId)?.title}
                  </button>
                  <StatusPill status={v.status} />
                </div>
              ))}
              <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>Drag an idea onto a day to schedule it.</div>
            </div>
          </aside>
        )}
      </div>

      {selected && <VariationEditor variationId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
