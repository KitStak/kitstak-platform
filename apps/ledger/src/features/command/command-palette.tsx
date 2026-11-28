'use client';
/**
 * Ctrl/Cmd+K command palette (docs/ledger/SPEC.md 6, `/search`): go to any page the person may
 * open, start something (New invoice, Record payment, New bill, New expense, Import a statement,
 * Close month), open a sibling KitStak app, switch theme or organization, sign out. Rows a person
 * may not use are left out by Ledger right. Finding invoices, customers, vendors and bills by
 * name lands with those screens (Phases 1 to 4). Same frame as the Pulse palette.
 */
import { type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CornerDownLeft, FilePlus2, Keyboard, Landmark, LogOut, Moon, Receipt, ReceiptText, Search, Sun, Upload, Wallet, CalendarCheck2 } from 'lucide-react';
import { withThemeParam } from '@kitstak/ui/theme-handoff';
import { DARK_QUERY, persistTheme } from '@kitstak/ui/theme';
import { Kbd, cn } from '@/components/ui';
import { organization, signOut } from '@/lib/auth-client';
import { navFor } from '@/lib/nav';
import { routes } from '@/lib/routes';
import type { LedgerRight } from '@/lib/permissions';
import { NAV_ICONS } from '@/features/shell/nav-icons';
import { useShell } from '@/features/shell/shell-context';
import { orgInitials } from '@/features/shell/org-switcher';
import { useShellStore } from '@/features/shell/store';

const groupClass =
  '[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted';

function Item({ value, keywords, onSelect, icon, children, meta, external }: {
  readonly value: string;
  readonly keywords?: readonly string[];
  readonly onSelect: () => void;
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly meta?: ReactNode;
  readonly external?: boolean;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords ? [...keywords] : undefined}
      onSelect={onSelect}
      data-testid="palette-item"
      className={cn('group/item mx-2 flex cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-fg select-none', meta ? 'min-h-12 py-1.5' : 'h-10', 'data-[selected=true]:bg-hover')}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-sm text-icon">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {meta ? <span className="truncate text-xs text-fg-muted">{meta}</span> : null}
      </span>
      <span aria-hidden className="hidden shrink-0 items-center gap-1 text-fg-muted group-data-[selected=true]/item:flex">
        {external ? <ArrowUpRight className="size-3.5" /> : null}
        <CornerDownLeft className="size-3.5" />
      </span>
    </Command.Item>
  );
}

interface ActionRow {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly needs: readonly LedgerRight[];
  readonly icon: ReactNode;
  readonly keywords: readonly string[];
}

const ACTIONS: readonly ActionRow[] = [
  { id: 'new-invoice', label: 'New invoice', href: routes.newInvoice(), needs: ['invoice:write'], icon: <FilePlus2 aria-hidden className="size-4" />, keywords: ['invoice', 'bill a customer'] },
  { id: 'record-payment', label: 'Record payment', href: routes.newPayment(), needs: ['payment:record'], icon: <Wallet aria-hidden className="size-4" />, keywords: ['payment received', 'check'] },
  { id: 'new-bill', label: 'New bill', href: routes.newBill(), needs: ['bill:enter'], icon: <ReceiptText aria-hidden className="size-4" />, keywords: ['vendor bill', 'enter a bill'] },
  { id: 'new-expense', label: 'New expense', href: routes.newExpense(), needs: ['expense:submit'], icon: <Receipt aria-hidden className="size-4" />, keywords: ['receipt', 'card', 'pay me back'] },
  { id: 'import-statement', label: 'Import a statement', href: routes.bank(), needs: ['bank:reconcile'], icon: <Landmark aria-hidden className="size-4" />, keywords: ['bank statement', 'ofx', 'csv'] },
  { id: 'close-month', label: 'Close a month', href: routes.close(), needs: ['period:close'], icon: <CalendarCheck2 aria-hidden className="size-4" />, keywords: ['month end', 'lock'] },
  { id: 'import-file', label: 'Import a file', href: routes.newImport(), needs: ['import:run'], icon: <Upload aria-hidden className="size-4" />, keywords: ['csv', 'spreadsheet', 'quickbooks'] },
];

export function CommandPalette() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const open = useShellStore((state) => state.paletteOpen);
  const setOpen = useShellStore((state) => state.setPaletteOpen);
  const openShortcuts = useShellStore((state) => state.openShortcuts);
  const { rights, org, orgs, appUrls } = useShell();
  const pages = navFor(rights);
  const actions = ACTIONS.filter((action) => action.needs.some((right) => rights.includes(right)));

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const leave = (href: string) => {
    setOpen(false);
    window.location.assign(withThemeParam(href));
  };
  const setTheme = (theme: 'light' | 'dark') => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    persistTheme(theme);
    setOpen(false);
  };
  const switchOrg = async (orgId: string) => {
    setOpen(false);
    const result = await organization.setActive({ organizationId: orgId });
    if (!result.error) {
      queryClient.clear();
      router.push('/');
      router.refresh();
    }
  };
  const dark = typeof window !== 'undefined' && (document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && window.matchMedia(DARK_QUERY).matches));

  const apps: readonly { id: string; label: string; href: string }[] = [
    { id: 'portal', label: 'KitStak Portal', href: appUrls.portal },
    { id: 'crm', label: 'KitStak CRM', href: appUrls.crm },
    { id: 'wms', label: 'KitStak WMS', href: appUrls.wms },
    { id: 'projects', label: 'KitStak Projects', href: appUrls.projects },
    { id: 'pulse', label: 'KitStak Pulse', href: appUrls.pulse },
  ];

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search and commands"
      loop
      overlayClassName="fixed inset-0 z-[var(--z-modal)] bg-overlay/60 data-[state=open]:animate-fade-in"
      contentClassName={cn(
        'fixed top-[10vh] left-1/2 z-[var(--z-modal)] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden',
        'rounded-xl border border-border-subtle bg-raised shadow-modal outline-none data-[state=open]:animate-pop-in',
      )}
      className="flex max-h-[min(560px,76vh)] flex-col"
    >
      <div className="flex items-center gap-3 border-b border-border-subtle px-4">
        <Search aria-hidden className="size-5 shrink-0 text-icon" />
        <Command.Input placeholder="Go to a page or type a command" className="h-13 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-placeholder" data-testid="palette-input" />
        <Kbd>Esc</Kbd>
      </div>
      <Command.List className="min-h-0 flex-1 overflow-y-auto pb-2">
        <Command.Empty className="px-4 py-6 text-center text-sm text-fg-muted">Nothing matches that. Try a page name like Invoices or Bills.</Command.Empty>
        {actions.length > 0 ? (
          <Command.Group heading="Do something" className={groupClass}>
            {actions.map((action) => (
              <Item key={action.id} value={`action-${action.id}`} keywords={[action.label, ...action.keywords]} onSelect={() => go(action.href)} icon={action.icon}>
                {action.label}
              </Item>
            ))}
          </Command.Group>
        ) : null}
        {pages.length > 0 ? (
          <Command.Group heading="Go to" className={groupClass}>
            {pages.map((entry) => {
              const Icon = NAV_ICONS[entry.id];
              return (
                <Item key={entry.id} value={`page-${entry.id}`} keywords={[entry.label, ...entry.keywords]} onSelect={() => go(entry.href)} icon={<Icon aria-hidden className="size-4" />} meta={entry.description}>
                  {entry.label}
                </Item>
              );
            })}
          </Command.Group>
        ) : null}
        {orgs.length > 1 ? (
          <Command.Group heading="Switch organization" className={groupClass}>
            {orgs
              .filter((entry) => entry.id !== org.id)
              .map((entry) => (
                <Item key={entry.id} value={`org-${entry.id}`} keywords={[entry.name, 'organization', 'workspace']} onSelect={() => void switchOrg(entry.id)} icon={<span className="text-2xs font-bold">{orgInitials(entry.name)}</span>}>
                  Switch to {entry.name}
                </Item>
              ))}
          </Command.Group>
        ) : null}
        <Command.Group heading="KitStak apps" className={groupClass}>
          {apps.map((app) => (
            <Item key={app.id} value={`app-${app.id}`} keywords={[app.label]} onSelect={() => leave(app.href)} icon={<ArrowUpRight aria-hidden className="size-4" />} external>
              Open {app.label}
            </Item>
          ))}
        </Command.Group>
        <Command.Group heading="Preferences" className={groupClass}>
          <Item value="pref-theme" keywords={['theme', 'dark', 'light']} onSelect={() => setTheme(dark ? 'light' : 'dark')} icon={dark ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}>
            {dark ? 'Switch to light theme' : 'Switch to dark theme'}
          </Item>
          <Item value="pref-shortcuts" keywords={['keyboard', 'shortcuts', 'keys']} onSelect={openShortcuts} icon={<Keyboard aria-hidden className="size-4" />}>
            Keyboard shortcuts
          </Item>
          <Item
            value="pref-sign-out"
            keywords={['sign out', 'log out']}
            onSelect={() => {
              setOpen(false);
              void signOut().then(() => router.replace('/login?notice=signed-out'));
            }}
            icon={<LogOut aria-hidden className="size-4" />}
          >
            Sign out
          </Item>
        </Command.Group>
      </Command.List>
      <div className="hidden items-center gap-4 border-t border-border-subtle bg-sunken px-4 py-2 text-xs text-fg-muted sm:flex">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Kbd>Esc</Kbd> close
        </span>
      </div>
    </Command.Dialog>
  );
}
