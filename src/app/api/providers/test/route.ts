import { NextResponse } from 'next/server';
import { dbAvailable } from '@/lib/db';
import { handle, require_, HttpError } from '@/lib/auth/guard';
import { orgSenderFor } from '@/lib/senders/registry';
import { recordCharge } from '@/lib/billing';
import { previewSms } from '@/lib/sms';
import { SMS_RATES } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

/**
 * Send one test message through whatever is connected.
 *
 * The proof that setup worked is a message arriving, not a green badge. The
 * test goes through the same adapter, records the same charge, and reports
 * the provider's own reference — because a test path that bypasses the real
 * one tests nothing.
 */
export async function POST(req: Request) {
  return handle(async () => {
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }
    const principal = await require_('manage_connections');

    let body: { channel?: 'email' | 'sms'; to?: string };
    try {
      body = (await req.json()) as { channel?: 'email' | 'sms'; to?: string };
    } catch {
      throw new HttpError(400, 'Malformed request.');
    }
    const channel = body.channel;
    const to = (body.to ?? '').trim();
    if (channel !== 'email' && channel !== 'sms') throw new HttpError(400, 'channel must be email or sms.');
    if (!to) throw new HttpError(422, 'Say where to send the test.');

    const sender = await orgSenderFor(principal.organizationId, channel);
    if (!sender) {
      return NextResponse.json({ ok: false, reason: 'Nothing is connected for this channel yet.' }, { status: 422 });
    }

    const text =
      channel === 'email'
        ? 'This is a test from Perception. Your email sending setup works — this message travelled the same path campaigns do.'
        : 'Perception test: your texting setup works.';
    const preview = channel === 'sms' ? previewSms(text) : null;
    const costCents = preview ? Math.max(1, Math.round(preview.segments * SMS_RATES.US.perSegmentCents)) : 0;

    const sent = await sender.send({
      deliveryId: `provider-test-${Date.now().toString(36)}`,
      to,
      subject: channel === 'email' ? 'Perception test message' : undefined,
      body: preview?.fullText ?? text,
      costCents,
    });
    if (!sent.ok) {
      return NextResponse.json({ ok: false, reason: sent.error ?? 'The provider refused it.' }, { status: 422 });
    }
    if (sent.providerRef && costCents > 0) {
      await recordCharge({
        organizationId: principal.organizationId,
        brandId: null,
        channel,
        providerRef: sent.providerRef,
        cents: costCents,
        units: sent.billedUnits ?? preview?.segments ?? 1,
        note: `Settings test message to ${to}`,
      });
    }
    return NextResponse.json({ ok: true, provider: sender.name, providerRef: sent.providerRef ?? null });
  });
}
