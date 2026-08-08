import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { handle, require_, HttpError } from '@/lib/auth/guard';
import { encrypt, hasEncryptionKey } from '@/lib/oauth/crypto';
import { invalidateOrgSenders, orgSenderFor, orgSendingStatus } from '@/lib/senders/registry';

export const dynamic = 'force-dynamic';

/**
 * Sending services an owner connects from Settings.
 *
 * The wall between a demo and a real business was a .env file: the senders
 * read `RESEND_API_KEY` and `TWILIO_*` from the environment, and an owner
 * does not have an environment. Keys land here instead — encrypted with the
 * same envelope the OAuth grants use, never echoed back (status carries a
 * masked hint only), applied without a restart, with the environment left
 * as a deployment-wide fallback.
 *
 * `manage_connections`: the same trust that connects a Facebook Page.
 */

export async function GET() {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('manage_connections');
    const rows = await db.providerCredential.findMany({
      where: { organizationId: principal.organizationId },
      select: { channel: true, hint: true, updatedAt: true },
    });
    const [email, sms] = await Promise.all([
      orgSendingStatus(principal.organizationId, 'email'),
      orgSendingStatus(principal.organizationId, 'sms'),
    ]);
    return NextResponse.json({
      ok: true,
      email: { ...email, hint: rows.find((r) => r.channel === 'EMAIL')?.hint ?? null },
      sms: { ...sms, hint: rows.find((r) => r.channel === 'SMS')?.hint ?? null },
      canStore: hasEncryptionKey(),
    });
  });
}

interface SaveRequest {
  channel: 'email' | 'sms';
  /** Resend */
  apiKey?: string;
  from?: string;
  /** Twilio */
  accountSid?: string;
  authToken?: string;
  /** Point at a stand-in server; delete for production. */
  baseUrl?: string;
}

export async function POST(req: Request) {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('manage_connections');
    if (!hasEncryptionKey()) {
      throw new HttpError(503, 'The server has no TOKEN_ENCRYPTION_KEY, so credentials cannot be stored safely. Set one, or configure senders by environment.');
    }

    let body: SaveRequest;
    try {
      body = (await req.json()) as SaveRequest;
    } catch {
      throw new HttpError(400, 'Malformed request.');
    }

    let payload: Record<string, string>;
    let hint: string;
    if (body.channel === 'email') {
      const apiKey = (body.apiKey ?? '').trim();
      const from = (body.from ?? '').trim();
      if (!apiKey || !from) throw new HttpError(422, 'Email needs an API key and a From address — both, or it fails per message later.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from.replace(/^.*<|>$/g, ''))) {
        throw new HttpError(422, 'The From address does not look like an email address.');
      }
      payload = { apiKey, from, ...(body.baseUrl?.trim() ? { baseUrl: body.baseUrl.trim() } : {}) };
      hint = `…${apiKey.slice(-4)}`;
    } else if (body.channel === 'sms') {
      const accountSid = (body.accountSid ?? '').trim();
      const authToken = (body.authToken ?? '').trim();
      const from = (body.from ?? '').trim();
      if (!accountSid || !authToken || !from) {
        throw new HttpError(422, 'Texting needs the Account SID, the Auth Token and a From number — all three, or every message fails individually.');
      }
      if (!/^AC[a-zA-Z0-9]{10,}$/.test(accountSid)) throw new HttpError(422, 'Account SIDs start with AC.');
      if (!/^\+\d{8,15}$/.test(from)) throw new HttpError(422, 'The From number must be in +15551234567 form.');
      payload = { accountSid, authToken, from, ...(body.baseUrl?.trim() ? { baseUrl: body.baseUrl.trim() } : {}) };
      hint = `…${authToken.slice(-4)}`;
    } else {
      throw new HttpError(400, 'Channel must be email or sms.');
    }

    const channel = body.channel.toUpperCase() as 'EMAIL' | 'SMS';
    await db.providerCredential.upsert({
      where: { organizationId_channel: { organizationId: principal.organizationId, channel } },
      create: { organizationId: principal.organizationId, channel, encrypted: encrypt(JSON.stringify(payload)), hint },
      update: { encrypted: encrypt(JSON.stringify(payload)), hint },
    });
    invalidateOrgSenders(principal.organizationId);

    await db.auditEvent.create({
      data: {
        organizationId: principal.organizationId,
        actorUserId: principal.userId ?? null,
        action: 'provider.connected',
        target: body.channel,
        detail: `Key ending ${hint} saved from Settings.`,
      },
    });

    const status = await orgSendingStatus(principal.organizationId, body.channel);
    return NextResponse.json({ ok: true, status });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('manage_connections');
    const channel = (new URL(req.url).searchParams.get('channel') ?? '').toUpperCase();
    if (channel !== 'EMAIL' && channel !== 'SMS') throw new HttpError(400, 'channel must be email or sms.');
    await db.providerCredential.deleteMany({
      where: { organizationId: principal.organizationId, channel: channel as 'EMAIL' | 'SMS' },
    });
    invalidateOrgSenders(principal.organizationId);
    const status = await orgSendingStatus(principal.organizationId, channel.toLowerCase() as 'email' | 'sms');
    return NextResponse.json({ ok: true, status });
  });
}
