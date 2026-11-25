import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Settings } from 'lucide-react';
import { Logo } from '@kitstak/ui/logo';
import { env } from '@/server/env';
import { requirePageSession } from '@/server/session';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getOrgModuleStates } from '@/server/entitlements';
import { mustChangePassword } from '@/server/password-change';
import { BillingOrgScope } from '@/features/billing/org-scope';
import { CommandPalette } from '@/features/shell/command-palette';
import { OrgSwitcher } from '@/features/shell/org-switcher';
import { ShellNotices } from '@/features/shell/shell-notices';
import { UserMenu } from '@/features/shell/user-menu';

/**
 * Signed-in portal shell. The bar is deliberately quiet: the KitStak logo on the left; the org
 * switcher, organization settings and the account menu on the right. Billing and the light/dark
 * toggle live in the account menu, and Ctrl/⌘+K or '/' still opens the command palette.
 */
export default async function AppLayout({ children }: { readonly children: React.ReactNode }) {
  const session = await requirePageSession('/');
  // An administrator-set password has to be replaced before anything else is shown.
  if (await mustChangePassword(session.user.id)) redirect('/change-password');
  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);

  // The plan decides which apps the command palette opens (docs/billing/SPEC.md 9.5). No org: all locked.
  const moduleStates = activeOrg ? await getOrgModuleStates(activeOrg.id) : null;
  const entitledFor = (module: 'crm' | 'wms' | 'projects' | 'pulse'): boolean =>
    moduleStates?.modules.find((state) => state.module === module)?.entitled ?? false;
  const entitled = { crm: entitledFor('crm'), wms: entitledFor('wms'), projects: entitledFor('projects'), pulse: entitledFor('pulse') };
  // A person who only manages billing has no seat in any app (review round 3). Their Portal has no
  // "Apps" tab and no link into an app: Billing is their home.
  const billingOnly = activeOrg?.role === 'billing';

  return (
    <div className="flex min-h-dvh flex-col bg-app">
      {/* Which organization this render is for. Billing actions send it back and a stale tab is refused. */}
      <BillingOrgScope orgId={activeOrg?.id ?? null} />
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-panel/90 backdrop-blur">
        <div className="flex h-16 w-full items-center gap-3 px-4 sm:gap-4 sm:px-8">
          <Link
            href={billingOnly ? '/billing' : '/'}
            aria-label="KitStak Portal home"
            className="inline-flex shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus pointer-coarse:min-w-11"
          >
            <Logo size={28} />
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            {activeOrg ? <OrgSwitcher orgs={orgs} activeOrgId={activeOrg.id} /> : null}
            <Link
              href="/settings/organization"
              aria-label="Organization settings"
              title="Organization settings"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <Settings aria-hidden className="size-5" />
            </Link>
            <UserMenu name={session.user.name} email={session.user.email} billingOnly={billingOnly} />
          </div>
          <CommandPalette
            orgs={orgs}
            activeOrgId={activeOrg?.id ?? null}
            crmUrl={env.NEXT_PUBLIC_CRM_URL}
            wmsUrl={env.NEXT_PUBLIC_WMS_URL}
            projectsUrl={env.NEXT_PUBLIC_PROJECTS_URL}
            pulseUrl={env.NEXT_PUBLIC_PULSE_URL}
            entitled={entitled}
            showTrigger={false}
          />
        </div>
      </header>
      {/* Test mode, the plan notice and the verify email notice. Above the page, never over content. */}
      <ShellNotices />
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-12 sm:px-6 sm:py-16">{children}</main>
    </div>
  );
}
