'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import {
  BUNDLE_OFF,
  MORE_SEATS_ACTION,
  OVER_SEATS_ACTION,
  YEARLY_OFF,
  formatMoney,
  moreSeatsPrompt,
  quoteSummaryLines,
} from '@/lib/pricing';
import type { BillingInterval, Quote } from '@/lib/pricing';
import { PRODUCT_IDS, ROUTES } from '../site-links';
import type { ProductId, SiteProductId, Stack } from '../site-links';
import styles from './stak-parts.module.css';

/* ------------------------------------------------------------------ The stack, drawn large */

interface StakVisualProps {
  readonly stack: Stack;
  /** Extra thin slabs under the products, one per add-on (e.g. "Guided setup"). */
  readonly extras?: readonly string[];
}

const SLAB_LABEL: Readonly<Record<SiteProductId, string>> = {
  crm: 'CRM',
  wms: 'WMS',
  projects: 'Projects',
  pulse: 'Pulse',
  crew: 'Crew',
  ledger: 'Ledger',
};

/** The stack as a live diagram: one bar per product, lit when it is in the stack. */
export function StakVisual({ stack, extras = [] }: StakVisualProps) {
  return (
    <div className={styles.visual} aria-hidden>
      {PRODUCT_IDS.map((id) => (
        <div key={id} className={styles.slab} data-product={id} data-on={stack.includes(id) || undefined}>
          <span>{SLAB_LABEL[id]}</span>
        </div>
      ))}
      {extras.map((extra) => (
        <div key={extra} className={styles.extra}>
          <span>{extra}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Quote */

/** "per month" or "per year": the period a quote's total covers. */
export function perPeriod(interval: BillingInterval): string {
  return interval === 'yearly' ? 'per year' : 'per month';
}

/** "You save $98.80 each month." Null when the quote has no discount in it. */
export function savingsLine(quote: Quote): string | null {
  const saved = quote.yearlySavingsCents + quote.bundleSavingsCents;
  if (saved <= 0) return null;
  return `You save ${formatMoney(saved)} each ${quote.interval === 'yearly' ? 'year' : 'month'}.`;
}

interface QuoteSummaryProps {
  readonly quote: Quote;
}

const DISCOUNT_TEST_ID = { yearly: 'quote-yearly-discount', bundle: 'quote-bundle-discount' } as const;

/**
 * The price, the same way portal sign-up and billing show it: one math line per app, each discount
 * as its own dollar line, then the total. Every number comes from the shared quote. Sits on the navy
 * brand surface.
 */
export function QuoteSummary({ quote }: QuoteSummaryProps) {
  if (quote.lines.length === 0) {
    return <p className={styles.emptyQuote}>Pick an app to see your price.</p>;
  }
  const rows = quoteSummaryLines(quote);
  const saved = savingsLine(quote);
  const products = quote.lines.map((line) => line.product);
  // A flat product covers a set number of seats. Above that there is no listed price.
  const moreSeats = products.map(moreSeatsPrompt).find((prompt) => prompt !== null) ?? null;
  return (
    <div data-testid="quote-summary">
      <ul className={styles.lines}>
        {quote.lines.map((line) => (
          <li key={line.product} data-testid={`quote-line-${line.product}`}>
            {line.math}
          </li>
        ))}
      </ul>
      <dl className={styles.sums}>
        {rows
          .filter((row) => row.kind !== 'total')
          .map((row) => (
            <div key={row.label} data-kind={row.kind}>
              <dt>{row.label}</dt>
              <dd
                data-testid={
                  row.kind === 'list'
                    ? 'quote-list'
                    : row.label.startsWith('Yearly')
                      ? DISCOUNT_TEST_ID.yearly
                      : DISCOUNT_TEST_ID.bundle
                }
              >
                {formatMoney(row.amountCents)}
              </dd>
            </div>
          ))}
      </dl>
      {/* Only the total is read out when the price changes, once, not every line above it. */}
      <div aria-live="polite" aria-atomic="true">
        <p className={styles.total}>
          <span className="visually-hidden">Total: </span>
          <span className={`numeral ${styles.totalFigure}`} data-testid="quote-total">
            {formatMoney(quote.totalCents)}
          </span>
          <span className={styles.totalPer}>{perPeriod(quote.interval)}</span>
        </p>
        {quote.periodMonths === 12 ? (
          <p className={styles.monthly}>
            That is{' '}
            <span data-testid="quote-monthly-equivalent">{formatMoney(quote.monthlyEquivalentCents)}</span> per
            month.
          </p>
        ) : null}
      </div>
      {saved ? (
        <p className={styles.saved}>{saved}</p>
      ) : quote.lines.length === 1 ? (
        <p className={styles.saved}>Add a second app and save {BUNDLE_OFF} on both.</p>
      ) : null}
      {quote.pulseSeatNote ? (
        <p className={styles.overSeats}>
          {quote.pulseSeatNote} For a bigger team, <Link href={ROUTES.contact}>{OVER_SEATS_ACTION}</Link>.
        </p>
      ) : moreSeats ? (
        <p className={styles.fine}>
          {moreSeats} <Link href={ROUTES.contact}>{MORE_SEATS_ACTION}</Link>
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Controls */

interface StepperProps {
  /** What is counted, in lower case and plural: "people", "warehouses". */
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  /** For tests: the field gets this id, the buttons get `-dec` and `-inc` after it. */
  readonly testId?: string;
}

/**
 * A number with a minus and a plus button. The field can be typed in freely: the number is checked
 * when focus leaves it, so clearing it to type a new one does not jump back to 1. Arrow keys work.
 */
export function Stepper({ label, value, min = 1, max, onChange, testId }: StepperProps) {
  // What is in the field while a person types. Null means "show the real value".
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (next: number) => Math.min(Math.max(Number.isFinite(next) ? Math.round(next) : min, min), max);
  const step = (by: number) => {
    setDraft(null);
    onChange(clamp(value + by));
  };
  const title = label.charAt(0).toUpperCase() + label.slice(1);
  return (
    <div className={styles.stepper}>
      <button
        type="button"
        aria-label={`Fewer ${label}`}
        data-testid={testId ? `${testId}-dec` : undefined}
        onClick={() => step(-1)}
        disabled={value <= min}
      >
        <span aria-hidden>−</span>
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={title}
        data-testid={testId}
        min={min}
        max={max}
        step={1}
        value={draft ?? value}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const typed = Number(text);
          // A number in range counts right away, so the price follows every keystroke.
          if (text !== '' && Number.isInteger(typed) && typed >= min && typed <= max) onChange(typed);
        }}
        onBlur={() => {
          if (draft !== null && draft !== '') onChange(clamp(Number(draft)));
          setDraft(null);
        }}
      />
      <button
        type="button"
        aria-label={`More ${label}`}
        data-testid={testId ? `${testId}-inc` : undefined}
        onClick={() => step(1)}
        disabled={value >= max}
      >
        <span aria-hidden>+</span>
      </button>
    </div>
  );
}

interface BillingToggleProps {
  readonly value: BillingInterval;
  readonly onChange: (value: BillingInterval) => void;
  /** On the navy brand surface. */
  readonly inverse?: boolean;
  /** False for a second copy on the same page, so the test ids stay unique. */
  readonly hasTestIds?: boolean;
}

const INTERVAL_LABEL: Readonly<Record<BillingInterval, string>> = {
  monthly: 'Monthly',
  yearly: `Yearly, save ${YEARLY_OFF}`,
};

/** Monthly or yearly. A native radio group, so arrow keys move between the two. */
export function BillingToggle({ value, onChange, inverse = false, hasTestIds = true }: BillingToggleProps) {
  const name = useId();
  return (
    <div
      className={styles.billing}
      role="radiogroup"
      aria-label="How often you pay"
      data-inverse={inverse || undefined}
    >
      {(['monthly', 'yearly'] as const).map((option) => (
        <label key={option} data-checked={value === option || undefined}>
          <input
            type="radio"
            name={name}
            className="visually-hidden"
            data-testid={hasTestIds ? `plan-interval-${option}` : undefined}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {INTERVAL_LABEL[option]}
        </label>
      ))}
    </div>
  );
}
