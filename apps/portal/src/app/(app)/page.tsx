import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Module } from '@kitstak/entitlements';
import { formatDayShort } from '@kitstak/billing/catalog';
import { env } from '@/server/env';
import { requirePageSession } from '@/server/session';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getBillingContext } from '@/server/billing/context';
import { getOrgPlan, type ModuleState } from '@/server/entitlements';
import { wasInOrganization } from '@/server/signup';
import { plural, viewOnlyAsk, viewOnlyFix } from '@/features/billing/format';
import { AppLauncher, type LauncherApp, type LauncherPlanNote } from '@/features/launcher/app-launcher';
import { CreateOrgForm } from '@/features/launcher/create-org-form';
import { LogoMark } from '@/features/shell/logo';

export const metadata: Metadata = { title: 'Apps' };

interface ProductCopy {
  readonly name: string;
  readonly tagline: string;
}

const PRODUCTS: Readonly<Record<Module, ProductCopy>> = {
  crm: { name: 'KitStak CRM', tagline: 'Deals and pipelines' },
  wms: { name: 'KitStak WMS', tagline: 'Warehouse operations' },
  projects: { name: 'KitStak Projects', tagline: 'Projects and tasks' },
  pulse: { name: 'KitStak Pulse', tagline: 'Job performance and profitability' },
};

function productUrl(module: Module): string {
  switch (module) {
    case 'crm':
      return env.NEXT_PUBLIC_CRM_URL;
    case 'wms':
      return env.NEXT_PUBLIC_WMS_URL;
    case 'projects':
      return env.NEXT_PUBLIC_PROJECTS_URL;
    case 'pulse':
      return env.NEXT_PUBLIC_PULSE_URL;
  }
}

/**
 * Two kinds of people are in no organization. A new one (signed up, no workspace yet) is asked to
 * name it. One who was in an organization before (removed, or left) is told so, in the same words
 * wherever they land: Billing and every signup step send them here (review round 4).
 */
function NoOrganization({ former }: { readonly former: boolean }) {
  return (
    <section data-testid={former ? 'no-org-former' : 'no-org-new'} className="flex flex-col items-center py-20 text-center">
      <LogoMark size={40} />
      <h1 className="mt-8 text-2xl font-semibold tracking-[-0.02em] text-balance text-fg">
        {former ? 'You are no longer in an organization' : 'Create your organization'}
      </h1>
      <p className="mt-2 max-w-md text-md text-pretty text-fg-secondary">
        {former
          ? 'Your account still works, but you are not on a team right now. Ask a teammate to invite you again. Or start your own organization below.'
          : 'You are not in an organization yet. Create one, or ask a teammate for an invitation.'}
      </p>
      <div className="mt-8 flex w-full justify-center">
        <CreateOrgForm />
      </div>
    </section>
  );
}

/**
 * No app opens for this organization: no trial or plan yet, or none of its apps is left. A person
 * who can see billing gets the way to plans. A member is told who to ask, because Billing is closed
 * to them.
 */
function NoAppsOnPlan({ canSeeBilling, canStartTrial, askWho }: { readonly canSeeBilling: boolean; readonly canStartTrial: boolean; readonly askWho: string }) {
  return (
    <div data-testid="launcher-no-apps" className="rounded-2xl border border-dashed border-border-default px-6 py-12 text-center">
      <p className="text-md font-semibold text-fg">No apps on your plan yet</p>
      <p className="mt-1 text-sm text-fg-secondary">
        {canSeeBilling
          ? 'Add CRM, WMS, Projects or Pulse to start using them here.'
          : `Ask ${askWho} to add CRM, WMS, Projects or Pulse. They will show up here.`}
      </p>
      {canSeeBilling ? (
        <Link
          href="/billing"
          data-testid="launcher-see-plans"
          className="mt-5 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {canStartTrial ? 'Start free trial' : 'See plans'}
        </Link>
      ) : null}
    </div>
  );
}

/** The launcher: the apps this organization can open, and a search box (BLUEPRINT.md §6). */
export default async function LauncherPage() {
  const session = await requirePageSession('/');
  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);
  if (!activeOrg) return <NoOrganization former={await wasInOrganization(session.user.id, session.user.email)} />;

  // A person who only manages billing has no apps to open (review round 2). Billing is their home.
  if (activeOrg.role === 'billing') redirect('/billing');

  // The billing context is cached per request: the shell notices read the same one.
  const [billing, { modules, state: plan }] = await Promise.all([getBillingContext(), getOrgPlan(activeOrg.id)]);
  const access = billing?.access ?? null;
  const timeZone = billing?.timeZone ?? 'UTC';
  const askWho = access?.ownerName ?? 'your organization owner';

  /**
   * The one quiet line under an app's tagline (docs/billing/SPEC.md 9.5). The same PlanState drives
   * billing home and the plan notice above the page, so the words never disagree. An app that is
   * simply on and paid for says nothing.
   */
  const planNoteFor = (state: ModuleState): LauncherPlanNote | null => {
    switch (state.badge) {
      case 'trial':
        if (!plan.trial) return null;
        return {
          tone: 'muted',
          text:
            plan.phase === 'active'
              ? `Free trial. First payment on ${formatDayShort(plan.nextCharge?.at ?? plan.trial.endsAt, timeZone)}.`
              : `${plural(plan.trial.daysLeft, 'day', 'days')} left in your free trial`,
        };
      case 'past_due':
        return {
          tone: 'warning',
          text: plan.pastDue ? `Payment past due. Open until ${formatDayShort(plan.pastDue.accessChangesAt, timeZone)}.` : 'Payment past due',
        };
      case 'view_only':
        // The same fix the plan notice names for this state ("Pick a plan", "Update card", "Start again now").
        // A person who can pay reads the fix. An admin, who can see billing but cannot pay, reads who to ask.
        return {
          tone: 'danger',
          text: access?.canManage
            ? `View only. ${viewOnlyFix(plan.phase)}`
            : access?.canView
              ? `View only. ${viewOnlyAsk(plan.phase, askWho)}`
              : `View only. Ask ${askWho} to pick a plan.`,
        };
      case 'not_in_plan':
      case 'included':
      case 'active':
        return null;
    }
  };

  // Apps that are not on the plan are left out; Billing lists them. A view only app still opens.
  const apps: readonly LauncherApp[] = modules
    .filter((state) => state.entitled)
    .map((state) => ({
      module: state.module,
      ...PRODUCTS[state.module],
      href: productUrl(state.module),
      planNote: planNoteFor(state),
    }));

  return (
    <div className="mx-auto flex w-full max-w-[1110px] flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg sm:text-[40px] sm:leading-[48px]">Your apps</h1>
      {apps.length > 0 ? (
        <AppLauncher apps={apps} />
      ) : (
        <NoAppsOnPlan
          canSeeBilling={access?.canView ?? false}
          canStartTrial={(access?.canStartTrial ?? false) && plan.phase === 'none' && plan.trialEligible}
          askWho={askWho}
        />
      )}
    </div>
  );
}
