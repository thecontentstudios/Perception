import { NextResponse } from 'next/server';
import { db, dbAvailable } from '@/lib/db';
import { handle, require_, HttpError } from '@/lib/auth/guard';
import { findNameParts, guessMapping, parseCsv, type Field } from '@/lib/csv';
import { intake, looksLikeEmail, normalizePhone } from '@/lib/intake';
import { normalizeAddress, suppressedAmong } from '@/lib/suppression';
import { clientIp } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * Bringing a spreadsheet in.
 *
 * Two things make this different from a normal file upload.
 *
 * **It always previews first.** An import is hard to undo — a thousand rows
 * merged into a live list cannot be picked apart afterwards by anyone who is
 * not looking at a database — so the default is a dry run that reports exactly
 * what would happen, and committing is a separate, explicit call.
 *
 * **Consent has to be attested.** The route will not mark anybody
 * `SUBSCRIBED` unless the caller states the basis in words. An owner who
 * bought a list can still type something and mail it; the difference is that
 * the sentence they typed is stored beside every address it created, so when
 * a mailbox provider asks why an address is on the list, there is an answer
 * that is not "it was in a CSV".
 */

interface ImportRequest {
  csv: string;
  brandId?: string;
  /** One entry per column; omit to use the guess. */
  mapping?: Field[];
  /**
   * How consent was obtained for these people, in the owner's words.
   * Required to import anyone as subscribed.
   */
  consentEvidence?: string;
  /** Subscribed or pending. Unsubscribed is not an import outcome. */
  consentState?: 'subscribed' | 'pending';
  /** False (the default) reports what would happen and writes nothing. */
  commit?: boolean;
  source?: string;
}

interface RowVerdict {
  line: number;
  name: string;
  email: string | null;
  phone: string | null;
  /** ok | duplicate-in-file | already-known | suppressed | no-address | bad-email */
  verdict: string;
  detail?: string;
}

export async function POST(req: Request) {
  return handle(async () => {
    let body: ImportRequest;
    try {
      body = (await req.json()) as ImportRequest;
    } catch {
      throw new HttpError(400, 'Malformed request.');
    }

    // Importing changes who the business can mail and what the next send
    // costs. That is a content decision, not an administrative one.
    const principal = await require_(body.commit ? 'create_content' : 'read');
    if (!(await dbAvailable())) {
      return NextResponse.json({ ok: false, reason: 'no-database' }, { status: 503 });
    }

    const csv = body.csv ?? '';
    if (!csv.trim()) throw new HttpError(400, 'There is no file to read.');
    if (csv.length > 5_000_000) throw new HttpError(413, 'That file is larger than 5MB. Split it and import in parts.');

    const parsed = parseCsv(csv);
    if (parsed.headers.length === 0) throw new HttpError(422, 'That file has no header row.');

    const mapping = body.mapping ?? guessMapping(parsed.headers);
    const nameParts = mapping.includes('name') ? null : findNameParts(parsed.headers);
    const emailAt = mapping.indexOf('email');
    const phoneAt = mapping.indexOf('phone');

    if (emailAt < 0 && phoneAt < 0) {
      throw new HttpError(
        422,
        'No email or phone column was recognised. Pick which column is which, or add a header row that names them.'
      );
    }

    const state = body.consentState ?? 'pending';
    const evidence = (body.consentEvidence ?? '').trim();

    // The refusal that gives the rest of the consent model its meaning.
    if (state === 'subscribed' && evidence.length < 10) {
      throw new HttpError(
        422,
        'To import people as subscribed, say how they agreed — where they signed up, what they were told. It is stored with every address so the claim can be substantiated later. To skip that, import them as pending instead.'
      );
    }

    // ---- read the file into verdicts --------------------------------------

    const seen = new Set<string>();
    const verdicts: RowVerdict[] = [];
    const candidates: { line: number; name: string; email: string | null; phone: string | null; source: string | null }[] = [];

    parsed.rows.forEach((row, i) => {
      const line = i + 2; // header is line 1
      const at = (field: Field) => {
        const idx = mapping.indexOf(field);
        return idx >= 0 ? (row[idx] ?? '').trim() : '';
      };

      const name = nameParts
        ? [row[nameParts.first], row[nameParts.last]].map((s) => (s ?? '').trim()).filter(Boolean).join(' ')
        : at('name');
      const rawEmail = at('email');
      const rawPhone = at('phone');
      const source = at('source') || body.source || 'CSV import';

      if (!rawEmail && !rawPhone) {
        verdicts.push({ line, name, email: null, phone: null, verdict: 'no-address' });
        return;
      }
      if (rawEmail && !looksLikeEmail(rawEmail)) {
        verdicts.push({ line, name, email: rawEmail, phone: null, verdict: 'bad-email', detail: 'Not a usable address.' });
        return;
      }

      const email = rawEmail ? normalizeAddress(rawEmail) : null;
      const phone = rawPhone ? normalizePhone(rawPhone) : null;
      const key = email ?? phone!;

      // The same address twice in one file is one person, and reporting it is
      // worth more than silently collapsing it — a duplicate usually means the
      // file was concatenated from two exports, which the owner wants to know.
      if (seen.has(key)) {
        verdicts.push({ line, name, email, phone, verdict: 'duplicate-in-file' });
        return;
      }
      seen.add(key);
      candidates.push({ line, name, email, phone, source });
    });

    // ---- check them against what we already have --------------------------

    const emails = candidates.map((c) => c.email).filter((e): e is string => e !== null);
    const [known, suppressed] = await Promise.all([
      emails.length
        ? db.contact.findMany({
            where: { organizationId: principal.organizationId, email: { in: emails } },
            select: { email: true, emailConsent: true },
          })
        : Promise.resolve([]),
      suppressedAmong(principal.organizationId, 'email', emails),
    ]);
    const knownBy = new Map(known.map((k) => [k.email!, k.emailConsent]));

    for (const c of candidates) {
      if (c.email && suppressed.has(c.email)) {
        verdicts.push({
          line: c.line, name: c.name, email: c.email, phone: c.phone,
          verdict: 'suppressed',
          detail: 'This address bounced or complained before. Importing it again would not make it deliverable.',
        });
        continue;
      }
      if (c.email && knownBy.has(c.email)) {
        verdicts.push({
          line: c.line, name: c.name, email: c.email, phone: c.phone,
          verdict: 'already-known',
          detail: `Already on the list as ${knownBy.get(c.email)!.toLowerCase()}.`,
        });
        continue;
      }
      verdicts.push({ line: c.line, name: c.name, email: c.email, phone: c.phone, verdict: 'ok' });
    }

    const importable = verdicts.filter((v) => v.verdict === 'ok' || v.verdict === 'already-known');
    const summary = {
      rows: parsed.rows.length,
      newContacts: verdicts.filter((v) => v.verdict === 'ok').length,
      alreadyKnown: verdicts.filter((v) => v.verdict === 'already-known').length,
      duplicatesInFile: verdicts.filter((v) => v.verdict === 'duplicate-in-file').length,
      suppressed: verdicts.filter((v) => v.verdict === 'suppressed').length,
      noAddress: verdicts.filter((v) => v.verdict === 'no-address').length,
      badEmail: verdicts.filter((v) => v.verdict === 'bad-email').length,
      ragged: parsed.ragged.length,
    };

    const preview = {
      ok: true,
      committed: false,
      headers: parsed.headers,
      mapping,
      nameParts,
      summary,
      // Enough rows to see the shape of the file without shipping the file
      // back. Someone checking a mapping needs a handful, not a thousand.
      sample: verdicts.slice(0, 25),
      problems: verdicts.filter((v) => v.verdict !== 'ok' && v.verdict !== 'already-known').slice(0, 50),
      consentState: state,
      willSubscribe: state === 'subscribed' ? importable.length : 0,
    };

    if (!body.commit) return NextResponse.json(preview);

    // ---- commit -----------------------------------------------------------

    const ip = clientIp(req);
    const ua = req.headers.get('user-agent');
    const batchId = `import:${Date.now()}`;
    const basisText =
      state === 'subscribed'
        ? evidence
        : 'Imported from a spreadsheet with no stated consent, so held as pending until they confirm.';

    let created = 0;
    let merged = 0;
    for (const c of candidates) {
      if (c.email && suppressed.has(c.email)) continue;
      try {
        const r = await intake({
          organizationId: principal.organizationId,
          brandId: body.brandId ?? null,
          name: c.name,
          email: c.email,
          phone: c.phone,
          source: c.source,
          consent: {
            ...(c.email ? { email: { state, basis: 'import' as const, evidence: basisText } } : {}),
            // A phone number in a spreadsheet is never SMS consent, whatever
            // the owner attests about email. Texting on that basis is a TCPA
            // violation at $500–$1,500 a message, so the import cannot make
            // that claim even if asked to.
            ...(c.phone
              ? {
                  sms: {
                    state: 'pending' as const,
                    basis: 'import' as const,
                    evidence: 'Phone number from a spreadsheet. A number is not permission to text.',
                  },
                }
              : {}),
          },
          ip,
          userAgent: ua,
          sourceId: batchId,
        });
        if (r.created) created += 1;
        else merged += 1;
      } catch {
        // One unusable row must not abandon the other nine hundred.
      }
    }

    await db.auditEvent.create({
      data: {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'contacts.imported',
        target: batchId,
        detail: `${created} new, ${merged} merged, as ${state}${state === 'subscribed' ? ` — "${evidence.slice(0, 120)}"` : ''}`,
      },
    });

    return NextResponse.json({ ...preview, committed: true, created, merged, batchId });
  });
}
