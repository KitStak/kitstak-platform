'use client';
/**
 * Signed-in application frame (same anatomy as the WMS): a 56px top bar that carries the primary
 * navigation, then the page across the full width. Hosts the global surfaces every page can
 * open: the command palette and the shortcuts sheet.
 */
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { CommandPalette } from '@/features/command/command-palette';
import type { OrgPerson } from '@/lib/types';
import { usePeople } from '@/lib/hooks/use-data';
import { ShellProvider, type ShellContextValue } from './shell-context';
import { ShortcutsDialog } from './shortcuts-dialog';
import { PlanBanner } from '@kitstak/ui/plan-banner';
import { ViewOnlyGuard, ViewOnlyPage, WRITE_LABEL, isWritePath } from '@kitstak/ui/view-only';
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

/**
 * Pulse screens that are a form from the first pixel: the new job wizard, the day grid and the
 * bulk grid where work is logged, the new import, and the first run steps ("Save the rate").
 */
const PULSE_WRITE_PATHS: readonly (string | RegExp)[] = [/^\/jobs\/new$/, /^\/log$/, /^\/log\/bulk$/, /^\/import\/new$/, /^\/welcome$/];

/**
 * View only is told before a form opens (docs/billing/SPEC.md 9.4). A press on a link to one of
 * the screens above, on anything marked `data-plan-write`, or on any button whose label starts a
 * change ("Add a labor class", "Save", "New job", "Log work": see `WRITE_LABEL`) opens one small
 * dialog with the banner's words and button. Those buttons are dimmed too.
 */
function PlanViewOnly({ plan }: { readonly plan: ShellContextValue['plan'] }) {
  const pathname = usePathname();
  return (
    <ViewOnlyGuard
      active={plan?.access === 'read_only'}
      notice={plan?.notice ?? null}
      pathname={pathname}
      writePaths={PULSE_WRITE_PATHS}
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
function PlanPage({ plan, children }: { readonly plan: ShellContextValue['plan']; readonly children: ReactNode }) {
  const pathname = usePathname();
  if (plan?.access === 'read_only' && isWritePath(pathname, PULSE_WRITE_PATHS)) {
    return (
      <>
        <ViewOnlyPage notice={plan.notice ?? null} homeHref="/" />
        {/* The form stays in the tree, hidden and out of reach, so Next can still check the route in development. */}
        <div hidden>{children}</div>
      </>
    );
  }
  return <>{children}</>;
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
          <div className="h-full overflow-auto">
            <PlanPage plan={context.plan}>{children}</PlanPage>
          </div>
        </main>
      </div>
      <CommandPalette />
      <ShortcutsDialog />
      <PlanViewOnly plan={context.plan} />
    </ShellProvider>
  );
}
