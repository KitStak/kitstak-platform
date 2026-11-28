'use client';
/**
 * Signed in application frame (the Pulse anatomy): a 56px top bar that carries the navigation,
 * then the page across the full width. Hosts the command palette and the shortcuts sheet.
 * There is no plan banner or view only guard: Crew is a preview with no plan to lapse (SPEC 3.4).
 */
import type { ReactNode } from 'react';
import { CommandPalette } from '@/features/command/command-palette';
import { ShellProvider, type ShellContextValue } from './shell-context';
import { ShortcutsDialog } from './shortcuts-dialog';
import { TopBar } from './top-bar';
import { useShellHotkeys } from './use-shell-hotkeys';

function Hotkeys() {
  useShellHotkeys();
  return null;
}

export function AppShell({ context, children }: { readonly context: ShellContextValue; readonly children: ReactNode }) {
  return (
    <ShellProvider value={context}>
      <Hotkeys />
      <a href="#main-content" className="sr-only fixed top-2 left-2 z-[var(--z-toast)] rounded-md bg-primary px-3 py-2 font-semibold text-primary-fg focus:not-sr-only">
        Skip to content
      </a>
      <div data-testid="app-shell" className="flex h-dvh min-h-[480px] flex-col overflow-hidden bg-app">
        <TopBar />
        <main id="main-content" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-app outline-none">
          <div className="h-full overflow-auto">{children}</div>
        </main>
      </div>
      <CommandPalette />
      <ShortcutsDialog />
    </ShellProvider>
  );
}
