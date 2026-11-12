'use client';

import * as React from 'react';
import Link from 'next/link';
import { AppSwitcher } from '@kitstak/ui/app-switcher';
import { PRODUCT_NAME } from '@/config/brand';
import { BrandLogo } from './brand-logo';
import { DASHBOARD_ITEM, HEADER_ITEMS, NAV_MENUS, USER_MENU_ITEMS } from '@/config/nav-config';
import { visibleMenus } from '@/config/nav-access';
import { userPreferencesSchema } from '@/lib/domain-types';
import { FormatProvider } from '@/lib/format';
import { useMe } from '@/lib/permissions-client';
import { useApiQuery } from '@/lib/query-client';
import { COMPANY_BRANDING_PATH, COMPANY_BRANDING_QUERY_KEY } from '@/lib/grid-defs/admin/company';
import type { InitialShellContext } from '@/lib/context-label';
import { ContextSwitcher } from './context-switcher';
import { GlobalSearch } from './global-search';
import { HelpMenu } from './help-menu';
import { IdleSignOut } from './idle-sign-out';
import { MegaMenuBar } from './mega-menu';
import { MobileNav } from './mobile-nav';
import { NotificationsBell } from './notifications-bell';
import { PasswordChangeGate } from './password-change-gate';
import { PrintersPopover } from './printers-popover';
import { RouteProgress } from './route-progress';
import { ShellProvider, useShell, useShellAllows, type ShellUser } from './shell-context';
import { TransactionsTray } from './transactions-tray';
import { UserMenu } from './user-menu';

/**
 * Top-bar logo: the company logo uploaded in Settings › Company Settings (on a white chip so a
 * dark logo stays legible on the indigo bar), else the KitStak mark. A logo that fails to load
 * falls back to the mark too.
 */
function Logo() {
  const branding = useApiQuery<{ readonly displayName: string; readonly logoUrl: string | null }>(
    COMPANY_BRANDING_QUERY_KEY,
    COMPANY_BRANDING_PATH,
    { staleTime: 5 * 60_000 },
  );
  const logoUrl = branding.data?.data.logoUrl ?? null;
  const [failed, setFailed] = React.useState<string | null>(null);
  const custom = logoUrl && failed !== logoUrl ? logoUrl : null;
  const name = branding.data?.data.displayName ?? PRODUCT_NAME;
  return (
    <Link
      href={DASHBOARD_ITEM.href}
      aria-label={`${custom ? name : PRODUCT_NAME} home`}
      className="flex shrink-0 items-center rounded-md px-1 pr-2 xl:pr-3 outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      {custom ? (
        <span className="flex h-8 items-center rounded-md bg-white px-2 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, session-authenticated blob */}
          <img
            src={custom}
            alt=""
            className="max-h-6 max-w-[120px] object-contain"
            onError={() => setFailed(custom)}
          />
        </span>
      ) : (
        <BrandLogo tone="light" height={16} showProduct />
      )}
    </Link>
  );
}

/** Cross-app origins for the shared AppSwitcher (BLUEPRINT.md §6); dev defaults match the three dev ports. */
const APP_URLS = {
  portal: process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3300',
  crm: process.env.NEXT_PUBLIC_CRM_URL ?? 'http://localhost:3100',
  wms: process.env.NEXT_PUBLIC_WMS_URL ?? 'http://localhost:3000',
} as const;

function TopBar() {
  const { permissions, activeApps: ssrApps } = useShell();
  const allows = useShellAllows();
  // `/api/me` refreshes the active add-on apps after Settings → Apps changes; SSR value until then.
  const liveApps = useMe().data?.data.activeApps;
  const activeApps = React.useMemo(() => (liveApps ? new Set(liveApps) : ssrApps), [liveApps, ssrApps]);
  const menus = React.useMemo(
    () => (permissions ? visibleMenus(NAV_MENUS, permissions, activeApps) : NAV_MENUS),
    [permissions, activeApps],
  );
  const extraPages = React.useMemo(
    () =>
      [DASHBOARD_ITEM, ...USER_MENU_ITEMS, ...HEADER_ITEMS].filter((navItem) => allows(navItem.permission)),
    [allows],
  );
  return (
    <header data-testid="top-bar" className="sticky top-0 z-40 border-b border-border-subtle bg-panel">
      <div className="flex h-[var(--topbar-height)] items-center gap-1 px-3 lg:px-4">
        <MobileNav menus={menus} dashboardHref={DASHBOARD_ITEM.href} />
        <Logo />
        <MegaMenuBar menus={menus} dashboardHref={DASHBOARD_ITEM.href} />
        {/* min-w-0 lets the group shrink; below sm the Transactions and Printers icons fold away so the
            handheld screens (360-400 px) never scroll sideways (counts REQ-22). */}
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <GlobalSearch menus={menus} extraPages={extraPages} />
          <ContextSwitcher />
          <div className="flex min-w-0 items-center gap-0.5">
            <span className="hidden sm:contents">
              <TransactionsTray />
              <PrintersPopover />
            </span>
            <HelpMenu />
            <NotificationsBell />
          </div>
          <AppSwitcher current="wms" urls={APP_URLS} />
          <UserMenu />
        </div>
      </div>
      <RouteProgress />
    </header>
  );
}

function PreferencesBoundary({ children }: { readonly children: React.ReactNode }) {
  const me = useMe();
  const raw = me.data?.data.preferences;
  const preferences = React.useMemo(() => {
    const parsed = userPreferencesSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : undefined;
  }, [raw]);
  return <FormatProvider preferences={preferences}>{children}</FormatProvider>;
}

/**
 * Authenticated application shell: light top bar (7 permission-filtered mega-menus, global
 * search, context switcher, Transactions, Printers, Help, Notifications, user menu).
 * `permissions` are resolved on the server so menus render without a loading flash.
 */
export function AppShell({
  user,
  permissions,
  initialContext,
  activeApps,
  passwordChange = null,
  idleMinutes = null,
  children,
}: {
  readonly user: ShellUser;
  readonly permissions: readonly string[];
  readonly initialContext?: InitialShellContext | null;
  readonly activeApps?: readonly string[] | null;
  readonly passwordChange?: 'reset' | 'expired' | null;
  readonly idleMinutes?: number | null;
  readonly children: React.ReactNode;
}) {
  return (
    <ShellProvider
      user={user}
      permissions={permissions}
      initialContext={initialContext}
      activeApps={activeApps}
    >
      <PreferencesBoundary>
        <div className="flex min-h-screen flex-col">
          <a
            href="#main-content"
            className="sr-only z-50 rounded bg-surface px-3 py-2 text-sm font-semibold text-primary focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
          >
            Skip to content
          </a>
          <TopBar />
          {/* lg:pr-7 reserves a gutter as wide as the fixed (w-7) "Feedback & Updates" side tab so it never covers grid action columns. */}
          <main id="main-content" className="flex min-h-0 flex-1 flex-col lg:pr-7 print:pr-0">
            <PasswordChangeGate reason={passwordChange}>{children}</PasswordChangeGate>
          </main>
          <IdleSignOut minutes={idleMinutes} />
        </div>
      </PreferencesBoundary>
    </ShellProvider>
  );
}
