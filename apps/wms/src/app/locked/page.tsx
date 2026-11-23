import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { PlanLockScreen } from '@kitstak/ui/plan-lock';
import { BrandLogo } from '@/components/layout/brand-logo';
import { Skeleton } from '@/components/ui/skeleton';
import { loadLockView } from '@/server/tenancy/lock-view';
import { LockedSwitcher } from './locked-switcher';

export const metadata: Metadata = {
  title: 'WMS is not in your plan',
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
  if (view.kind === 'setup') redirect('/setup-warehouse');
  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-panel px-4 sm:px-6">
        <BrandLogo tone="light" height={20} showProduct />
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden truncate text-sm text-fg-secondary sm:block">{view.orgName}</span>
          <LockedSwitcher badges={view.badges} />
        </div>
      </header>
      <main id="main-content" className="flex flex-1 flex-col">
        <PlanLockScreen app="wms" lock={view.lock} />
      </main>
    </>
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
