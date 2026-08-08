import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { handle, require_ } from '@/lib/auth/guard';
import { orgSendingStatus } from '@/lib/senders/registry';
import { summaries } from '@/lib/oauth/store';

export const dynamic = 'force-dynamic';

/**
 * Where this workspace stands, as a checklist an owner can act on.
 *
 * Every row is computed from the same state the product runs on — the
 * sender resolution, the OAuth grants, the actual tables — never from a
 * stored "onboarding step completed" flag, because a flag can say done
 * while the thing it describes has broken since. Disconnect your email
 * provider and the checklist reopens, which is the point.
 */
export async function GET() {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('read');
    const orgId = principal.organizationId;

    const [email, sms, contacts, hasSend, forms, snippetSeen, social] = await Promise.all([
      orgSendingStatus(orgId, 'email'),
      orgSendingStatus(orgId, 'sms'),
      db.contact.count({ where: { organizationId: orgId } }),
      db.messageBatch.findFirst({ where: { organizationId: orgId }, select: { id: true } }),
      db.signupForm.count({ where: { organizationId: orgId } }),
      // The snippet has phoned home if any click or conversion ever arrived.
      db.conversion
        .findFirst({ where: { organizationId: orgId }, select: { id: true } })
        .then(async (c) => c ?? db.linkClick.findFirst({ where: { link: { campaign: { organizationId: orgId } } }, select: { id: true } })),
      Promise.resolve(summaries().length),
    ]);

    const steps = [
      {
        id: 'email',
        label: 'Connect email sending',
        done: email.ready,
        detail: email.ready ? email.why : 'Campaigns and confirmations hold until this exists.',
        href: '/settings',
      },
      {
        id: 'sms',
        label: 'Connect texting',
        done: sms.ready,
        detail: sms.ready ? sms.why : 'Optional — but the pathway prices it, and quotes assume it.',
        href: '/settings',
      },
      {
        id: 'social',
        label: 'Connect a social account',
        done: social > 0,
        detail: social > 0 ? `${social} connected.` : 'Bluesky connects in two minutes with an app password — no review queue.',
        href: '/connections',
      },
      {
        id: 'audience',
        label: 'Bring your list',
        done: contacts > 0,
        detail: contacts > 0 ? `${contacts.toLocaleString('en-US')} contacts.` : 'Import a CSV or put a signup form on your site.',
        href: '/grow',
      },
      {
        id: 'snippet',
        label: 'Put the snippet on your site',
        done: Boolean(snippetSeen),
        detail: snippetSeen ? 'Events are arriving.' : 'One script tag; it is how results get counted.',
        href: '/grow',
      },
      {
        id: 'form',
        label: 'Publish a signup form',
        done: forms > 0,
        detail: forms > 0 ? `${forms} live.` : 'The list only grows if something feeds it.',
        href: '/grow',
      },
      {
        id: 'first-send',
        label: 'Send your first campaign',
        done: Boolean(hasSend),
        detail: hasSend ? 'Done — results live on the campaign page.' : 'The composer prices it before anything moves.',
        href: '/send',
      },
    ];

    return NextResponse.json({
      ok: true,
      steps,
      ready: steps.filter((s) => s.done).length,
      total: steps.length,
    });
  });
}
