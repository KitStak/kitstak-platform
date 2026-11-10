"use client";

import * as React from "react";
import Link from "next/link";
import { PRODUCT_NAME } from "@/config/brand";
import { BrandLogo } from "./brand-logo";
import { DASHBOARD_ITEM, HEADER_ITEMS, NAV_MENUS, USER_MENU_ITEMS } from "@/config/nav-config";
import { visibleMenus } from "@/config/nav-access";
import { userPreferencesSchema } from "@/lib/domain-types";
import { FormatProvider } from "@/lib/format";
import { useMe } from "@/lib/permissions-client";
import type { InitialShellContext } from "@/lib/context-label";
import { ContextSwitcher } from "./context-switcher";
import { GlobalSearch } from "./global-search";
import { HelpMenu } from "./help-menu";
import { MegaMenuBar } from "./mega-menu";
import { MobileNav } from "./mobile-nav";
import { NotificationsBell } from "./notifications-bell";
import { PrintersPopover } from "./printers-popover";
import { RouteProgress } from "./route-progress";
import { ShellProvider, useShell, useShellAllows, type ShellUser } from "./shell-context";
import { TransactionsTray } from "./transactions-tray";
import { UserMenu } from "./user-menu";

function Logo() {
  return (
    <Link href={DASHBOARD_ITEM.href} aria-label={`${PRODUCT_NAME} home`} className="flex shrink-0 items-center rounded-md px-1 pr-2 xl:pr-3 outline-none focus-visible:ring-2 focus-visible:ring-white/50">
      <BrandLogo tone="dark" height={16} showProduct />
    </Link>
  );
}

function TopBar() {
  const { permissions } = useShell();
  const allows = useShellAllows();
  const menus = React.useMemo(() => (permissions ? visibleMenus(NAV_MENUS, permissions) : NAV_MENUS), [permissions]);
  const extraPages = React.useMemo(() => [DASHBOARD_ITEM, ...USER_MENU_ITEMS, ...HEADER_ITEMS].filter((navItem) => allows(navItem.permission)), [allows]);
  return (
    <header className="sticky top-0 z-40 bg-nav shadow-md">
      <div className="flex h-14 items-center gap-1 px-3 lg:px-4">
        <MobileNav menus={menus} dashboardHref={DASHBOARD_ITEM.href} />
        <Logo />
        <MegaMenuBar menus={menus} dashboardHref={DASHBOARD_ITEM.href} />
        <div className="ml-auto flex items-center gap-1.5">
          <GlobalSearch menus={menus} extraPages={extraPages} />
          <ContextSwitcher />
          <div className="flex items-center gap-0.5">
            <TransactionsTray />
            <PrintersPopover />
            <HelpMenu />
            <NotificationsBell />
          </div>
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
 * Authenticated application shell: indigo top bar (7 permission-filtered mega-menus, global
 * search, context switcher, Transactions, Printers, Help, Notifications, user menu).
 * `permissions` are resolved on the server so menus render without a loading flash.
 */
export function AppShell({ user, permissions, initialContext, children }: { readonly user: ShellUser; readonly permissions: readonly string[]; readonly initialContext?: InitialShellContext | null; readonly children: React.ReactNode }) {
  return (
    <ShellProvider user={user} permissions={permissions} initialContext={initialContext}>
      <PreferencesBoundary>
        <div className="flex min-h-screen flex-col">
          <a href="#main-content" className="sr-only z-50 rounded bg-surface px-3 py-2 text-[13px] font-semibold text-primary focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
            Skip to content
          </a>
          <TopBar />
          <main id="main-content" className="flex min-h-0 flex-1 flex-col">{children}</main>
        </div>
      </PreferencesBoundary>
    </ShellProvider>
  );
}
