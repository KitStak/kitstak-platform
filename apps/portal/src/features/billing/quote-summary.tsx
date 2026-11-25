/**
 * The price lines every billing screen shows: one math line per app, the discounts as their own
 * dollar lines, and the total. Used by the picker, the review step and the test checkout, so the
 * three always read the same. Works in server and client components (no hooks).
 */
import type { ReactNode } from 'react';
import { formatMoney } from '@kitstak/billing/catalog';
import { quoteSummaryLines, type Quote } from '@kitstak/billing/quote';
import { cn } from '@/components/ui';
import { perPeriod } from './format';

export interface QuoteSummaryProps {
  readonly quote: Quote;
  /** Replaces 'Total per month' or 'Total per year'. */
  readonly totalLabel?: string;
  /** More rows under the total, for example 'Due today'. */
  readonly children?: ReactNode;
  /** Speak the total when it changes (the picker). */
  readonly live?: boolean;
  readonly className?: string;
}

const DISCOUNT_TEST_ID = { yearly: 'quote-yearly-discount', bundle: 'quote-bundle-discount' } as const;

export function SummaryRow({
  label,
  children,
  strong = false,
  tone,
  hint,
}: {
  readonly label: ReactNode;
  readonly children: ReactNode;
  readonly strong?: boolean;
  readonly tone?: 'success';
  readonly hint?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className={cn('min-w-0 text-sm', strong ? 'font-semibold text-fg' : 'text-fg-secondary')}>
        {label}
        {hint ? <span className="block text-xs font-normal text-fg-muted">{hint}</span> : null}
      </dt>
      <dd
        className={cn(
          'shrink-0 text-right text-sm tabular-nums',
          strong ? 'text-md font-semibold text-fg' : 'text-fg',
          tone === 'success' && 'font-medium text-success-text',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function QuoteSummary({ quote, totalLabel, children, live = false, className }: QuoteSummaryProps) {
  if (quote.lines.length === 0) {
    return (
      <p className={cn('rounded-lg bg-sunken px-4 py-6 text-center text-sm text-fg-muted', className)}>
        Pick an app to see your price.
      </p>
    );
  }
  const rows = quoteSummaryLines(quote);
  const period = perPeriod(quote.interval);
  return (
    <div className={className}>
      <ul className="flex flex-col gap-1.5 border-b border-border-subtle pb-3">
        {quote.lines.map((line) => (
          <li key={line.product} data-testid={`quote-line-${line.product}`} className="text-sm text-fg">
            {line.math}
          </li>
        ))}
      </ul>
      <dl className="pt-2">
        {rows.map((row) => {
          if (row.kind === 'list') {
            return (
              <SummaryRow key={row.label} label={row.label}>
                <span data-testid="quote-list">{formatMoney(row.amountCents)}</span>
              </SummaryRow>
            );
          }
          if (row.kind === 'discount') {
            const testId = row.label.startsWith('Yearly') ? DISCOUNT_TEST_ID.yearly : DISCOUNT_TEST_ID.bundle;
            return (
              <SummaryRow key={row.label} label={row.label} tone="success">
                <span data-testid={testId}>{formatMoney(row.amountCents)}</span>
              </SummaryRow>
            );
          }
          return (
            <div key={row.label} className="mt-1 border-t border-border-subtle pt-1" aria-live={live ? 'polite' : undefined} aria-atomic={live ? true : undefined}>
              <SummaryRow
                strong
                label={totalLabel ?? row.label}
                hint={
                  quote.periodMonths === 12 ? (
                    <>
                      That is <span data-testid="quote-monthly-equivalent">{formatMoney(quote.monthlyEquivalentCents)}</span> per month.
                    </>
                  ) : undefined
                }
              >
                <span data-testid="quote-total">{formatMoney(row.amountCents)}</span>{' '}
                <span className="text-sm font-normal text-fg-secondary">{period}</span>
              </SummaryRow>
            </div>
          );
        })}
        {children}
      </dl>
    </div>
  );
}
