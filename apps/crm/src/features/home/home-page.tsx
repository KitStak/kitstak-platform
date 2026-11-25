'use client';
/**
 * Org home on the shared dashboard frame (docs/design/UI-CLEANUP.md): greeting header with
 * Import and New board, the Getting started guide, recently visited cards, then work (my work
 * due this week, the updates feed) with a rail of inbox, favorites and templates.
 * One aggregate request (`/shell/home`) feeds the main column.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload } from 'lucide-react';
import { DashColumns, DashboardFrame, DashboardHeader } from '@kitstak/ui/dashboard';
import { useGreeting } from '@kitstak/ui/text';
import { Button, cn } from '@/components/ui';
import { useShellHome, useWorkspaces } from '@/features/shell/api';
import { useCan, useOrg } from '@/features/shell/org-context';
import { useHydrated } from '@/lib/hooks';
import { routes } from '@/features/shell/routes';
import { startRouteProgress } from '@/features/shell/route-progress';
import { useShellStore } from '@/features/shell/store';
import { weekWindow } from '@/server/services/shell-home-model';
import { FavoritesCard, InboxPreview, TemplatesRail } from './home-rail';
import { MyWorkSection, RecentSection, UpdatesSection } from './home-sections';
import { SetupGuideCard } from './setup-guide-card';

function useActiveWorkspaceId(): string | null {
  const { org } = useOrg();
  const workspaces = useWorkspaces(org.id);
  const stored = useShellStore((state) => state.activeWorkspaceByOrg[org.id]);
  const list = workspaces.data ?? [];
  return list.find((workspace) => workspace.id === stored)?.id ?? list[0]?.id ?? null;
}

function QuickActions({ workspaceId }: { readonly workspaceId: string | null }) {
  const router = useRouter();
  const { org } = useOrg();
  const requestCreate = useShellStore((state) => state.requestCreate);
  const canCreate = useCan('board:create');
  const canImport = useCan('data:import');
  // Enabled while workspaces load: a click is queued and opens the dialog once one is known.
  const [pendingCreate, setPendingCreate] = useState(false);
  useEffect(() => {
    if (!pendingCreate || !workspaceId) return;
    const timer = setTimeout(() => {
      setPendingCreate(false);
      requestCreate({ kind: 'board', workspaceId });
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingCreate, workspaceId, requestCreate]);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="home-quick-actions">
      {canImport ? (
        <Button
          variant="secondary"
          leadingIcon={<Upload aria-hidden />}
          // In view only this press opens the "view only" dialog instead (see ViewOnlyGuard).
          data-plan-write
          onClick={() => {
            startRouteProgress();
            router.push(routes.importData(org.slug));
          }}
        >
          Import
        </Button>
      ) : null}
      {canCreate ? (
        <Button
          leadingIcon={<Plus aria-hidden />}
          data-testid="home-new-board"
          // In view only this press opens the "view only" dialog instead (see ViewOnlyGuard).
          data-plan-write
          loading={pendingCreate}
          onClick={() => {
            if (workspaceId) requestCreate({ kind: 'board', workspaceId });
            else setPendingCreate(true);
          }}
        >
          New board
        </Button>
      ) : null}
    </div>
  );
}

export function HomePage() {
  const { user, org, role } = useOrg();
  const window = useMemo(() => weekWindow(new Date()), []);
  const home = useShellHome(org.id, window);
  const workspaceId = useActiveWorkspaceId();
  const firstName = user.name.split(' ')[0] ?? user.name;
  const greeting = useGreeting();
  const dateLine = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  );
  // Loading until this page is live, so the first browser pass matches the server's placeholders.
  const hydrated = useHydrated();
  const loading = !hydrated || home.isPending;

  return (
    <div className="mx-auto w-full max-w-[1680px] px-4 py-6 sm:px-8 sm:py-8" data-testid="home-page">
      <DashboardFrame app="crm">
        <DashboardHeader
          eyebrow={
            <span suppressHydrationWarning>
              {dateLine} · {org.name}
            </span>
          }
          title={
            <span
              className={cn('transition-opacity', greeting ? 'opacity-100' : 'opacity-0')}
              data-testid="home-greeting"
            >
              {greeting ?? 'Good morning'}, {firstName}
            </span>
          }
          actions={<QuickActions workspaceId={workspaceId} />}
        />

        {role === 'guest' ? (
          // A guest sets nothing up: no "Getting started" steps they cannot do (billing review round 5).
          <p className="rounded-xl border border-border-subtle bg-panel px-4 py-3 text-sm text-fg-secondary" data-testid="home-guest-note">
            You are a guest. You see what your team adds you to.
          </p>
        ) : (
          <SetupGuideCard workspaceId={workspaceId} />
        )}

        <RecentSection
          recents={home.data?.recents ?? []}
          loading={loading}
          error={home.isError}
          onRetry={() => void home.refetch()}
        />

        <DashColumns
          main={
            <>
              <MyWorkSection
                work={home.data?.work ?? []}
                today={window.today}
                loading={loading}
                error={home.isError}
                onRetry={() => void home.refetch()}
              />
              <UpdatesSection
                updates={home.data?.updates ?? []}
                loading={loading}
                error={home.isError}
                onRetry={() => void home.refetch()}
              />
            </>
          }
          rail={
            <aside aria-label="Inbox, favorites and templates" className="flex min-w-0 flex-col gap-[var(--dash-gap)]">
              <InboxPreview />
              <FavoritesCard workspaceId={workspaceId} />
              <TemplatesRail workspaceId={workspaceId} />
            </aside>
          }
        />
      </DashboardFrame>
    </div>
  );
}
