'use client';
/**
 * Ctrl/Cmd+K command palette (docs/crew/SPEC.md 6.1 `/search`, Cmd+K). Phase 0: go to any page the
 * person may open, the first actions (Add person, Open today, Make kiosk link), switch theme or
 * organization, open the Portal, sign out. Finding people by name or number arrives with Phase 1.
 * Same frame, group headings and row anatomy as the Pulse palette.
 */
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { useQueryClient } from '@tanstack/react-query';
import { CornerDownLeft, Keyboard, LayoutGrid, LogOut, Moon, Rocket, Search, Sun, TabletSmartphone, UserPlus, UserCheck } from 'lucide-react';
import { withThemeParam } from '@kitstak/ui/theme-handoff';
import { DARK_QUERY, persistTheme } from '@kitstak/ui/theme';
import { Kbd, cn, toast } from '@/components/ui';
import { organization, signOut } from '@/lib/auth-client';
import { navFor } from '@/lib/nav';
import { CREW_PAGES } from '@/lib/pages';
import { canCrew } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { NAV_ICONS } from '@/features/shell/nav-icons';
import { orgInitials } from '@/features/shell/org-switcher';
import { useShell } from '@/features/shell/shell-context';
import { useShellStore } from '@/features/shell/store';

const groupClass =
  '[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted';

function Item({ value, keywords, onSelect, icon, children, meta }: { readonly value: string; readonly keywords?: readonly string[]; readonly onSelect: () => void; readonly icon: ReactNode; readonly children: ReactNode; readonly meta?: ReactNode }) {
  return (
    <Command.Item
      value={value}
      keywords={keywords ? [...keywords] : undefined}
      onSelect={onSelect}
      data-testid="palette-item"
      className={cn('group/item mx-2 flex cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-fg select-none', meta ? 'min-h-12 py-1.5' : 'h-10', 'data-[selected=true]:bg-hover')}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-sm text-icon [&>svg]:size-4">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {meta ? <span className="truncate text-xs text-fg-muted">{meta}</span> : null}
      </span>
      <CornerDownLeft aria-hidden className="hidden size-3.5 shrink-0 text-fg-muted group-data-[selected=true]/item:block" />
    </Command.Item>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const open = useShellStore((state) => state.paletteOpen);
  const initial = useShellStore((state) => state.paletteQuery);
  const setOpen = useShellStore((state) => state.setPaletteOpen);
  const openShortcuts = useShellStore((state) => state.openShortcuts);
  const { crewRole, org, orgs, appUrls } = useShell();
  const [query, setQuery] = useState(initial);
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (open) setQuery(initial);
  }

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const nav = navFor(crewRole);
  const navIds = new Set(nav.map((entry) => entry.id));
  // Second level pages under an entry the person sees, that their role may open.
  const subPages = CREW_PAGES.filter((page) => page.nav && navIds.has(page.nav) && !page.path.includes('[') && page.needs !== 'self' && canCrew(crewRole, page.needs) && !nav.some((entry) => entry.href === page.path));

  const toggleTheme = () => {
    const current = document.documentElement.dataset.theme ?? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    persistTheme(next);
    setOpen(false);
  };

  const switchOrg = async (orgId: string) => {
    setOpen(false);
    const result = await organization.setActive({ organizationId: orgId });
    if (result.error) {
      toast.error("Couldn't switch organizations", result.error.message ?? 'Please try again.');
      return;
    }
    queryClient.clear();
    router.push('/');
    router.refresh();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search and commands"
      loop
      overlayClassName="fixed inset-0 z-[var(--z-modal)] bg-overlay/60 data-[state=open]:animate-fade-in"
      contentClassName={cn('fixed top-[10vh] left-1/2 z-[var(--z-modal)] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden', 'rounded-xl border border-border-subtle bg-raised shadow-modal outline-none data-[state=open]:animate-pop-in')}
      className="flex max-h-[min(560px,76vh)] flex-col"
    >
      <div className="flex items-center gap-3 border-b border-border-subtle px-4">
        <Search aria-hidden className="size-5 shrink-0 text-icon" />
        <Command.Input value={query} onValueChange={setQuery} placeholder="Go to a page or type a command" className="h-13 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-placeholder" data-testid="palette-input" />
        <Kbd>Esc</Kbd>
      </div>
      <Command.List className="min-h-0 flex-1 overflow-y-auto pb-2">
        <Command.Empty className="px-4 py-8 text-center text-sm text-fg-muted">Nothing matches that. Finding people by name arrives in phase 1.</Command.Empty>
        {crewRole !== 'none' ? (
          <Command.Group heading="Do something" className={groupClass}>
            <Item value="Open today" keywords={['board', 'floor']} icon={<UserCheck aria-hidden />} onSelect={() => go(routes.today())}>
              Open today
            </Item>
            {canCrew(crewRole, 'person:manage') ? (
              <Item value="Add person" keywords={['new person', 'employee', 'temp']} icon={<UserPlus aria-hidden />} onSelect={() => go(routes.newPerson())}>
                Add person
              </Item>
            ) : null}
            {canCrew(crewRole, 'kiosk:manage') ? (
              <Item value="Make kiosk link" keywords={['time clock', 'tablet', 'device']} icon={<TabletSmartphone aria-hidden />} onSelect={() => go(routes.settingsKiosks())}>
                Make kiosk link
              </Item>
            ) : null}
            <Item value="Getting started" keywords={['welcome', 'setup', 'checklist']} icon={<Rocket aria-hidden />} onSelect={() => go(routes.welcome())}>
              Getting started
            </Item>
          </Command.Group>
        ) : null}
        {nav.length > 0 ? (
          <Command.Group heading="Go to" className={groupClass}>
            {nav.map((entry) => {
              const Icon = NAV_ICONS[entry.id];
              return (
                <Item key={entry.id} value={entry.label} keywords={entry.keywords} icon={<Icon aria-hidden />} meta={entry.description} onSelect={() => go(entry.href)}>
                  {entry.label}
                </Item>
              );
            })}
            {subPages.map((page) => {
              const Icon = page.nav ? NAV_ICONS[page.nav] : Search;
              return (
                <Item key={page.id} value={page.title} icon={<Icon aria-hidden />} meta={page.why} onSelect={() => go(page.path)}>
                  {page.title}
                </Item>
              );
            })}
          </Command.Group>
        ) : null}
        {orgs.length > 1 ? (
          <Command.Group heading="Organizations" className={groupClass}>
            {orgs
              .filter((entry) => entry.id !== org.id)
              .map((entry) => (
                <Item key={entry.id} value={`Switch to ${entry.name}`} icon={<span className="text-2xs font-bold text-fg-secondary">{orgInitials(entry.name)}</span>} onSelect={() => void switchOrg(entry.id)}>
                  Switch to {entry.name}
                </Item>
              ))}
          </Command.Group>
        ) : null}
        <Command.Group heading="KitStak" className={groupClass}>
          <Item value="Switch theme" keywords={['dark', 'light']} icon={<span className="contents"><Sun aria-hidden className="dark:hidden" /><Moon aria-hidden className="hidden dark:block" /></span>} onSelect={toggleTheme}>
            Switch light and dark
          </Item>
          <Item value="Keyboard shortcuts" icon={<Keyboard aria-hidden />} onSelect={openShortcuts}>
            Keyboard shortcuts
          </Item>
          <Item value="KitStak Portal" keywords={['apps']} icon={<LayoutGrid aria-hidden />} onSelect={() => window.location.assign(withThemeParam(appUrls.portal))}>
            KitStak Portal
          </Item>
          <Item
            value="Sign out"
            icon={<LogOut aria-hidden />}
            onSelect={() => {
              setOpen(false);
              void signOut().then(() => {
                router.replace('/login?notice=signed-out');
                router.refresh();
              });
            }}
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
