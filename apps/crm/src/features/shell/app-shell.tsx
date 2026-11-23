'use client';
import { Suspense, useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PlanBanner } from '@kitstak/ui/plan-banner';
import { ViewOnlyGuard, askViewOnly } from '@kitstak/ui/view-only';
import { CommandPalette } from './command-palette';
import { CreateBoardDialog } from './dialogs/create-board-dialog';
import { CreateSimpleDialog } from './dialogs/create-simple-dialog';
import { InviteDialog } from './dialogs/invite-dialog';
import { MobileNav } from './mobile-nav';
import { ShortcutsDialog } from './dialogs/shortcuts-dialog';
import { OrgProvider, usePlanReadOnly, type OrgContextValue } from './org-context';
import { routes } from './routes';
import { SetupCallout } from './setup-callout';
import { useShellStore, type CreateRequest } from './store';
import { TopBar } from './top-bar';
import { useShellLayout } from './use-media-query';
import { useShellHotkeys } from './use-shell-hotkeys';
import { useShellPrefetch } from './use-shell-prefetch';
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

/** CRM screens that start a change: the import wizard. Create dialogs are caught in the shell store. */
const CRM_WRITE_PATHS: readonly (string | RegExp)[] = [/^\/[^/]+\/import$/];

function CreateDialogs({ slots }: { readonly slots?: AppShellSlots }) {
  const request = useShellStore((state) => state.createRequest);
  const clear = useShellStore((state) => state.clearCreateRequest);
  // View only: every way to start a board, workspace or folder (the home button, the sidebar, the
  // command palette, the setup card) asks through this store. The form never opens. The person
  // sees why, and the banner's button, before they type anything.
  const readOnly = usePlanReadOnly();
  useEffect(() => {
    if (!readOnly || !request) return;
    clear();
    askViewOnly();
  }, [readOnly, request, clear]);
  if (!request || readOnly) return null;
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

  // View only: "Invite" opens the view only dialog, not the invite form.
  const readOnly = usePlanReadOnly();
  const inviteBlocked = readOnly && panel === 'invite';
  useEffect(() => {
    if (!inviteBlocked) return;
    closePanel();
    askViewOnly();
  }, [inviteBlocked, closePanel]);

  const onOpenChange = (open: boolean) => {
    if (!open) closePanel();
  };
  return (
    <>
      <CommandPalette extraGroups={slots?.searchGroups} />
      {inviteBlocked ? null : slots?.invite ? (
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
  useShellPrefetch(context.org.id);
  const layout = useShellLayout();
  const pathname = usePathname();
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
        {/* Trial, payment and view only notices: above the page, never over content. */}
        <PlanBanner notice={context.plan?.notice ?? null} dismissible />
        {/* In-context setup arrival (?setup=<step_key>); Suspense: useSearchParams. */}
        <Suspense fallback={null}>
          <SetupCallout />
        </Suspense>
        <main id="main-content" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-app outline-none">
          <div className="h-full overflow-auto">{children}</div>
        </main>
      </div>
      {layout === 'drawer' ? <MobileNav /> : null}
      <Panels slots={slots} orgSlug={context.org.slug} />
      <ViewOnlyGuard
        active={context.plan?.access === 'read_only'}
        notice={context.plan?.notice ?? null}
        pathname={pathname}
        writePaths={CRM_WRITE_PATHS}
        homeHref={`/${context.org.slug}`}
      />
      <CreateDialogs slots={slots} />
    </OrgProvider>
  );
}
