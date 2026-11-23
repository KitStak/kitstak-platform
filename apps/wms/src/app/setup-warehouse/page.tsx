import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Warehouse } from 'lucide-react';
import { BrandLogo } from '@/components/layout/brand-logo';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { loadSetupOffers } from '@/server/tenancy/setup-offers';
import { SetupWarehouseForm } from './setup-form';

export const metadata: Metadata = {
  title: 'Set up your warehouse',
};

/**
 * One separate warehouse per organization: shown when a signed-in user has no warehouse
 * to open (the (app) layout redirects here), or when an org owner/admin chooses "Set up a
 * warehouse" for another org. Outside the (app) group, so it renders without the gated shell.
 */
async function SetupContent() {
  const state = await loadSetupOffers();
  if (!state.signedIn) redirect('/login?next=/setup-warehouse');
  if (state.offers.length === 0) {
    if (state.hasWarehouse) redirect('/');
    const back = (
      <a href={state.portalHref} className={buttonVariants({ variant: 'secondary', size: 'lg' })} data-testid="setup-back-to-portal">
        Back to Portal
      </a>
    );
    // An owner or admin whose plan is view only (the trial ended, the plan ended, a payment is
    // late): the plan comes first, and this page says so with the plan's own words and button.
    // "Ask an owner or admin" is only ever shown to someone who is not one.
    if (state.needsPlan) {
      const { orgName, text, action } = state.needsPlan;
      return (
        <div className="text-center" data-testid="setup-needs-plan">
          <h1 className="text-lg font-semibold">Pick a plan to set up your warehouse</h1>
          <p className="mt-2 text-sm text-fg-secondary">
            {text ?? `The plan for ${orgName} is view only right now.`} Setting up a warehouse is a change, so it waits for your plan. Nothing is
            deleted.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            {action ? (
              <a href={action.href} className={buttonVariants({ variant: 'primary', size: 'lg' })} data-testid="setup-plan-action">
                {action.label}
              </a>
            ) : null}
            {back}
          </div>
        </div>
      );
    }
    // None of their organizations has the WMS in its plan: the lock screen says what it costs and
    // how to add it (docs/billing/SPEC.md section 9.3), instead of a dead end here.
    if (state.waitingOn.length === 0) redirect('/locked');
    return (
      <div className="text-center" data-testid="setup-waiting">
        <h1 className="text-lg font-semibold">No warehouse yet</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          {`${state.waitingOn.join(', ')} has KitStak WMS, but its warehouse has not been set up yet. Ask an owner or admin of your organization to set it up, then sign in again.`}
        </p>
        <div className="mt-6 flex justify-center">{back}</div>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-lg font-semibold">Set up your warehouse</h1>
      <SetupWarehouseForm offers={state.offers} />
    </>
  );
}

export default function SetupWarehousePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-xl rounded-xl border bg-background p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <BrandLogo tone="light" height={24} showProduct />
          <span className="flex size-9 items-center justify-center rounded-full bg-muted" aria-hidden>
            <Warehouse className="size-5 text-fg-muted" />
          </span>
        </div>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <SetupContent />
        </Suspense>
      </div>
    </main>
  );
}
