'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { withThemeParam } from '@kitstak/ui/theme-handoff';
import { Bell, BookOpen, CircleHelp, FilePlus2, Keyboard, LayoutGrid, LifeBuoy, Rocket, Search } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  Tooltip,
  useModKey,
} from '@/components/ui';
import { routes } from '@/lib/routes';
import { LedgerAppSwitcher } from './ledger-switcher';
import { LedgerMark, Logo } from './logo';
import { MobileNav } from './mobile-nav';
import { OrgSwitcher } from './org-switcher';
import { useShell } from './shell-context';
import { useShellStore } from './store';
import { ThemeToggle } from './theme-toggle';
import { TopNav } from './top-nav';
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
        <DropdownMenuItem icon={<Rocket aria-hidden />} description="The first steps to your first invoice" onSelect={() => router.push(routes.welcome())}>
          Getting started
        </DropdownMenuItem>
        <DropdownMenuItem icon={<BookOpen aria-hidden />} description="Every number explained in plain words" onSelect={() => router.push(routes.settings('math'))}>
          How Ledger does the math
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Keyboard aria-hidden />} shortcut="?" onSelect={openShortcuts}>
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<LifeBuoy aria-hidden />} onSelect={() => window.open('mailto:support@kitstak.com?subject=KitStak%20Ledger%20support', '_self')}>
          Contact support
        </DropdownMenuItem>
        <DropdownMenuItem icon={<LayoutGrid aria-hidden />} onSelect={() => window.location.assign(withThemeParam(appUrls.portal))}>
          KitStak Portal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Notifications land with the features that make them (promises missed, bills sent to you). */
function NotificationsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Notifications" icon={<Bell aria-hidden />} data-testid="topbar-notifications" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <p className="px-2.5 pb-2.5 text-sm text-fg-muted">You are all caught up. Bills sent to you, missed promises and sync problems show up here.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 56px top bar (SPEC 6): menu button (below lg), logo, navigation, then search, the org switcher,
 * the primary button New invoice, notifications, help, the app switcher, theme and account.
 */
export function TopBar() {
  const { appUrls, modules, can } = useShell();
  const mod = useModKey();
  const openPalette = useShellStore((state) => state.openPalette);

  return (
    <header role="banner" data-testid="top-bar" className="relative z-[var(--z-header)] flex h-[var(--topbar-height)] shrink-0 items-center gap-1.5 border-b border-border-subtle bg-panel px-3 lg:px-4">
      <MobileNav />
      <Link href={routes.home()} className="flex h-9 shrink-0 items-center rounded-md px-1.5 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus lg:mr-1">
        <span className="hidden sm:inline-flex">
          <Logo size={22} />
        </span>
        <LedgerMark size={26} className="sm:hidden" />
        <span className="sr-only">KitStak Ledger home</span>
      </Link>
      <TopNav />

      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-1.5 lg:shrink-0">
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
            data-testid="topbar-search"
            aria-label="Search and commands"
            aria-keyshortcuts="Control+K Meta+K"
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-sunken text-xs text-fg-secondary transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus 2xl:w-52 2xl:justify-start 2xl:px-3"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Search aria-hidden className="size-3.5 shrink-0" />
              <span className="hidden min-w-0 flex-1 truncate text-left 2xl:inline">Search</span>
            </span>
          </button>
        </Tooltip>
        <OrgSwitcher />
        {can('invoice:write') ? (
          <Tooltip
            content={
              <span className="flex items-center gap-1.5">
                New invoice <Kbd>N</Kbd>
              </span>
            }
          >
            <Link
              href={routes.newInvoice()}
              data-testid="topbar-new-invoice"
              aria-keyshortcuts="N"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-fg transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:px-3"
            >
              <FilePlus2 aria-hidden className="size-4" />
              <span className="sr-only sm:not-sr-only lg:sr-only xl:not-sr-only">New invoice</span>
            </Link>
          </Tooltip>
        ) : null}
        <nav aria-label="Quick actions" className="flex shrink-0 items-center gap-0.5">
          <NotificationsMenu />
          <span className="hidden sm:contents">
            <HelpMenu />
          </span>
        </nav>
        <LedgerAppSwitcher urls={appUrls} modules={modules} />
        <ThemeToggle className="hidden sm:inline-flex" />
        <UserMenu />
      </div>
    </header>
  );
}
