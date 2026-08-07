import { notFound } from 'next/navigation';
import { db, dbAvailable } from '@/lib/db';
import { SignupFormClient } from './SignupFormClient';

export const dynamic = 'force-dynamic';

/**
 * The hosted version of a signup form.
 *
 * Every business needs somewhere to send people — a link in an Instagram bio,
 * a QR code on a counter card, the last line of a quote. Most of them do not
 * have a website they can edit, and telling that customer "paste this HTML
 * into your site" is telling them no.
 *
 * So the same form exists twice: here, as a page we host, and as an embed for
 * the ones who do have a site. Both post to the same endpoint and produce the
 * same consent record, because two paths that collect consent differently is
 * two things to get wrong.
 */
export default async function HostedFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await dbAvailable())) notFound();

  const form = await db.signupForm.findUnique({ where: { slug } });
  if (!form) notFound();

  const org = await db.organization.findUnique({
    where: { id: form.organizationId },
    select: { name: true },
  });

  return (
    <div className="hosted-form">
      <main>
        <p className="hf-org">{org?.name}</p>
        <h1>{form.headline}</h1>
        {form.blurb && <p className="hf-blurb">{form.blurb}</p>}
        <SignupFormClient
          slug={form.slug}
          consentText={form.consentText}
          askPhone={form.askPhone}
          smsConsentText={form.smsConsentText}
          doubleOptIn={form.doubleOptIn}
        />
      </main>
    </div>
  );
}
