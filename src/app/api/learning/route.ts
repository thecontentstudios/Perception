import { NextResponse } from 'next/server';
import { dbAvailable } from '@/lib/db';
import { bestTimeFor, learn } from '@/lib/learning';
import { performanceSuggestions } from '@/lib/suggest-performance';
import { BRANDS, CAMPAIGNS } from '@/lib/demo-data';
import { handle, require_ } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * What the product has learned about this business.
 *
 * `?brandId=` narrows to one business, which is usually what you want — a
 * landscaper and a recording studio have nothing useful to tell each other
 * about when to post.
 */
export async function GET(req: Request) {
  return handle(async () => {
  if (!(await dbAvailable())) {
    return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
  }
  const principal = await require_('read');
  const ORG_ID = principal.organizationId;

  const brandId = new URL(req.url).searchParams.get('brandId') ?? undefined;

  try {
    const learning = await learn(ORG_ID, brandId);
    const bestTimes = await Promise.all(
      (brandId ? BRANDS.filter((b) => b.id === brandId) : BRANDS).map(async (b) => ({
        brandId: b.id,
        brandName: b.name,
        ...(await bestTimeFor(ORG_ID, b.id)),
      }))
    );

    const campaign = CAMPAIGNS.find((c) => (brandId ? c.brandId === brandId : true));
    const suggestions = performanceSuggestions(learning, {
      channels: ['instagram', 'facebook', 'tiktok'],
      ctaLabel: campaign?.cta.label ?? 'Learn more',
      ctaUrl: campaign?.cta.url ?? 'https://example.com',
      coreMessage: campaign?.offer ?? 'Here is what we have been working on.',
    });

    return NextResponse.json({ ok: true, learning, bestTimes, suggestions });
  } catch (e) {
    console.error('[learning] failed', e);
    return NextResponse.json({ ok: false, reason: 'Could not read your results.' }, { status: 500 });
  }
  });
}
