'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppSwitcher, type AppSwitcherPlanBadge } from '@kitstak/ui/app-switcher';
import { PlanBanner, type PlanBannerNotice } from '@kitstak/ui/plan-banner';
import { ViewOnlyGuard, ViewOnlyPage, WRITE_LABEL, isWritePath } from '@kitstak/ui/view-only';
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
import { SetupCallout } from './setup-callout';
import { ShellProvider, useShell, useShellAllows, type ShellUser } from './shell-context';
import { TransactionsTray } from './transactions-tray';
import { OrgSwitcher, type OrgRef } from './org-switcher';
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

/** Cross-app origins for the shared AppSwitcher (BLUEPRINT.md §6); dev defaults match the dev ports. */
const APP_URLS = {
  portal: process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3300',
  crm: process.env.NEXT_PUBLIC_CRM_URL ?? 'http://localhost:3100',
  wms: process.env.NEXT_PUBLIC_WMS_URL ?? 'http://localhost:3000',
  projects: process.env.NEXT_PUBLIC_PROJECTS_URL ?? 'http://localhost:3400',
  pulse: process.env.NEXT_PUBLIC_PULSE_URL ?? 'http://localhost:3500',
} as const;

type ProductId = 'crm' | 'wms' | 'projects' | 'pulse';

/** The organization's plan as the shell needs it (docs/billing/CONTRACTS.md section 18). */
export interface ShellPlan {
  readonly access: 'full' | 'read_only';
  /** The plan banner under the top bar, or null. Words and link come from `@kitstak/billing`. */
  readonly notice: PlanBannerNotice | null;
  /** Plan state per app for the app switcher. */
  readonly badges: Readonly<Record<ProductId, AppSwitcherPlanBadge>>;
  /** Where a row that is not in the plan goes: the Portal plan picker with that app turned on. */
  readonly addHrefs: Readonly<Record<ProductId, string>>;
  /** Set when the plan has no room for one more warehouse: the sentence with the price, and the link. */
  readonly warehouseLimit?: { readonly message: string; readonly planUrl: string } | null;
}

const ShellPlanContext = React.createContext<ShellPlan | null>(null);

/** The organization's plan, for pages that must say "view only" or "at your limit" before a form opens. null in tests and harnesses. */
export function useShellPlan(): ShellPlan | null {
  return React.useContext(ShellPlanContext);
}

/**
 * WMS screens that are a form from the first pixel: every "new" screen (orders, returns, receipts,
 * products, workflows, billing forms, printouts) and the file import screens.
 */
const WMS_WRITE_PATHS: readonly (string | RegExp)[] = [/\/new$/, /^\/imports\/[^/]+$/, /^\/receiving\/import$/];

/**
 * View only is told before a form opens (docs/billing/SPEC.md 9.4). The WMS has hundreds of create
 * and edit buttons, so they are not marked one by one: the guard marks every button, link and menu
 * row whose label starts a change ("Create client", "Add client", "Bulk import/update", "Edit",
 * "Delete": see `WRITE_LABEL`). A press on one opens one small dialog with the banner's words and
 * button, and the buttons are dimmed. Links to the screens above are caught the same way.
 */
function PlanViewOnly({ plan }: { readonly plan?: ShellPlan }) {
  const pathname = usePathname();
  return (
    <ViewOnlyGuard
      active={plan?.access === 'read_only'}
      notice={plan?.notice ?? null}
      pathname={pathname ?? '/'}
      writePaths={WMS_WRITE_PATHS}
      writeLabel={WRITE_LABEL}
      writePage="inline"
      homeHref="/"
    />
  );
}

/**
 * A create screen opened by its address while the plan is view only: the message takes the place
 * of the form, inside the app frame. The top bar and the banner stay.
 */
function PlanPage({ plan, children }: { readonly plan?: ShellPlan; readonly children: React.ReactNode }) {
  const pathname = usePathname();
  if (plan?.access === 'read_only' && isWritePath(pathname ?? '/', WMS_WRITE_PATHS)) {
    return (
      <>
        <ViewOnlyPage notice={plan.notice} homeHref="/" />
        {/* The form stays in the tree, hidden and out of reach, so Next can still check the route in development. */}
        <div hidden>{children}</div>
      </>
    );
  }
  return <>{children}</>;
}

function TopBar({
  org,
  orgs,
  plan,
}: {
  readonly org?: OrgRef;
  readonly orgs?: readonly OrgRef[];
  readonly plan?: ShellPlan;
}) {
  const { permissions, activeApps: ssrApps, entitledApps } = useShell();
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
          <OrgSwitcher org={org} orgs={orgs} />
          <ContextSwitcher />
          {/* shrink-0: the icon buttons never squeeze under each other or the notification badge. */}
          <div className="flex shrink-0 items-center gap-0.5">
            <span className="hidden sm:contents">
              <TransactionsTray />
              <PrintersPopover />
            </span>
            <HelpMenu />
            <NotificationsBell />
          </div>
          <AppSwitcher
            current="wms"
            urls={APP_URLS}
            entitled={entitledApps}
            planBadges={plan?.badges}
            addHref={plan ? (app) => (app === 'portal' ? `${APP_URLS.portal}/billing/plan` : plan.addHrefs[app]) : undefined}
          />
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
  entitledApps,
  passwordChange = null,
  idleMinutes = null,
  org,
  orgs,
  plan,
  children,
}: {
  readonly user: ShellUser;
  readonly permissions: readonly string[];
  readonly initialContext?: InitialShellContext | null;
  readonly activeApps?: readonly string[] | null;
  readonly entitledApps?: { readonly crm: boolean; readonly wms: boolean; readonly projects: boolean; readonly pulse?: boolean };
  readonly passwordChange?: 'reset' | 'expired' | null;
  readonly idleMinutes?: number | null;
  /** The organization whose warehouse is open, and the others the user can switch to. */
  readonly org?: OrgRef;
  readonly orgs?: readonly OrgRef[];
  /** Omitted in tests and harnesses: no banner, no plan badges. */
  readonly plan?: ShellPlan;
  readonly children: React.ReactNode;
}) {
  return (
    <ShellProvider
      user={user}
      permissions={permissions}
      initialContext={initialContext}
      activeApps={activeApps}
      entitledApps={entitledApps}
    >
      <ShellPlanContext.Provider value={plan ?? null}>
      <PreferencesBoundary>
        <div className="flex min-h-screen flex-col">
          <a
            href="#main-content"
            className="sr-only z-50 rounded bg-surface px-3 py-2 text-sm font-semibold text-primary focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
          >
            Skip to content
          </a>
          <TopBar org={org} orgs={orgs} plan={plan} />
          {/* Trial, payment and view only notices: above the page, never over content. */}
          <PlanBanner notice={plan?.notice ?? null} dismissible className="print:hidden" />
          <PlanViewOnly plan={plan} />
          {/* lg:pr-6 reserves a gutter as wide as the fixed (w-6) "Feedback" side tab so it never covers grid action columns. */}
          <main id="main-content" className="flex min-h-0 flex-1 flex-col lg:pr-6 print:pr-0">
            <SetupCallout />
            <PasswordChangeGate reason={passwordChange}>
              <PlanPage plan={plan}>{children}</PlanPage>
            </PasswordChangeGate>
          </main>
          <IdleSignOut minutes={idleMinutes} />
        </div>
      </PreferencesBoundary>
      </ShellPlanContext.Provider>
    </ShellProvider>
  );
}
