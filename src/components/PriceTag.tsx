import type { CSSProperties, ReactNode } from 'react';

/**
 * The product's three kinds of money, rendered one way everywhere.
 *
 * Every screen that shows a figure has been making the same three-way
 * distinction — exact, estimated, range — with hand-rolled styles that
 * drifted a little each time: the flights table used `~` and italics, the
 * campaign rollup used italics without the tooltip, the pathway used a
 * lighter weight. The distinction is the product's oldest promise ("exact
 * money and guessed money look different"), which makes it exactly the thing
 * that must not be re-implemented per screen.
 *
 * - **exact** — a fact. A settled invoice, a charged send. Full weight.
 * - **estimated** — a belief about money, awaiting an invoice. `~`, muted,
 *   italic, and a tooltip saying when it firms up.
 * - **range** — what spend *buys* at posted rates. Never collapsed to a
 *   midpoint: the width is the information.
 */

const cents$ = (c: number) =>
  (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function PriceTag({
  kind,
  cents,
  lowCents,
  highCents,
  title,
  style,
}: {
  kind: 'exact' | 'estimated' | 'range';
  cents?: number;
  lowCents?: number;
  highCents?: number;
  /** Overrides the default tooltip when a screen has something better to say. */
  title?: string;
  style?: CSSProperties;
}): ReactNode {
  if (kind === 'range') {
    return (
      <span title={title ?? 'What this buys at posted rates. The width is real — it stays a range.'} style={style}>
        {cents$(lowCents ?? 0)}–{cents$(highCents ?? 0)}
      </span>
    );
  }
  if (kind === 'estimated') {
    return (
      <span
        title={title ?? 'A dashboard figure, not an invoice. Becomes exact when it settles.'}
        style={{ color: 'var(--muted)', fontStyle: 'italic', ...style }}
      >
        ~{cents$(cents ?? 0)}
      </span>
    );
  }
  return (
    <span title={title} style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {cents$(cents ?? 0)}
    </span>
  );
}
