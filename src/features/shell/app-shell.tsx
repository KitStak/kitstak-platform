'use client';
import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CommandPalette } from './command-palette';
import { CreateBoardDialog } from './dialogs/create-board-dialog';
import { CreateSimpleDialog } from './dialogs/create-simple-dialog';
import { InviteDialog } from './dialogs/invite-dialog';
import { MobileNav } from './mobile-nav';
import { ShortcutsDialog } from './dialogs/shortcuts-dialog';
import { OrgProvider, type OrgContextValue } from './org-context';
import { routes } from './routes';
import { useShellStore, type CreateRequest } from './store';
import { TopBar } from './top-bar';
import { useShellLayout } from './use-media-query';
import { useShellHotkeys } from './use-shell-hotkeys';
import { useShellRealtime } from './use-shell-realtime';

/**
 * Extension points for feature agents. When a slot is omitted the shell uses its built-in
 * implementation (or a route fallback), so every control is always functional.
 */
export interface AppShellSlots {
  /** Right-side notifications panel; rendered while the bell is active. Receives `onClose`. */
  readonly notificationsPanel?: (onClose: () => void) => ReactNode;
  /** Replaces the built-in board creation dialog (e.g. a template wizard). */
  readonly createBoard?: (request: CreateRequest, onClose: () => void) => ReactNode;
  /** Replaces the built-in workspace / folder dialogs (wizards module). */
  readonly createWorkspace?: (request: CreateRequest, onClose: () => void) => ReactNode;
  readonly createFolder?: (request: CreateRequest, onClose: () => void) => ReactNode;
  /** Replaces the built-in invite dialog. Rendered only while the invite panel is open. */
  readonly invite?: (onClose: () => void) => ReactNode;
  /** Extra command palette groups (record search). */
  readonly searchGroups?: (query: string, close: () => void) => ReactNode;
}

export interface AppShellProps {
  readonly context: OrgContextValue;
  readonly slots?: AppShellSlots;
  readonly children: ReactNode;
}

function CreateDialogs({ slots }: { readonly slots?: AppShellSlots }) {
  const request = useShellStore((state) => state.createRequest);
  const clear = useShellStore((state) => state.clearCreateRequest);
  if (!request) return null;
  const onOpenChange = (open: boolean) => {
    if (!open) clear();
  };
  if (request.kind === 'board') {
    if (slots?.createBoard) return <>{slots.createBoard(request, clear)}</>;
    if (!request.workspaceId) return null;
    return (
      <CreateBoardDialog
        open
        onOpenChange={onOpenChange}
        workspaceId={request.workspaceId}
        folderId={request.folderId}
        templateId={request.templateId}
        initialName={request.name}
      />
    );
  }
  if (request.kind === 'workspace' && slots?.createWorkspace) return <>{slots.createWorkspace(request, clear)}</>;
  if (request.kind === 'folder' && slots?.createFolder) return <>{slots.createFolder(request, clear)}</>;
  return (
    <CreateSimpleDialog
      kind={request.kind}
      open
      onOpenChange={onOpenChange}
      workspaceId={request.workspaceId}
      parentFolderId={request.folderId}
    />
  );
}

function Panels({ slots, orgSlug }: { readonly slots?: AppShellSlots; readonly orgSlug: string }) {
  const router = useRouter();
  const panel = useShellStore((state) => state.panel);
  const closePanel = useShellStore((state) => state.closePanel);
  const hasNotificationsPanel = Boolean(slots?.notificationsPanel);

  useEffect(() => {
    if (panel === 'notifications' && !hasNotificationsPanel) {
      closePanel();
      router.push(routes.notifications(orgSlug));
    }
  }, [panel, hasNotificationsPanel, closePanel, router, orgSlug]);

  const onOpenChange = (open: boolean) => {
    if (!open) closePanel();
  };
  return (
    <>
      <CommandPalette extraGroups={slots?.searchGroups} />
      {slots?.invite ? (
        panel === 'invite' ? slots.invite(closePanel) : null
      ) : (
        <InviteDialog open={panel === 'invite'} onOpenChange={onOpenChange} />
      )}
      <ShortcutsDialog open={panel === 'shortcuts'} onOpenChange={onOpenChange} />
      {panel === 'notifications' && slots?.notificationsPanel ? slots.notificationsPanel(closePanel) : null}
    </>
  );
}

/**
 * Authenticated application frame, the same shell as KitStak WMS: a 56px top bar holding the
 * primary navigation, with the page below it. Below the md breakpoint the navigation collapses
 * into an off-canvas drawer. Pages render into <main>, which owns its own scrolling.
 */
export function AppShell({ context, slots, children }: AppShellProps) {
  useShellHotkeys(context.org.slug);
  useShellRealtime(context.org.id);
  const layout = useShellLayout();
  return (
    <OrgProvider value={context}>
      <a
        href="#main-content"
        className="sr-only fixed top-2 left-2 z-[var(--z-toast)] rounded-md bg-primary px-3 py-2 font-semibold text-primary-fg focus:not-sr-only"
      >
        Skip to content
      </a>
      <div data-testid="app-shell" className="flex h-dvh min-h-[560px] flex-col overflow-hidden bg-app">
        <TopBar />
        <main id="main-content" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-app outline-none">
          <div className="h-full overflow-auto">{children}</div>
        </main>
      </div>
      {layout === 'drawer' ? <MobileNav /> : null}
      <Panels slots={slots} orgSlug={context.org.slug} />
      <CreateDialogs slots={slots} />
    </OrgProvider>
  );
}
