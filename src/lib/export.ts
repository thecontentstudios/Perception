import { db } from './db';

/**
 * Taking your data with you.
 *
 * Portability is not a feature request, it is the condition under which
 * trusting a product is rational: a business that cannot leave has not
 * chosen to stay. Three exports, and the second is the one most products
 * forget.
 *
 * - **Contacts**, carrying their *consent evidence* — not just addresses.
 *   A list exported without the sentence each person agreed to is a list
 *   somebody imports elsewhere and mails on no basis at all, which is how
 *   an export becomes a compliance problem.
 * - **Suppressions**, because leaving with your list and without your
 *   unsubscribes means re-mailing every person who opted out. The rows
 *   nobody thinks to take are the ones that cause the harm.
 * - **The ledger**, with `exact` and `estimated` preserved as their own
 *   column. Flattening them would be the blended-money lie in a new file
 *   format — the one thing this product has refused since Phase 7.
 */

/**
 * One CSV cell, escaped for the format *and* for the spreadsheet.
 *
 * The format part is ordinary: quote when the value holds a comma, quote or
 * newline, and double any quotes inside.
 *
 * The spreadsheet part is a security fix. Excel, Numbers and Sheets execute
 * a cell beginning `=`, `+`, `-` or `@` as a formula on open — so a contact
 * who signed up as `=HYPERLINK("http://evil","click")` becomes a live link
 * in the owner's spreadsheet, and `=cmd|'/c calc'!A1` is worse. The attack
 * is delivered by *our* export of *their* data, which makes neutralising it
 * ours to do. A leading apostrophe makes the cell literal text; it is
 * visible in the formula bar and invisible in the sheet, which is the right
 * trade against executing a stranger's input.
 */
export function csvCell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  const defused = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(defused) ? `"${defused.replace(/"/g, '""')}"` : defused;
}

export function csvRows(header: string[], rows: unknown[][]): string {
  // CRLF: the line ending every spreadsheet on every platform reads without
  // argument, which a file that leaves this product should not start.
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export type ExportKind = 'contacts' | 'suppressions' | 'ledger';

export interface ExportResult {
  filename: string;
  csv: string;
  rowCount: number;
}

export async function exportCsv(organizationId: string, kind: ExportKind): Promise<ExportResult> {
  const stamp = new Date().toISOString().slice(0, 10);

  if (kind === 'contacts') {
    const contacts = await db.contact.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, email: true, phone: true, emailConsent: true, smsConsent: true,
        source: true, createdAt: true, brand: { select: { name: true } },
      },
    });
    // The most recent consent record per contact carries the words they
    // agreed to. Pulled in one query and matched in memory rather than N+1.
    const records = await db.consentRecord.findMany({
      where: { organizationId },
      orderBy: { at: 'desc' },
      select: { contactId: true, channel: true, basis: true, evidence: true, at: true },
    });
    const byContact = new Map<string, (typeof records)[number]>();
    for (const r of records) if (!byContact.has(r.contactId)) byContact.set(r.contactId, r);

    const rows = contacts.map((c) => {
      // Joined by id, not by position: two queries ordered on a column with
      // ties can disagree about their order, and matching by index would
      // hand one person's consent evidence to another.
      const rec = byContact.get(c.id);
      return [
        c.name, c.email ?? '', c.phone ?? '', c.brand?.name ?? '',
        c.emailConsent, c.smsConsent, c.source ?? '',
        c.createdAt.toISOString(),
        rec?.basis ?? '', rec?.evidence ?? '', rec?.at.toISOString() ?? '',
      ];
    });
    return {
      filename: `contacts-${stamp}.csv`,
      rowCount: rows.length,
      csv: csvRows(
        ['name', 'email', 'phone', 'brand', 'email_consent', 'sms_consent', 'source', 'added_at', 'consent_basis', 'consent_evidence', 'consent_recorded_at'],
        rows
      ),
    };
  }

  if (kind === 'suppressions') {
    const rows = (
      await db.suppression.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
        select: { channel: true, address: true, reason: true, detail: true, createdAt: true },
      })
    ).map((s) => [s.channel, s.address, s.reason, s.detail ?? '', s.createdAt.toISOString()]);
    return {
      filename: `do-not-contact-${stamp}.csv`,
      rowCount: rows.length,
      csv: csvRows(['channel', 'address', 'reason', 'detail', 'suppressed_at'], rows),
    };
  }

  const rows = (
    await db.spendEntry.findMany({
      where: { organizationId },
      orderBy: { occurredAt: 'asc' },
      select: {
        occurredAt: true, channel: true, kind: true, certainty: true, cents: true, units: true,
        note: true, providerRef: true, campaign: { select: { name: true } },
      },
    })
  ).map((e) => [
    e.occurredAt.toISOString(),
    e.channel,
    e.kind,
    // Kept as its own column, never folded into the amount. An accountant
    // reconciling against invoices needs to know which rows are beliefs.
    e.certainty,
    (e.cents / 100).toFixed(2),
    e.units,
    e.campaign?.name ?? '',
    e.note ?? '',
    e.providerRef ?? '',
  ]);
  return {
    filename: `spend-${stamp}.csv`,
    rowCount: rows.length,
    csv: csvRows(
      ['occurred_at', 'channel', 'kind', 'certainty', 'amount_usd', 'units', 'campaign', 'note', 'provider_ref'],
      rows
    ),
  };
}
