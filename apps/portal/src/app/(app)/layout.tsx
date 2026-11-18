import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppSwitcher } from '@kitstak/ui/app-switcher';
import { env } from '@/server/env';
import { requirePageSession } from '@/server/session';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getOrgModuleStates } from '@/server/entitlements';
import { mustChangePassword } from '@/server/password-change';
import { CommandPalette } from '@/features/shell/command-palette';
import { Logo } from '@/features/shell/logo';
import { OrgSwitcher } from '@/features/shell/org-switcher';
import { ThemeToggle } from '@/features/shell/theme-toggle';
import { UserMenu } from '@/features/shell/user-menu';

/** Signed-in portal shell: top bar with org switcher, nav, theme toggle and account menu. */
export default async function AppLayout({ children }: { readonly children: React.ReactNode }) {
  const session = await requirePageSession('/');
  // An administrator-set password has to be replaced before anything else is shown.
  if (await mustChangePassword(session.user.id)) redirect('/change-password');
  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);

  // Real entitlement reads for the shared AppSwitcher (BLUEPRINT.md §6); no org → both locked.
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

  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-panel/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <Link
            href="/"
            aria-label="KitStak Portal home"
            className="inline-flex shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            <Logo size={26} />
          </Link>
          {activeOrg ? (
            <>
              <span aria-hidden className="hidden h-5 w-px bg-border-default sm:block" />
              <OrgSwitcher orgs={orgs} activeOrgId={activeOrg.id} />
            </>
          ) : null}
          <nav aria-label="Portal" className="ml-auto hidden items-center gap-1 sm:flex">
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
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:ml-2">
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
            />
            <ThemeToggle />
            <UserMenu name={session.user.name} email={session.user.email} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-10 sm:px-6">{children}</main>
      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-4 py-4 text-xs text-fg-muted sm:px-6">
          <span>© {new Date().getFullYear()} KitStak</span>
          <span>Portal · CRM · WMS · Projects · Pulse</span>
        </div>
      </footer>
    </div>
  );
}
