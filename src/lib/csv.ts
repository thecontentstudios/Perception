/**
 * Reading the file a small business actually has.
 *
 * "CSV" describes a family of nearly-compatible formats, and the differences
 * are exactly the ones that break a naive `split(',')`:
 *
 *   - a **BOM** at the start, because the file came out of Excel on Windows,
 *     which makes the first header read as `﻿name` and match nothing
 *   - **quoted fields containing commas** — `"Smith, John"` is one cell
 *   - **escaped quotes** inside those, doubled: `"He said ""hi"""`
 *   - **newlines inside quoted fields**, from a pasted address
 *   - **CRLF** line endings, leaving `\r` on the last value of every row
 *   - a **trailing blank line**, which becomes a row of empty contacts
 *
 * Every one of those produces a plausible-looking import with wrong data
 * rather than an error, which is the worst failure mode available: the owner
 * finds out when a customer receives an email addressed to `"Smith`.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  /** Rows whose column count disagrees with the header. */
  ragged: { line: number; got: number }[];
}

export function parseCsv(input: string): ParsedCsv {
  // The BOM has to go before anything looks at the first character.
  const text = input.replace(/^﻿/, '');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // A doubled quote is a literal quote; a single one ends the field.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // Swallowed: CRLF is handled by the \n that follows, and a lone \r would
      // otherwise end up on the last value of every row.
      continue;
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  // Whatever is left when the file ends, unless the file ended cleanly.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Blank lines produce a single empty field; they are not data.
  const meaningful = rows.filter((r) => r.some((v) => v.trim() !== ''));
  const headers = (meaningful.shift() ?? []).map((h) => h.trim());

  const ragged: { line: number; got: number }[] = [];
  meaningful.forEach((r, i) => {
    if (r.length !== headers.length) ragged.push({ line: i + 2, got: r.length });
  });

  return { headers, rows: meaningful, ragged };
}

// ---------------------------------------------------------------------------
// Working out which column is which
// ---------------------------------------------------------------------------

export type Field = 'name' | 'email' | 'phone' | 'source' | 'ignore';

/**
 * What people actually call these columns.
 *
 * Guessing is worth doing because the alternative is a mapping screen that
 * every user has to complete every time, and most files are one of about a
 * dozen shapes. Guessing wrong is cheap here **only because the guess is shown
 * and editable** — an import that silently decided the "Company" column was a
 * name would be worse than one that asked.
 */
const ALIASES: Record<Exclude<Field, 'ignore'>, string[]> = {
  email: ['email', 'e-mail', 'email address', 'emailaddress', 'mail', 'e mail', 'contact email', 'primary email'],
  name: ['name', 'full name', 'fullname', 'contact', 'contact name', 'customer', 'customer name', 'client'],
  phone: ['phone', 'phone number', 'mobile', 'cell', 'cellphone', 'telephone', 'tel', 'mobile number', 'contact number'],
  source: ['source', 'origin', 'how they found us', 'lead source', 'channel', 'referrer'],
};

/**
 * One shape for comparison: lower case, and underscores and hyphens read as
 * spaces.
 *
 * `first_name` is what booking software exports and `First Name` is what a
 * human types; treating them as different strings meant a whole class of file
 * imported four hundred contacts all called "Unknown".
 */
function canonical(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function guessMapping(headers: string[]): Field[] {
  const used = new Set<Field>();
  return headers.map((raw) => {
    const h = canonical(raw);
    for (const [field, names] of Object.entries(ALIASES) as [Exclude<Field, 'ignore'>, string[]][]) {
      if (used.has(field)) continue;
      if (names.includes(h)) {
        used.add(field);
        return field;
      }
    }
    // A second pass on substrings, so "Customer Email Address" still lands.
    for (const [field, names] of Object.entries(ALIASES) as [Exclude<Field, 'ignore'>, string[]][]) {
      if (used.has(field)) continue;
      if (names.some((n) => h.includes(n))) {
        used.add(field);
        return field;
      }
    }
    return 'ignore';
  });
}

// ---------------------------------------------------------------------------
// Splitting a "First,Last" file into names
// ---------------------------------------------------------------------------

/**
 * Join separate first and last name columns, when that is what the file has.
 *
 * Common enough in exports from booking software to be worth handling, and
 * invisible enough that a file with `first_name`/`last_name` otherwise imports
 * four hundred contacts all called "Unknown".
 */
export function findNameParts(headers: string[]): { first: number; last: number } | null {
  const lower = headers.map(canonical);
  const first = lower.findIndex((h) => ['first', 'first name', 'firstname', 'given name'].includes(h));
  const last = lower.findIndex((h) => ['last', 'last name', 'lastname', 'surname', 'family name'].includes(h));
  return first >= 0 && last >= 0 ? { first, last } : null;
}
