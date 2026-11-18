'use client';
/**
 * Ctrl/Cmd+K command palette. Type to:
 *   - jump to any page, report or CSV stream,
 *   - start something (log work, new job, import, export, open the wall display, close the month),
 *   - switch theme or organization, open a sibling KitStak app, sign out.
 * Rows a person may not use are left out by Pulse role. Visual language matches the Portal, CRM
 * and Projects palettes (same frame, group headings, row anatomy, footer).
 */
import { useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Command, defaultFilter, useCommandState } from 'cmdk';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  CalendarCheck2,
  CalendarRange,
  ClipboardCheck,
  ClipboardPen,
  CornerDownLeft,
  Download,
  FileText,
  Keyboard,
  LogOut,
  Moon,
  PackagePlus,
  Rocket,
  Search,
  Sun,
  TextSearch,
  Tv,
  Upload,
} from 'lucide-react';
import { withThemeParam } from '@kitstak/ui/theme-handoff';
import { DARK_QUERY, persistTheme } from '@kitstak/ui/theme';
import { Kbd, cn } from '@/components/ui';
import { organization, signOut } from '@/lib/auth-client';
import { navFor, subPagesFor } from '@/lib/nav';
import { REPORTS } from '@/lib/reports';
import { routes } from '@/lib/routes';
import { NAV_ICONS } from '@/features/shell/nav-icons';
import { useShell } from '@/features/shell/shell-context';
import { orgInitials } from '@/features/shell/org-switcher';
import { useShellStore } from '@/features/shell/store';

const groupClass =
  '[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted';

/** Sub pages that have their own action row. */
const ACTION_PAGES: ReadonlySet<string> = new Set(['welcome', 'log-bulk', 'log-review', 'import-new', 'export', 'wall', 'settings-close']);

/** Rows that must always show while typing (they act on the typed text itself). */
const ALWAYS = 'always:';
function paletteFilter(value: string, search: string, keywords?: string[]): number {
  if (value.startsWith(ALWAYS)) return 0.01;
  const score = defaultFilter(value, search, keywords);
  // cmdk keeps anything above 0; drop the loose fuzzy hits so only real matches stay.
  return score < (search.trim().length >= 3 ? 0.3 : 0.05) ? 0 : score;
}

function Item({
  value,
  keywords,
  onSelect,
  icon,
  children,
  meta,
  hint,
  external,
  forceMount,
  testId = 'palette-item',
}: {
  readonly value: string;
  readonly keywords?: readonly string[];
  readonly onSelect: () => void;
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly meta?: ReactNode;
  readonly hint?: ReactNode;
  readonly external?: boolean;
  readonly forceMount?: boolean;
  readonly testId?: string;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords ? [...keywords] : undefined}
      onSelect={onSelect}
      forceMount={forceMount}
      data-testid={testId}
      className={cn(
        'group/item mx-2 flex cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-fg select-none',
        meta ? 'min-h-12 py-1.5' : 'h-10',
        'data-[selected=true]:bg-hover',
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-sm text-icon">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {meta ? <span className="truncate text-xs text-fg-muted">{meta}</span> : null}
      </span>
      {hint ? <span className="flex shrink-0 items-center gap-1 text-xs text-fg-muted pointer-coarse:has-[kbd]:hidden">{hint}</span> : null}
      <span aria-hidden className="hidden shrink-0 items-center gap-1 text-fg-muted group-data-[selected=true]/item:flex">
        {external ? <ArrowUpRight className="size-3.5" /> : null}
        <CornerDownLeft className="size-3.5" />
      </span>
    </Command.Item>
  );
}

/** "Nothing matches" line, shown above the search everything row. */
function PaletteEmpty({ typing }: { readonly typing: boolean }) {
  const localCount = useCommandState((state) => state.filtered.count);
  // The search everything row always counts as one match.
  if (!typing || localCount > 1) return null;
  return (
    <div className="px-6 pt-6 pb-2 text-center text-sm text-fg-muted" role="status">
      No page, report or command matches. Press Enter to search everything.
    </div>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { org, orgs, appUrls, modules, pulseRole, seesMoney, can } = useShell();
  const open = useShellStore((state) => state.paletteOpen);
  const query = useShellStore((state) => state.paletteQuery);
  const setOpen = useShellStore((state) => state.setPaletteOpen);
  const openShortcuts = useShellStore((state) => state.openShortcuts);
  const setQuery = useCallback((value: string) => useShellStore.setState({ paletteQuery: value }), []);

  const close = useCallback(() => setOpen(false), [setOpen]);
  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );
  const openApp = useCallback(
    (url: string) => {
      close();
      window.open(withThemeParam(url), '_blank', 'noopener');
    },
    [close],
  );
  const switchOrg = useCallback(
    async (orgId: string) => {
      close();
      if (orgId === org.id) return;
      await organization.setActive({ organizationId: orgId });
      queryClient.clear();
      router.push('/');
      router.refresh();
    },
    [close, org.id, queryClient, router],
  );
  const setTheme = useCallback(
    (next: 'light' | 'dark') => {
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      persistTheme(next);
      close();
    },
    [close],
  );
  const currentTheme = () => document.documentElement.dataset.theme ?? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light');
  const onSignOut = useCallback(async () => {
    close();
    await signOut();
    router.replace('/login?notice=signed-out');
    router.refresh();
  }, [close, router]);

  const typed = query.trim();
  const typing = typed.length > 0;
  const pages = navFor(pulseRole);
  const hasAccess = pulseRole !== 'none';
  // Pages that already have a row under "Do something" are not listed twice.
  const subPages = subPagesFor(pulseRole, seesMoney).filter((page) => !ACTION_PAGES.has(page.id));
  // A page with its own row wins over the section it sits under, so the section drops that keyword.
  const subLabels = new Set(subPages.map((page) => page.label.toLowerCase()));
  const seesReports = pages.some((entry) => entry.id === 'reports');
  const reports = seesReports ? REPORTS.filter((report) => seesMoney || !report.needsMoney) : [];

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search and commands"
      filter={paletteFilter}
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
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search pages and reports, or type a command"
          className="h-13 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-placeholder"
          data-testid="palette-input"
        />
        <Kbd>Esc</Kbd>
      </div>
      <Command.List className="min-h-0 flex-1 overflow-y-auto pb-2">
        <PaletteEmpty typing={typing} />

        {hasAccess ? (
          <Command.Group heading="Do something" className={groupClass}>
            {can('production:log') ? (
              <Item value="action-log-work" keywords={['log work', 'production', 'daily entry', 'units', 'hours', 'today']} onSelect={() => go(routes.log())} icon={<ClipboardPen aria-hidden className="size-4" />} hint={<Kbd>L</Kbd>} testId="palette-log-work">
                Log work
              </Item>
            ) : null}
            {can('job:manage') ? (
              <Item value="action-new-job" keywords={['new job', 'create', 'add', 'quote']} onSelect={() => go(routes.newJob())} icon={<PackagePlus aria-hidden className="size-4" />} hint={<Kbd>N</Kbd>} testId="palette-new-job">
                New job
              </Item>
            ) : null}
            {can('production:log') ? (
              <Item value="action-log-bulk" keywords={['log many days', 'bulk', 'catch up', 'paste days']} onSelect={() => go(routes.logBulk())} icon={<CalendarRange aria-hidden className="size-4" />} meta="One sheet for a run of days">
                Log many days
              </Item>
            ) : null}
            {can('day:review') ? (
              <Item value="action-review-day" keywords={['review the day', 'approve', 'send back', 'check entries']} onSelect={() => go(routes.logReview())} icon={<ClipboardCheck aria-hidden className="size-4" />} meta="Check the day, then approve it">
                Review the day
              </Item>
            ) : null}
            {can('production:log') ? (
              <Item value="action-import" keywords={['import', 'upload', 'csv', 'spreadsheet', 'excel']} onSelect={() => go(routes.newImport())} icon={<Upload aria-hidden className="size-4" />} meta="Bring in a spreadsheet">
                Import a file
              </Item>
            ) : null}
            <Item value="action-export" keywords={['export', 'download', 'csv', 'backup']} onSelect={() => go(routes.exportCenter())} icon={<Download aria-hidden className="size-4" />} meta="Download your data as CSV files">
              Export data
            </Item>
            <Item value="action-wall" keywords={['wall', 'tv', 'display', 'floor', 'screen']} onSelect={() => go(routes.wall())} icon={<Tv aria-hidden className="size-4" />} meta="Full screen goals and pace for the floor TV">
              Open wall display
            </Item>
            {can('period:close') ? (
              <Item value="action-close-month" keywords={['close month', 'month end', 'lock', 'period']} onSelect={() => go(routes.settingsClose())} icon={<CalendarCheck2 aria-hidden className="size-4" />}>
                Close a month
              </Item>
            ) : null}
            <Item value="action-getting-started" keywords={['getting started', 'welcome', 'setup', 'checklist', 'sample data']} onSelect={() => go(routes.welcome())} icon={<Rocket aria-hidden className="size-4" />}>
              Getting started
            </Item>
          </Command.Group>
        ) : null}

        {pages.length > 0 ? (
          <Command.Group heading="Go to" className={groupClass}>
            {pages.map((entry) => {
              const Icon = NAV_ICONS[entry.id];
              return (
                <Item
                  key={entry.id}
                  value={`go-${entry.id}`}
                  keywords={[entry.label, ...entry.keywords.filter((keyword) => !subLabels.has(keyword.toLowerCase()))]}
                  onSelect={() => go(entry.href)}
                  icon={<Icon aria-hidden className="size-4" />}
                  meta={typing ? entry.description : undefined}
                  hint={
                    entry.chord ? (
                      <>
                        <Kbd>G</Kbd>
                        <Kbd>{entry.chord}</Kbd>
                      </>
                    ) : undefined
                  }
                >
                  {entry.label}
                </Item>
              );
            })}
          </Command.Group>
        ) : null}

        {typing && subPages.length > 0 ? (
          <Command.Group heading="More pages" className={groupClass}>
            {subPages.map((page) => {
              const Icon = NAV_ICONS[page.parent];
              return (
                <Item key={page.id} value={`${page.label} (${page.id})`} keywords={[page.label, ...page.keywords]} onSelect={() => go(page.href)} icon={<Icon aria-hidden className="size-4" />} meta={page.description} testId="palette-sub-page">
                  {page.label}
                </Item>
              );
            })}
          </Command.Group>
        ) : null}

        {typing && reports.length > 0 ? (
          <Command.Group heading="Reports" className={groupClass}>
            {reports.map((report) => (
              <Item key={report.slug} value={`report-${report.slug}`} keywords={[report.name, 'report']} onSelect={() => go(routes.report(report.slug))} icon={<FileText aria-hidden className="size-4" />} meta={report.description}>
                {report.name}
              </Item>
            ))}
          </Command.Group>
        ) : null}

        {typing && hasAccess ? (
          <Command.Group heading="Search" className={groupClass} forceMount>
            <Item value={`${ALWAYS}search-all`} forceMount onSelect={() => go(routes.search(typed))} icon={<TextSearch aria-hidden className="size-4" />} meta="Pages, reports and data files" testId="palette-search-all">
              Search everything for &ldquo;{typed}&rdquo;
            </Item>
          </Command.Group>
        ) : null}

        {orgs.length > 1 ? (
          <Command.Group heading="Switch organization" className={groupClass}>
            {orgs.map((entry) => (
              <Item
                key={entry.id}
                value={`org-${entry.slug}`}
                keywords={['switch', 'organization', 'workspace', entry.name]}
                onSelect={() => void switchOrg(entry.id)}
                icon={<span className="inline-flex size-6 items-center justify-center rounded-sm bg-sunken text-2xs font-bold text-fg-secondary">{orgInitials(entry.name)}</span>}
                meta={<span className="capitalize">{entry.role}</span>}
                hint={entry.id === org.id ? 'Current' : undefined}
              >
                {entry.name}
              </Item>
            ))}
          </Command.Group>
        ) : null}

        <Command.Group heading="KitStak apps" className={groupClass}>
          <Item value="open-portal" keywords={['portal', 'launcher', 'billing', 'apps']} onSelect={() => openApp(appUrls.portal)} icon={<ArrowUpRight aria-hidden className="size-4" />} meta="Launcher, billing and your team" external>
            Open Portal
          </Item>
          {modules.crm ? (
            <Item value="open-crm" keywords={['crm', 'deals', 'sales', 'customers']} onSelect={() => openApp(`${appUrls.crm}/${org.slug}`)} icon={<ArrowUpRight aria-hidden className="size-4" />} meta="Deals, accounts and pipelines" external>
              Open CRM
            </Item>
          ) : null}
          {modules.wms ? (
            <Item value="open-wms" keywords={['wms', 'warehouse', 'orders', 'inventory', 'work orders']} onSelect={() => openApp(appUrls.wms)} icon={<ArrowUpRight aria-hidden className="size-4" />} meta="Orders, inventory and receiving" external>
              Open WMS
            </Item>
          ) : null}
          {modules.projects ? (
            <Item value="open-projects" keywords={['projects', 'tasks', 'timelines']} onSelect={() => openApp(appUrls.projects)} icon={<ArrowUpRight aria-hidden className="size-4" />} meta="Projects, tasks and timelines" external>
              Open Projects
            </Item>
          ) : null}
        </Command.Group>

        <Command.Group heading="Preferences" className={groupClass}>
          <Item value="theme-dark" keywords={['dark', 'theme', 'night', 'mode']} onSelect={() => setTheme('dark')} icon={<Moon aria-hidden className="size-4" />} hint={typeof document !== 'undefined' && currentTheme() === 'dark' ? 'On' : undefined}>
            Dark mode
          </Item>
          <Item value="theme-light" keywords={['light', 'theme', 'day', 'mode']} onSelect={() => setTheme('light')} icon={<Sun aria-hidden className="size-4" />} hint={typeof document !== 'undefined' && currentTheme() === 'light' ? 'On' : undefined}>
            Light mode
          </Item>
          <Item
            value="shortcuts"
            keywords={['keyboard', 'shortcuts', 'help', 'keys']}
            onSelect={() => {
              close();
              openShortcuts();
            }}
            icon={<Keyboard aria-hidden className="size-4" />}
            hint={<Kbd>?</Kbd>}
          >
            Keyboard shortcuts
          </Item>
          <Item value="sign-out" keywords={['log out', 'logout', 'sign out', 'exit']} onSelect={() => void onSignOut()} icon={<LogOut aria-hidden className="size-4" />}>
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
