import { AppIcon } from '@kitstak/ui/app-icon';
import { CATALOG } from '@kitstak/billing/catalog';
import type { TrialSummary } from '@/features/signup/cart';

/**
 * "Your free trial" on phones and tablets, where the brand panel is not shown. Same words, same
 * numbers, from the same catalog. Hidden from 1024 px up, where the brand panel carries the card.
 */
export function TrialSummaryInline({ summary }: { readonly summary: TrialSummary }) {
  return (
    <section
      data-testid="signup-plan-summary-inline"
      aria-label="Your free trial"
      className="mb-6 rounded-xl border border-border-default bg-sunken/60 px-4 py-3 lg:hidden"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <p className="text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">Your free trial</p>
        <ul className="flex flex-wrap gap-1.5">
          {summary.products.map((product) => (
            <li
              key={product}
              className="inline-flex items-center gap-1 rounded-full border border-border-default bg-panel py-0.5 pr-2 pl-1 text-xs font-medium text-fg"
            >
              <AppIcon app={product} size={16} />
              {CATALOG.products[product].shortName}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-sm text-fg-secondary">
        {summary.thenLine}
        {summary.monthlyLine ? ` ${summary.monthlyLine}` : ''}
      </p>
    </section>
  );
}
