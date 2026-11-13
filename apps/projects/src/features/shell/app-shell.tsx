'use client';
/**
 * Signed-in application frame (CRM/WMS anatomy): 56px top bar, collapsible left sidebar,
 * scrollable main area. Hosts the global surfaces every page can open: command palette,
 * quick add, task drawer (`?task=KEY`) and the shortcuts sheet.
 */
import type { ReactNode } from 'react';
import { CommandPalette } from '@/features/command/command-palette';
import { OnboardingHost } from '@/features/onboarding/onboarding-host';
import { QuickAddDialog } from '@/features/quick-add/quick-add-dialog';
import { TaskDrawerHost } from '@/features/task/task-drawer';
import type { OrgPerson, ProjectSummary, SpaceDTO } from '@/lib/types';
import { usePeople } from '@/lib/hooks/use-data';
import { MobileNav } from './mobile-nav';
import { ShellProvider, type ShellContextValue } from './shell-context';
import { ShortcutsDialog } from './shortcuts-dialog';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';
import { useShellHotkeys } from './use-shell-hotkeys';

export interface AppShellProps {
  readonly context: ShellContextValue;
  readonly initialProjects: readonly ProjectSummary[];
  readonly initialSpaces: readonly SpaceDTO[];
  readonly initialUnread: number;
  /** Server-loaded org people: every page resolves names on first paint (no "Former member" flash). */
  readonly initialPeople?: readonly OrgPerson[];
  readonly peopleLoadedAt?: number;
  readonly children: ReactNode;
}

/** Seeds the people cache before any page renders (notifyOnChangeProps: [] so it never re-renders). */
function SeedPeople({ people, loadedAt }: { readonly people?: readonly OrgPerson[]; readonly loadedAt?: number }) {
  usePeople({ initialData: people ? [...people] : undefined, initialDataUpdatedAt: loadedAt, notifyOnChangeProps: [] });
  return null;
}

function Hotkeys() {
  useShellHotkeys();
  return null;
}

export function AppShell({ context, initialProjects, initialSpaces, initialUnread, initialPeople, peopleLoadedAt, children }: AppShellProps) {
  return (
    <ShellProvider value={context}>
      <SeedPeople people={initialPeople} loadedAt={peopleLoadedAt} />
      <Hotkeys />
      <a
        href="#main-content"
        className="sr-only fixed top-2 left-2 z-[var(--z-toast)] rounded-md bg-primary px-3 py-2 font-semibold text-primary-fg focus:not-sr-only"
      >
        Skip to content
      </a>
      <div data-testid="app-shell" className="flex h-dvh min-h-[480px] flex-col overflow-hidden bg-app">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <div className="hidden md:flex">
            <Sidebar initialProjects={initialProjects} initialSpaces={initialSpaces} initialUnread={initialUnread} />
          </div>
          <main id="main-content" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-app outline-none">
            <div className="h-full overflow-auto">{children}</div>
          </main>
        </div>
      </div>
      <MobileNav />
      <CommandPalette />
      <QuickAddDialog />
      <TaskDrawerHost />
      <ShortcutsDialog />
      <OnboardingHost />
    </ShellProvider>
  );
}
