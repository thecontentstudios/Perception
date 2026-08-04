/**
 * Date helpers for the prototype. All calendar math works on plain
 * 'YYYY-MM-DD' date keys and 'YYYY-MM-DDTHH:mm' datetimes so behavior is
 * timezone-stable inside the demo.
 */

export function parseParts(dateKey: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateKey.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

export function toDate(dateKey: string): Date {
  const { y, m, d } = parseParts(dateKey);
  return new Date(y, m - 1, d);
}

export function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dateKeyOf(dateTime: string): string {
  return dateTime.slice(0, 10);
}

export function timeOf(dateTime: string): string {
  return dateTime.length > 10 ? dateTime.slice(11, 16) : '';
}

export function addDays(dateKey: string, n: number): string {
  const d = toDate(dateKey);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function addMonths(dateKey: string, n: number): string {
  const { y, m } = parseParts(dateKey);
  const d = new Date(y, m - 1 + n, 1);
  return toKey(d);
}

export function compareDateTime(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

export function fmtTime(dateTime: string): string {
  const t = timeOf(dateTime);
  if (!t) return '';
  const [h, min] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return min === 0 ? `${hour} ${ampm}` : `${hour}:${String(min).padStart(2, '0')} ${ampm}`;
}

/** "Thu, Oct 8" */
export function fmtDate(dateKey: string): string {
  const d = toDate(dateKey);
  return `${DAY_SHORT[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** "Oct 8" */
export function fmtShort(dateKey: string): string {
  const d = toDate(dateKey);
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** "October 2026" */
export function fmtMonthYear(dateKey: string): string {
  const { y, m } = parseParts(dateKey);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "Thursday, October 8, 2026" */
export function fmtLong(dateKey: string): string {
  const d = toDate(dateKey);
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "Thu, Oct 8 · 9:30 AM" */
export function fmtDateTime(dateTime: string): string {
  const t = fmtTime(dateTime);
  return t ? `${fmtDate(dateKeyOf(dateTime))} · ${t}` : fmtDate(dateKeyOf(dateTime));
}

export function dayShortName(dateKey: string): string {
  return DAY_SHORT[toDate(dateKey).getDay()];
}

export function dayOfMonth(dateKey: string): number {
  return toDate(dateKey).getDate();
}

/**
 * Month grid: array of weeks (Sunday-first), each week an array of 7 date
 * keys, padded with the surrounding months' days.
 */
export function monthGrid(anchor: string): string[][] {
  const { y, m } = parseParts(anchor);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const weeks: string[][] = [];
  const cursor = new Date(start);
  do {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(toKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === m - 1);
  return weeks;
}

/** The Sunday-first week containing the given date. */
export function weekOf(dateKey: string): string[] {
  const d = toDate(dateKey);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return Array.from({ length: 7 }, (_, i) => toKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
}

export function isSameMonth(dateKey: string, anchor: string): boolean {
  return dateKey.slice(0, 7) === anchor.slice(0, 7);
}

/** Relative label against the demo clock: Today / Tomorrow / in 3 days / 2 days ago */
export function relativeLabel(dateKey: string, today: string): string {
  const diff = Math.round((toDate(dateKey).getTime() - toDate(today).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1) return `in ${diff} days`;
  return `${-diff} days ago`;
}
