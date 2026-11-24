import type { Metadata } from 'next';
import Link from 'next/link';
import type { Module } from '@kitstak/entitlements';
import { env } from '@/server/env';
import { requirePageSession } from '@/server/session';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getOrgModuleStates } from '@/server/entitlements';
import { AppLauncher, type LauncherApp } from '@/features/launcher/app-launcher';
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

function NoOrganization() {
  return (
    <section className="flex flex-col items-center py-20 text-center">
      <LogoMark size={40} />
      <h1 className="mt-8 text-2xl font-semibold tracking-[-0.02em] text-fg">Create your organization</h1>
      <p className="mt-2 max-w-md text-md text-fg-secondary">
        You’re not in an organization yet. Create one, or ask a teammate for an invitation.
      </p>
      <div className="mt-8 flex w-full justify-center">
        <CreateOrgForm />
      </div>
    </section>
  );
}

function NoAppsOnPlan() {
  return (
    <div className="rounded-2xl border border-dashed border-border-default px-6 py-12 text-center">
      <p className="text-md font-semibold text-fg">No apps on your plan yet</p>
      <p className="mt-1 text-sm text-fg-secondary">Add CRM, WMS, Projects or Pulse to start using them here.</p>
      <Link
        href="/billing"
        className="mt-5 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        See plans
      </Link>
    </div>
  );
}

/** The launcher: the apps this organization can open, and a search box (BLUEPRINT.md §6). */
export default async function LauncherPage() {
  const session = await requirePageSession('/');
  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);
  if (!activeOrg) return <NoOrganization />;

  const { modules } = await getOrgModuleStates(activeOrg.id);
  // Apps that are not on the plan are left out; Billing lists them.
  const apps: readonly LauncherApp[] = modules
    .filter((state) => state.entitled)
    .map((state) => ({
      module: state.module,
      ...PRODUCTS[state.module],
      href: productUrl(state.module),
      pastDue: state.access === 'grace',
    }));

  return (
    <div className="mx-auto flex w-full max-w-[1110px] flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg sm:text-[40px] sm:leading-[48px]">Your apps</h1>
      {apps.length > 0 ? <AppLauncher apps={apps} /> : <NoAppsOnPlan />}
    </div>
  );
}
