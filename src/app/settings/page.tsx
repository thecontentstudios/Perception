'use client';

import { UserChip } from '@/components/ui';
import { fmtDateTime } from '@/lib/dates';
import { ORG, USERS, useApp } from '@/lib/store';

const ROLE_NOTES: [string, string][] = [
  ['Owner', 'Everything, including billing, deletion, and data export'],
  ['Administrator', 'Manage team, connections, and all campaigns'],
  ['Manager', 'Create, approve, and schedule across brands'],
  ['Creator', 'Draft content; cannot publish without approval'],
  ['Approver', 'Review and approve; client-safe view'],
  ['Analyst', 'Read-only analytics and reports'],
  ['Client / guest reviewer', 'Sees only what’s shared for review'],
];

export default function SettingsPage() {
  const { state } = useApp();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">{ORG.name} workspace · {ORG.plan} plan · {ORG.brandIds.length} businesses</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h3>Team</h3>
            <span className="card-sub">Roles keep publishing safe: creators draft, approvers approve, publishing is audited.</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Two-factor</th>
              </tr>
            </thead>
            <tbody>
              {USERS.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      <UserChip userId={u.id} />
                      <span>
                        <div style={{ fontWeight: 650 }}>{u.name}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 11 }}>{u.email}</div>
                      </span>
                    </span>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{u.role}</td>
                  <td>
                    {u.twoFactorEnabled ? (
                      <span className="pill published">Enabled</span>
                    ) : (
                      <span className="pill review">Nudge sent</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card card-pad">
          <h3 style={{ marginBottom: 8 }}>Roles</h3>
          <dl className="kv">
            {ROLE_NOTES.map(([role, note]) => (
              <div key={role} style={{ display: 'contents' }}>
                <dt>{role}</dt>
                <dd>{note}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="card card-pad">
          <h3 style={{ marginBottom: 8 }}>Approvals & safety</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-2)', fontSize: 12.5, display: 'grid', gap: 6 }}>
            <li>Campaigns for <strong>Harborview Rentals</strong> require client approval (Jordan Lee) before scheduling.</li>
            <li>Emails cannot send without an unsubscribe footer and verified sender domain.</li>
            <li>Bulk publishing and bulk deletion always ask for confirmation.</li>
            <li>Platform tokens are encrypted at rest; permissions requested are the minimum each API needs.</li>
            <li>Every publish, approval, and connection change lands in the audit log below.</li>
          </ul>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn sm">Export workspace data</button>
            <button className="btn sm danger">Delete workspace…</button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Audit log</h3>
            <span className="card-sub">Who did what, when — including the system.</span>
          </div>
          <table className="table">
            <tbody>
              {state.audit.slice(0, 8).map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDateTime(e.at)}</td>
                  <td>
                    <div style={{ fontWeight: 650 }}>
                      {e.action} — {e.target}
                    </div>
                    <div style={{ color: 'var(--ink-2)', fontSize: 12 }}>{e.detail}</div>
                  </td>
                  <td>{e.actorUserId ? <UserChip userId={e.actorUserId} /> : <span className="pill neutral">system</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
