import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppSwitcher } from '@kitstak/ui/app-switcher';
import { env } from '@/server/env';
import { requirePageSession } from '@/server/session';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getOrgModuleStates } from '@/server/entitlements';
import { mustChangePassword } from '@/server/password-change';
import { CommandPalette } from '@/features/shell/command-palette';
import { Logo, LogoMark } from '@/features/shell/logo';
import { OrgSwitcher } from '@/features/shell/org-switcher';
import { ShellNotices } from '@/features/shell/shell-notices';
import { ThemeToggle } from '@/features/shell/theme-toggle';
import { UserMenu } from '@/features/shell/user-menu';

/** Signed-in portal shell: top bar with org switcher, nav, theme toggle and account menu. */
export default async function AppLayout({ children }: { readonly children: React.ReactNode }) {
  const session = await requirePageSession('/');
  // An administrator-set password has to be replaced before anything else is shown.
  if (await mustChangePassword(session.user.id)) redirect('/change-password');
  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);

  // The plan decides what the shared AppSwitcher shows (docs/billing/SPEC.md 9.5). No org: all locked.
  const moduleStates = activeOrg ? await getOrgModuleStates(activeOrg.id) : null;
  const entitledFor = (module: 'crm' | 'wms' | 'projects' | 'pulse'): boolean =>
    moduleStates?.modules.find((state) => state.module === module)?.entitled ?? false;
  const appUrls = {
    portal: env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300',
    crm: env.NEXT_PUBLIC_CRM_URL,
    wms: env.NEXT_PUBLIC_WMS_URL,
    projects: env.NEXT_PUBLIC_PROJECTS_URL,
    pulse: env.NEXT_PUBLIC_PULSE_URL,
  };
  const entitled = { crm: entitledFor('crm'), wms: entitledFor('wms'), projects: entitledFor('projects'), pulse: entitledFor('pulse') };
  // The same plan words per app as in CRM, WMS, Projects and Pulse (Trial, Active, Payment due,
  // View only, Not in your plan, Included). A row that is not in the plan opens the plan picker
  // with that app turned on.
  const planBadges = moduleStates ? Object.fromEntries(moduleStates.modules.map((state) => [state.module, state.badge])) : undefined;

  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-panel/90 backdrop-blur">
        {/*
          The bar must fit every width from 320 px up with a 40 character organization name:
          the text links wait for 1024 px (the account menu carries them below that), the Ctrl K
          hint waits for 1280 px, the organization name is capped and can shrink, and under
          360 px the lockup becomes the mark alone.
        */}
        <div className="mx-auto flex h-14 w-full max-w-[1120px] min-w-0 items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <Link
            href="/"
            aria-label="KitStak Portal home"
            className="inline-flex shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus pointer-coarse:min-w-11"
          >
            {/* The "Portal" tag is dropped under 640 px so the top bar fits a 360 px phone. */}
            <Logo size={26} className="max-[359px]:hidden max-sm:[&_.ks-logo-product]:hidden" />
            <LogoMark size={26} className="min-[360px]:hidden" />
          </Link>
          {activeOrg ? (
            <>
              <span aria-hidden className="hidden h-5 w-px bg-border-default sm:block" />
              <OrgSwitcher orgs={orgs} activeOrgId={activeOrg.id} />
            </>
          ) : null}
          <nav aria-label="Portal" className="ml-auto hidden shrink-0 items-center gap-1 lg:flex">
            <Link
              href="/"
              className="rounded-md px-2.5 py-1.5 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg"
            >
              Apps
            </Link>
            <Link
              href="/billing"
              className="rounded-md px-2.5 py-1.5 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg"
            >
              Billing
            </Link>
            <Link
              href="/settings/organization"
              className="rounded-md px-2.5 py-1.5 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg"
            >
              Organization
            </Link>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:ml-2 pointer-coarse:gap-0">
            <CommandPalette
              orgs={orgs}
              activeOrgId={activeOrg?.id ?? null}
              crmUrl={appUrls.crm}
              wmsUrl={appUrls.wms}
              projectsUrl={appUrls.projects}
              pulseUrl={appUrls.pulse}
              entitled={entitled}
            />
            <AppSwitcher
              current="portal"
              urls={appUrls}
              entitled={entitled}
              planBadges={planBadges}
            />
            {/* On phones the theme switch lives in the account menu, so the bar keeps 44 px targets. */}
            <ThemeToggle className="max-sm:hidden" />
            <UserMenu name={session.user.name} email={session.user.email} />
          </div>
        </div>
      </header>
      {/* Test mode, the plan notice and the verify email notice. Above the page, never over content. */}
      <ShellNotices />
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-4 py-4 text-xs text-fg-muted sm:px-6">
          <span>© {new Date().getFullYear()} KitStak</span>
          <span>Portal · CRM · WMS · Projects · Pulse</span>
        </div>
      </footer>
    </div>
  );
}
