'use client';
/**
 * Signed-in application frame (same anatomy as the WMS): a 56px top bar that carries the primary
 * navigation, then the page across the full width. Hosts the global surfaces every page can
 * open: the command palette and the shortcuts sheet.
 */
import type { ReactNode } from 'react';
import { CommandPalette } from '@/features/command/command-palette';
import type { OrgPerson } from '@/lib/types';
import { usePeople } from '@/lib/hooks/use-data';
import { ShellProvider, type ShellContextValue } from './shell-context';
import { ShortcutsDialog } from './shortcuts-dialog';
import { PlanBanner } from '@kitstak/ui/plan-banner';
import { TopBar } from './top-bar';
import { useShellHotkeys } from './use-shell-hotkeys';

export interface AppShellProps {
  readonly context: ShellContextValue;
  /** Server-loaded org people: every page resolves names on first paint (no "Former member" flash). */
  readonly initialPeople?: readonly OrgPerson[];
  readonly peopleLoadedAt?: number;
  readonly children: ReactNode;
}

/** Seeds the people cache before any page renders (notifyOnChangeProps: [] so it never re-renders). */
function SeedPeople({ people, loadedAt }: { readonly people?: readonly OrgPerson[]; readonly loadedAt?: number }) {
  usePeople({ initialData: people ? [...people] : undefined, initialDataUpdatedAt: loadedAt, notifyOnChangeProps: [], enabled: people !== undefined });
  return null;
}

function Hotkeys() {
  useShellHotkeys();
  return null;
}

export function AppShell({ context, initialPeople, peopleLoadedAt, children }: AppShellProps) {
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
        {/* Trial, payment and view only notices: above the page, never over content. */}
        <PlanBanner notice={context.plan?.notice ?? null} dismissible />
        <main id="main-content" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-app outline-none">
          <div className="h-full overflow-auto">{children}</div>
        </main>
      </div>
      <CommandPalette />
      <ShortcutsDialog />
    </ShellProvider>
  );
}
