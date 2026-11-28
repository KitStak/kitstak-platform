'use client';
/**
 * Signed in application frame (same anatomy as Pulse): a 56px top bar that carries the primary
 * navigation, then the page across the full width. Hosts the global surfaces every page can open:
 * the command palette and the shortcuts sheet.
 */
import type { ReactNode } from 'react';
import { CommandPalette } from '@/features/command/command-palette';
import { ShellProvider, type ShellContextValue } from './shell-context';
import { ShortcutsDialog } from './shortcuts-dialog';
import { TopBar } from './top-bar';
import { useShellHotkeys } from './use-shell-hotkeys';

export interface AppShellProps {
  readonly context: ShellContextValue;
  readonly children: ReactNode;
}

function Hotkeys() {
  useShellHotkeys();
  return null;
}

export function AppShell({ context, children }: AppShellProps) {
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
