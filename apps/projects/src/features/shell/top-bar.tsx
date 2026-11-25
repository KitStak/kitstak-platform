'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { withThemeParam } from '@kitstak/ui/theme-handoff';
import { Bell, BookOpen, CircleHelp, Compass, Keyboard, LayoutGrid, LifeBuoy, Menu, Plus, Rocket, Search } from 'lucide-react';
import { AppSwitcher } from '@kitstak/ui/app-switcher';
import {
  Button,
  CountBadge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  Tooltip,
  useModKey,
} from '@/components/ui';
import { useUnreadCount } from '@/lib/hooks/use-data';
import { routes } from '@/lib/routes';
import { Logo, ProjectsMark } from './logo';
import { OrgSwitcher } from './org-switcher';
import { useShell } from './shell-context';
import { useOnboardingStore } from '@/features/onboarding/store';
import { RunningTimerPill } from '@/features/task/running-timer-pill';
import { useShellStore } from './store';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

function HelpMenu() {
  const router = useRouter();
  const openShortcuts = useShellStore((state) => state.openShortcuts);
  const { appUrls } = useShell();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Help" icon={<CircleHelp aria-hidden />} data-testid="help-menu" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem icon={<Rocket aria-hidden />} description="Your first-steps checklist" onSelect={() => router.push('/?tour=1')}>
          Getting started
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Compass aria-hidden />} description="A 1-minute spotlight tour" onSelect={() => useOnboardingStore.getState().startTour(0)} data-testid="help-tour">
          Take the tour
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Keyboard aria-hidden />} shortcut="?" onSelect={openShortcuts}>
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuItem icon={<BookOpen aria-hidden />} description="Templates for common projects" onSelect={() => router.push(routes.templates())}>
          Browse templates
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<LifeBuoy aria-hidden />}
          onSelect={() => window.open('mailto:support@kitstak.com?subject=KitStak%20Projects%20support', '_self')}
        >
          Contact support
        </DropdownMenuItem>
        <DropdownMenuItem icon={<LayoutGrid aria-hidden />} onSelect={() => window.location.assign(withThemeParam(appUrls.portal))}>
          KitStak Portal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 56px top bar (CRM/WMS anatomy): menu (mobile), logo, org switcher, search, quick add, inbox, help, apps, theme, account. */
export function TopBar() {
  const { appUrls, modules, notInPlan, planBadges, addHrefs } = useShell();
  const mod = useModKey();
  const openPalette = useShellStore((state) => state.openPalette);
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const setMobileNavOpen = useShellStore((state) => state.setMobileNavOpen);
  const unread = useUnreadCount();
  const count = unread.data?.count ?? 0;

  return (
    <header
      role="banner"
      data-testid="top-bar"
      className="relative z-[var(--z-header)] flex h-[var(--topbar-height)] shrink-0 items-center gap-1.5 border-b border-border-subtle bg-panel px-3 lg:px-4"
    >
      <IconButton label="Open navigation" icon={<Menu aria-hidden />} className="md:hidden" onClick={() => setMobileNavOpen(true)} />
      <Link
        href={routes.home()}
        className="mr-1 flex h-9 shrink-0 items-center rounded-md px-1.5 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span className="hidden sm:inline-flex">
          <Logo size={22} />
        </span>
        <ProjectsMark size={26} className="sm:hidden" />
        <span className="sr-only">KitStak Projects home</span>
      </Link>
      <span aria-hidden className="hidden h-5 w-px bg-border-default sm:block" />
      <OrgSwitcher />

      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-1.5">
        <RunningTimerPill />
        <Tooltip
          content={
            <span className="flex items-center gap-1.5">
              Search and commands <Kbd>{mod}</Kbd>
              <Kbd>K</Kbd>
            </span>
          }
        >
          <button
            type="button"
            onClick={() => openPalette()}
            data-search-trigger=""
            data-testid="topbar-search"
            aria-label="Search and commands"
            aria-keyshortcuts="Control+K Meta+K"
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-sunken text-xs text-fg-secondary transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:w-56 lg:justify-start lg:px-3"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Search aria-hidden className="size-3.5 shrink-0" />
              <span className="hidden min-w-0 flex-1 truncate text-left lg:inline">Search</span>
              <span className="hidden items-center gap-0.5 lg:inline-flex">
                <Kbd>{mod}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </span>
          </button>
        </Tooltip>
        <Tooltip content={<span className="flex items-center gap-1.5">New task <Kbd>C</Kbd></span>}>
          <Button
            size="sm"
            leadingIcon={<Plus aria-hidden />}
            onClick={() => openQuickAdd()}
            data-testid="topbar-quick-add"
            aria-keyshortcuts="C"
            className="h-8"
          >
            <span className="hidden sm:inline">New task</span>
            <span className="sr-only sm:hidden">New task</span>
          </Button>
        </Tooltip>
        <nav aria-label="Quick actions" className="flex shrink-0 items-center gap-0.5">
          <Link
            href={routes.inbox()}
            aria-label={count > 0 ? `Inbox (${count} unread)` : 'Inbox'}
            data-testid="topbar-inbox"
            className="relative hidden size-8 items-center justify-center rounded-md text-icon sm:inline-flex hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            <Bell aria-hidden className="size-[18px]" />
            {count > 0 ? (
              <span className="absolute -top-0.5 -right-0.5">
                <CountBadge count={count} ringClassName="ring-[var(--surface-panel)]" />
              </span>
            ) : null}
          </Link>
          <span className="hidden sm:contents">
            <HelpMenu />
          </span>
        </nav>
        <AppSwitcher
          current="projects"
          urls={appUrls}
          entitled={{ crm: modules.crm, wms: modules.wms, projects: modules.projects, pulse: modules.pulse }}
          notInPlan={notInPlan}
          planBadges={planBadges}
          addHref={addHrefs ? (app) => (app === 'portal' ? undefined : addHrefs[app]) ?? `${appUrls.portal}/billing/plan?add=${app}` : undefined}
        />
        <ThemeToggle className="hidden sm:inline-flex" />
        <UserMenu />
      </div>
    </header>
  );
}
