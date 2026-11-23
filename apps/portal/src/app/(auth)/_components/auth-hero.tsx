'use client';
/**
 * The brand panel beside the form (1024 px and wider). It shows the four apps. When the link
 * carried a cart from the marketing site, it shows "Your free trial" with the chosen apps and the
 * price that follows the trial, read from the one catalog.
 */
import { useSearchParams, useSelectedLayoutSegments } from 'next/navigation';
import { Check } from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import { CATALOG, PRODUCT_IDS, type ProductId } from '@kitstak/billing/catalog';
import { LogoMark } from '@/features/shell/logo';
import { cn } from '@/components/ui';
import { readHandoff, trialSummary, type TrialSummary } from '@/features/signup/cart';

const CAPTIONS: Readonly<Record<ProductId, string>> = {
  crm: 'Customers and deals',
  wms: 'Warehouse work',
  projects: 'Tasks and plans',
  pulse: 'Profit on every job',
};

function AppTile({ product, chosen, dim }: { readonly product: ProductId; readonly chosen: boolean; readonly dim: boolean }) {
  return (
    <div
      className={cn(
        'relative rounded-xl border p-4 transition-opacity',
        chosen ? 'border-white/30 bg-white/[0.10]' : 'border-white/12 bg-white/[0.05]',
        dim && 'opacity-45',
      )}
    >
      <div className="flex items-start justify-between">
        <span className="flex size-9 items-center justify-center rounded-lg bg-white">
          <AppIcon app={product} size={26} />
        </span>
        {chosen ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-emerald-400 text-[var(--surface-brand)]">
            <Check aria-hidden className="size-3" strokeWidth={3.5} />
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-sm font-semibold text-white">{CATALOG.products[product].name}</p>
      <p className="mt-0.5 text-xs text-white/60">{CAPTIONS[product]}</p>
    </div>
  );
}

function Panel({ summary }: { readonly summary: TrialSummary | null }) {
  const chosen = new Set<ProductId>(summary?.products ?? []);
  return (
    <>
      <div className="relative w-full max-w-[460px] rounded-2xl border border-white/12 bg-white/[0.05] p-5 shadow-modal backdrop-blur-[2px]">
        <div className="flex items-center justify-between" aria-hidden>
          <LogoMark size={26} />
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-white/25" />
            <span className="size-1.5 rounded-full bg-white/25" />
            <span className="size-1.5 rounded-full bg-white/40" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3" aria-hidden>
          {PRODUCT_IDS.map((product) => (
            <AppTile key={product} product={product} chosen={chosen.has(product)} dim={summary !== null && !chosen.has(product)} />
          ))}
        </div>
        {summary ? (
          <section
            data-testid="signup-plan-summary"
            aria-label="Your free trial"
            className="mt-3 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3.5"
          >
            <p className="text-2xs font-semibold tracking-[0.08em] text-white/60 uppercase">Your free trial</p>
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
            {summary.monthlyLine ? <p className="text-xs text-white/70">{summary.monthlyLine}</p> : null}
            <p className="mt-1 flex items-center gap-2 text-xs text-white/70">
              <span className="size-2 rounded-full bg-emerald-400" aria-hidden />
              {CATALOG.trialDays} days free. No card needed.
            </p>
          </section>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <span className="size-2 rounded-full bg-emerald-400" aria-hidden />
            <span className="text-xs text-white/70">Sign in once. Open every app.</span>
          </div>
        )}
      </div>
      <div className="relative max-w-md text-center text-white">
        <p className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
          One login. Every KitStak app your team runs on.
        </p>
      </div>
    </>
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
