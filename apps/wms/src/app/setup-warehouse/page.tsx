import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PlanBanner } from '@kitstak/ui/plan-banner';
import { PlanLockFrame } from '@kitstak/ui/plan-lock';
import { BrandLogo } from '@/components/layout/brand-logo';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { loadSetupOffers, type SetupOffers } from '@/server/tenancy/setup-offers';
import { LockedSwitcher } from '../locked/locked-switcher';
import { SetupWarehouseForm } from './setup-form';

export const metadata: Metadata = {
  title: 'Set up your warehouse',
};

/**
 * The frame of this screen: the same quiet top bar as the lock screen (logo, organization name,
 * app switcher), the plan banner (for example "Free trial. 14 days left."), a way back to the
 * Portal, then one card. The full app shell needs a warehouse, and there is none yet.
 */
function Frame({ state, children }: { readonly state: SetupOffers | null; readonly children: React.ReactNode }) {
  const frame = state?.frame ?? null;
  return (
    <PlanLockFrame
      logo={<BrandLogo tone="light" height={20} showProduct />}
      orgName={frame?.orgName}
      switcher={frame ? <LockedSwitcher badges={frame.badges} /> : null}
    >
      <PlanBanner notice={frame?.notice ?? null} />
      <div className="mx-auto flex w-full max-w-[600px] flex-1 flex-col px-4 py-6 sm:py-10">
        {state ? (
          <a
            href={state.portalHref}
            data-testid="setup-back-to-portal"
            className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-md text-sm font-medium text-fg-secondary outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-focus"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to Portal
          </a>
        ) : null}
        <div className="mt-2 rounded-2xl border border-border-subtle bg-panel p-5 shadow-sm sm:p-8">{children}</div>
      </div>
    </PlanLockFrame>
  );
}

const HEADING = 'text-xl font-semibold tracking-[-0.02em] text-fg sm:text-2xl';
const LEAD = 'mt-2 text-md text-fg-secondary';

/**
 * One separate warehouse per organization: shown when a signed-in user has no warehouse
 * to open (the proxy and the (app) layout send them here), or when an org owner/admin chooses
 * "Set up a warehouse" for another org. Outside the (app) group, so it renders without the gated
 * shell.
 */
async function SetupContent() {
  const state = await loadSetupOffers();
  if (!state.signedIn) redirect('/login?next=/setup-warehouse');
  if (state.offers.length === 0) {
    if (state.hasWarehouse) redirect('/');
    // An owner or admin whose plan is view only (the trial ended, the plan ended, a payment is
    // late, the plan is paused): the plan comes first. The card says so with the plan banner's own
    // words and its own button ("Pick a plan", "Update card", "Start again now"), never with other
    // words. "Ask an owner or admin" is only ever shown to someone who is not one.
    if (state.needsPlan) {
      const { orgName, text, action } = state.needsPlan;
      return (
        <Frame state={state}>
          <div data-testid="setup-needs-plan">
            <h1 className={HEADING}>Your warehouse is waiting for your plan</h1>
            <p className={LEAD} data-testid="setup-needs-plan-text">
              {text ?? `The plan for ${orgName} is view only right now.`}
            </p>
            <p className="mt-2 text-sm text-fg-muted">Setting up a warehouse is a change, so it waits until then. Nothing is deleted.</p>
            {action ? (
              <div className="mt-6">
                <a href={action.href} className={`${buttonVariants({ variant: 'primary', size: 'lg' })} pointer-coarse:h-11 max-sm:w-full`} data-testid="setup-plan-action">
                  {action.label}
                </a>
              </div>
            ) : null}
          </div>
        </Frame>
      );
    }
    // None of their organizations has the WMS in its plan: the lock screen says what it costs and
    // how to add it (docs/billing/SPEC.md section 9.3), instead of a dead end here.
    if (state.waitingOn.length === 0) redirect('/locked');
    return (
      <Frame state={state}>
        <div data-testid="setup-waiting">
          <h1 className={HEADING}>No warehouse yet</h1>
          <p className={LEAD}>
            {`${state.waitingOn.join(', ')} has KitStak WMS, but its warehouse has not been set up yet. Ask an owner or admin of your organization to set it up, then open the WMS again.`}
          </p>
        </div>
      </Frame>
    );
  }
  return (
    <Frame state={state}>
      <h1 className={HEADING}>Set up your warehouse</h1>
      <p className={LEAD} data-testid="setup-lead">
        Give it a name and you are in. We filled in the rest for you.
      </p>
      <SetupWarehouseForm offers={state.offers} />
    </Frame>
  );
}

function SetupFallback() {
  return (
    <Frame state={null}>
      <div aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-3 h-5 w-full max-w-sm" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    </Frame>
  );
}

export default function SetupWarehousePage() {
  return (
    <Suspense fallback={<SetupFallback />}>
      <SetupContent />
    </Suspense>
  );
}
