import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Warehouse } from 'lucide-react';
import { BrandLogo } from '@/components/layout/brand-logo';
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
    return (
      <div className="text-center">
        <h1 className="text-lg font-semibold">No warehouse yet</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          {state.waitingOn.length > 0
            ? `${state.waitingOn.join(', ')} has KitStak WMS, but its warehouse has not been set up yet. Ask an owner or admin of your organization to set it up, then sign in again.`
            : 'None of your organizations has KitStak WMS yet. Ask an owner or admin of your organization to add it.'}
        </p>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-lg font-semibold">Set up your warehouse</h1>
      <p className="mt-1 text-sm text-fg-secondary">
        Your organization gets its own, separate warehouse: its own stock, orders, clients and users. You
        become its first administrator and can add the rest of your team afterwards.
      </p>
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
