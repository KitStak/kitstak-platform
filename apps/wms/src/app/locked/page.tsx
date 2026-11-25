import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { PlanLockFrame, PlanLockScreen, billingOnlyLock } from '@kitstak/ui/plan-lock';
import { Building2 } from 'lucide-react';
import { BrandLogo } from '@/components/layout/brand-logo';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { loadLockView } from '@/server/tenancy/lock-view';
import { LockedSwitcher } from './locked-switcher';

export const metadata: Metadata = {
  title: 'KitStak WMS',
};

/**
 * The WMS lock screen (docs/billing/SPEC.md section 9.3): shown when the WMS is not in the
 * organization's plan (`loadShellProps` and the warehouse setup page redirect here). Outside the
 * (app) group, so it renders without the gated shell. The words, the price and both links come
 * from `planLockFor` in `@kitstak/billing`, the same in every KitStak app.
 */
async function LockedContent() {
  const view = await loadLockView();
  if (view.kind === 'signed_out') redirect('/login?next=/locked');
  if (view.kind === 'open') redirect('/');
  // Only when the setup page has something to show (see lock-view.ts): it can not bounce back here.
  if (view.kind === 'setup') redirect('/setup-warehouse');
  if (view.kind === 'no_org' || view.kind === 'no_warehouse') {
    // One calm screen with one button to the Portal, the same answer Projects and Pulse give.
    const portal = process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3300';
    const noOrg = view.kind === 'no_org';
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-10" data-testid={noOrg ? 'wms-no-organization' : 'wms-no-warehouse'}>
        <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-panel p-8 text-center shadow-sm">
          <div className="flex justify-center">
            <BrandLogo tone="light" height={22} showProduct />
          </div>
          <div className="mx-auto mt-6 flex size-12 items-center justify-center rounded-xl bg-sunken">
            <Building2 aria-hidden className="size-6 text-icon" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-fg">{noOrg ? 'You are not in an organization yet' : 'There is no warehouse for you to open yet'}</h1>
          <p className="mt-2 text-base text-fg-secondary">
            {noOrg ? 'Create one in the Portal, or ask a teammate to invite you.' : 'Go to the Portal to see your apps and your plan.'}
          </p>
          <a href={portal} className={`${buttonVariants({ variant: 'primary', size: 'lg' })} mt-6 pointer-coarse:h-11`} data-testid="wms-go-to-portal">
            Go to the Portal
          </a>
        </div>
      </main>
    );
  }
  if (view.kind === 'billing_only') {
    // A person who only manages billing: no seat in any app. The same frame, with a way back to Billing.
    const portal = process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3300';
    return (
      <PlanLockFrame logo={<BrandLogo tone="light" height={20} showProduct />} orgName={view.orgName} switcher={<LockedSwitcher billingOnly />}>
        <PlanLockScreen app="wms" lock={billingOnlyLock(view.orgName, portal)} hidePoints />
      </PlanLockFrame>
    );
  }
  // The same frame as the CRM, Projects and Pulse lock screens (`PlanLockFrame`).
  return (
    <PlanLockFrame logo={<BrandLogo tone="light" height={20} showProduct />} orgName={view.orgName} switcher={<LockedSwitcher badges={view.badges} />}>
      <PlanLockScreen app="wms" lock={view.lock} />
    </PlanLockFrame>
  );
}

function LockedFallback() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10" aria-busy="true">
      <Skeleton className="h-96 w-full max-w-md rounded-2xl" />
    </main>
  );
}

export default function LockedPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <Suspense fallback={<LockedFallback />}>
        <LockedContent />
      </Suspense>
    </div>
  );
}
