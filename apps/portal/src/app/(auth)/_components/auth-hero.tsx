'use client';
/**
 * The panel beside the form (1024 px and wider). It gives a person reasons to sign up, and every
 * one of them is something the product already does:
 *   - a real screenshot of the app they chose (demo data, taken from the running app), with the
 *     other apps as small pictures under it,
 *   - "Your free trial" with the chosen apps and the price that follows it, when the link carried
 *     a cart from the marketing site; else the four list prices, read from the one catalog,
 *   - three promises: the exact price before the start, cancel in two clicks or pause, and
 *     nothing deleted when a trial ends.
 * No customer quote and no logo wall: there is no real one to show yet, and nothing here is made up.
 */
import { useSearchParams, useSelectedLayoutSegments } from 'next/navigation';
import { Check } from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import { CATALOG, PRODUCT_IDS, formatMoney, percentLabel, priceTermsLabel, unitCents, type ProductId } from '@kitstak/billing/catalog';
import { readHandoff, trialSummary, type TrialSummary } from '@/features/signup/cart';

/** What each real screenshot shows. The pictures live in `public/signup/` (1120 x 630, WebP). */
const SHOTS: Readonly<Record<ProductId, { readonly caption: string; readonly alt: string }>> = {
  crm: { caption: 'Customers and deals', alt: 'KitStak CRM: a sales pipeline with deal stages and a forecast chart.' },
  wms: { caption: 'Warehouse work', alt: 'KitStak WMS: a warehouse dashboard with open orders and progress for today.' },
  projects: { caption: 'Tasks and plans', alt: 'KitStak Projects: a home page with tasks due today and a project list.' },
  pulse: { caption: 'Profit on every job', alt: 'KitStak Pulse: revenue, cost and profit for the month, and the jobs that need a look.' },
};

/** Promises the product keeps today (SPEC 5.3, 6.8 and 8.2). */
const PROMISES: readonly string[] = [
  'See your exact price before you start.',
  `Cancel in two clicks. Or pause a monthly plan for ${CATALOG.pauseMonths[0]} to ${CATALOG.pauseMonths[CATALOG.pauseMonths.length - 1]} months.`,
  'Nothing is deleted when a trial ends.',
];

function Shot({ product, small = false }: { readonly product: ProductId; readonly small?: boolean }) {
  const shot = SHOTS[product];
  return (
    <figure className={small ? 'min-w-0 flex-1' : undefined}>
      <div className={small ? 'overflow-hidden rounded-md border border-white/15 bg-white' : 'overflow-hidden rounded-xl border border-white/15 bg-white shadow-modal'}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static picture; the panel is not shown under 1024 px, so `loading="lazy"` keeps it off phones */}
        <img src={`/signup/${product}.webp`} alt={small ? '' : shot.alt} width={1120} height={630} loading="lazy" decoding="async" className="block h-auto w-full" />
      </div>
      <figcaption className={small ? 'mt-1.5 flex items-center gap-1.5 text-2xs font-medium text-white/75' : 'mt-2.5 flex items-center gap-2 text-sm text-white/80'}>
        <span className={small ? 'flex size-4 shrink-0 items-center justify-center rounded-xs bg-white' : 'flex size-6 shrink-0 items-center justify-center rounded-md bg-white'}>
          <AppIcon app={product} size={small ? 12 : 18} />
        </span>
        <span className="min-w-0 truncate">
          <span className="font-semibold text-white">{small ? CATALOG.products[product].shortName : CATALOG.products[product].name}</span>
          {small ? null : <span className="text-white/65"> · {shot.caption}</span>}
        </span>
      </figcaption>
    </figure>
  );
}

function Panel({ summary }: { readonly summary: TrialSummary | null }) {
  // The app the person chose leads. With no cart the CRM leads, and the other three follow.
  const lead: ProductId = summary?.products[0] ?? 'crm';
  const rest = [...(summary?.products.slice(1) ?? []), ...PRODUCT_IDS.filter((id) => id !== lead && !(summary?.products ?? []).includes(id))].slice(0, 3);
  return (
    // Laptop screens are short: under 860 px of height the three small pictures step aside, and
    // under 760 px the panel gets narrower, so the prices and the promises are never cut off.
    <div className="relative flex w-full max-w-[520px] flex-col gap-6 text-white [@media(max-height:759px)]:max-w-[420px] [@media(max-height:759px)]:gap-4">
      <div data-testid="signup-shots">
        <Shot product={lead} />
        <div className="mt-4 flex gap-3 [@media(max-height:859px)]:hidden">
          {rest.map((product) => (
            <Shot key={product} product={product} small />
          ))}
        </div>
      </div>

      {summary ? (
        <section data-testid="signup-plan-summary" aria-label="Your free trial" className="rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3.5">
          <p className="text-2xs font-semibold tracking-[0.08em] text-white/65 uppercase">Your free trial</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {summary.products.map((product) => (
              <li
                key={product}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.08] py-0.5 pr-2.5 pl-1 text-xs font-medium text-white"
              >
                <span className="flex size-5 items-center justify-center rounded-full bg-white">
                  <AppIcon app={product} size={15} />
                </span>
                {CATALOG.products[product].shortName}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm font-medium text-white">{summary.thenLine}</p>
          {summary.monthlyLine ? <p className="text-xs text-white/75">{summary.monthlyLine}</p> : null}
          <p className="mt-1 flex items-center gap-2 text-xs text-white/75">
            <span className="size-2 rounded-full bg-emerald-400" aria-hidden />
            {CATALOG.trialDays} days free. No card needed.
          </p>
        </section>
      ) : (
        <section data-testid="signup-prices" aria-label="Prices" className="rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3.5">
          <p className="text-2xs font-semibold tracking-[0.08em] text-white/65 uppercase">Prices after your {CATALOG.trialDays} free days</p>
          <dl className="mt-2 flex flex-col gap-1.5">
            {PRODUCT_IDS.map((product) => (
              <div key={product} className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="font-medium text-white">{CATALOG.products[product].shortName}</dt>
                <dd className="text-right text-white/80">
                  <span className="font-semibold text-white tabular-nums">{formatMoney(unitCents(product, 'monthly', false), { trimZeroCents: true })}</span>{' '}
                  {priceTermsLabel(product, 'monthly')}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2.5 border-t border-white/12 pt-2.5 text-xs text-white/75">
            {percentLabel(CATALOG.bundlePercentOff)} off with {CATALOG.bundleMinProducts} or more apps. {percentLabel(CATALOG.yearlyPercentOff)} off when you pay yearly.
          </p>
        </section>
      )}

      <ul data-testid="signup-promises" className="flex flex-col gap-2">
        {PROMISES.map((promise) => (
          <li key={promise} className="flex items-start gap-2.5 text-sm font-medium text-white">
            <span className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-[var(--surface-brand)]">
              <Check aria-hidden className="size-3" strokeWidth={3.5} />
            </span>
            {promise}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Reads the cart from the link. Only the signup and sign in screens carry one. */
export function AuthHero() {
  const segments = useSelectedLayoutSegments();
  const params = useSearchParams();
  const carriesCart = segments[0] === 'signup' || segments[0] === 'login';
  const summary = carriesCart ? trialSummary(readHandoff(params)) : null;
  return <Panel summary={summary} />;
}

/** Shown while the link is being read. The same panel with no cart, so nothing jumps. */
export function AuthHeroFallback() {
  return <Panel summary={null} />;
}
