/**
 * The ledger's shared vocabulary: which month, and which budget.
 *
 * These lived in `/api/spend/route.ts` and were imported by `/api/send` —
 * which worked at runtime and was wrong twice over. A Next route module's
 * exports are its HTTP surface, and the framework's generated types reject
 * extras; and a helper two routes both need is shared vocabulary, which is
 * what `src/lib` is for.
 */

/** 'YYYY-MM' for a date, in UTC — the same month boundary the ledger uses. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The canonical uniqueness key for a budget.
 *
 * One function, used by both the writer and the reader, because two places
 * deriving "the same" key independently is how a cap gets written under one
 * name and looked up under another — and a cap nobody reads is worse than no
 * cap, since the owner believes it is there.
 */
export function budgetScope(brandId: string | null, channel: string | null): string {
  return `${brandId ?? 'all'}:${channel ? channel.toUpperCase() : 'all'}`;
}
