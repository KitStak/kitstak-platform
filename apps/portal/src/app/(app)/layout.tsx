import Link from 'next/link';
import { requirePageSession } from '@/server/session';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { Logo } from '@/features/shell/logo';
import { OrgSwitcher } from '@/features/shell/org-switcher';
import { ThemeToggle } from '@/features/shell/theme-toggle';
import { UserMenu } from '@/features/shell/user-menu';

/** Signed-in portal shell: top bar with org switcher, nav, theme toggle and account menu. */
export default async function AppLayout({ children }: { readonly children: React.ReactNode }) {
  const session = await requirePageSession('/');
  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);

  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-panel/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-4 px-4 sm:px-6">
          <Link
            href="/"
            aria-label="KitStak Portal home"
            className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            <Logo size={26} />
          </Link>
          {activeOrg ? (
            <>
              <span aria-hidden className="h-5 w-px bg-border-default" />
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
          <div className="flex items-center gap-1.5 sm:ml-2">
            <ThemeToggle />
            <UserMenu name={session.user.name} email={session.user.email} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-10 sm:px-6">{children}</main>
      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-4 py-4 text-xs text-fg-muted sm:px-6">
          <span>© {new Date().getFullYear()} KitStak</span>
          <span>Portal · CRM · WMS</span>
        </div>
      </footer>
    </div>
  );
}
