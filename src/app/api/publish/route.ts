import { NextResponse } from 'next/server';
import { summaries } from '@/lib/oauth/store';
import { publishToBluesky, graphemeLength } from '@/lib/publishers/bluesky';

/**
 * Publish for real, through a stored grant.
 *
 * This is the end of the chain: connect → destination → published post. Only
 * channels with a live grant and an implemented publisher are accepted;
 * everything else returns an honest "not wired up yet" rather than pretending.
 */

export interface PublishRequest {
  channel: string;
  text: string;
  /** Reused across retries so a retry can never become a second post. */
  idempotencyKey?: string;
  /** Set true to validate without publishing. */
  dryRun?: boolean;
}

export async function POST(request: Request) {
  let body: PublishRequest;
  try {
    body = (await request.json()) as PublishRequest;
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected a JSON body.' }, { status: 400 });
  }

  const text = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ ok: false, error: 'Nothing to post.' }, { status: 400 });

  if (body.channel !== 'bluesky') {
    return NextResponse.json(
      {
        ok: false,
        error: `Live publishing for "${body.channel}" is not implemented yet.`,
        detail:
          'Bluesky is the only channel that can publish for real today; the rest need their platform app registered and reviewed first.',
      },
      { status: 501 }
    );
  }

  const grant = summaries().find((g) => g.channel === 'bluesky');
  if (!grant) {
    return NextResponse.json(
      { ok: false, error: 'Bluesky is not connected.', needsReconnect: true },
      { status: 428 }
    );
  }

  const length = graphemeLength(text);
  if (body.dryRun) {
    return NextResponse.json({
      ok: length <= 300,
      dryRun: true,
      graphemes: length,
      limit: 300,
      account: grant.accountLabel,
      error: length > 300 ? `Too long for Bluesky: ${length} of 300 characters.` : undefined,
    });
  }

  const result = await publishToBluesky(text, {
    did: grant.externalAccountId,
    handle: grant.accountLabel.replace(/^@/, ''),
    idempotencyKey: body.idempotencyKey,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

/** GET → which channels can publish for real right now. */
export async function GET() {
  const live = summaries()
    .filter((g) => !g.expired)
    .map((g) => ({
      channel: g.channel,
      accountLabel: g.accountLabel,
      externalAccountId: g.externalAccountId,
      canPublish: g.channel === 'bluesky',
    }));
  return NextResponse.json({ live, publishableChannels: ['bluesky'] });
}
