'use client';
/**
 * Org home: greeting with quick actions, then a two-column layout — recently visited cards,
 * my work due this week and the updates feed on the left; inbox preview, favorites and
 * templates on the right. One aggregate request (`/shell/home`) feeds the main column.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload, UserPlus } from 'lucide-react';
import { useGreeting } from '@kitstak/ui/text';
import { Button, cn } from '@/components/ui';
import { useShellHome, useWorkspaces } from '@/features/shell/api';
import { useCan, useOrg } from '@/features/shell/org-context';
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
  const openPanel = useShellStore((state) => state.openPanel);
  const canCreate = useCan('board:create');
  const canImport = useCan('data:import');
  const canInvite = useCan('member:invite');
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
      {canInvite ? (
        <Button variant="secondary" leadingIcon={<UserPlus aria-hidden />} onClick={() => openPanel('invite')}>
          Invite
        </Button>
      ) : null}
      {canImport ? (
        <Button
          variant="secondary"
          leadingIcon={<Upload aria-hidden />}
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
  const { user, org } = useOrg();
  const window = useMemo(() => weekWindow(new Date()), []);
  const home = useShellHome(org.id, window);
  const workspaceId = useActiveWorkspaceId();
  const firstName = user.name.split(' ')[0] ?? user.name;
  const greeting = useGreeting();
  const dateLine = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  );
  const loading = home.isPending;

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8" data-testid="home-page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-fg-muted" suppressHydrationWarning>
            {dateLine} · {org.name}
          </p>
          <h1
            className={cn(
              'mt-1 text-xl font-semibold tracking-[-0.01em] text-fg transition-opacity sm:text-2xl',
              greeting ? 'opacity-100' : 'opacity-0',
            )}
            data-testid="home-greeting"
          >
            {greeting ?? 'Good morning'}, {firstName}
          </h1>
        </div>
        <QuickActions workspaceId={workspaceId} />
      </header>

      <SetupGuideCard workspaceId={workspaceId} />

      <RecentSection
        recents={home.data?.recents ?? []}
        loading={loading}
        error={home.isError}
        onRetry={() => void home.refetch()}
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="flex min-w-0 flex-col gap-6">
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
        </div>
        <aside aria-label="Inbox, favorites and templates" className="flex min-w-0 flex-col gap-6">
          <InboxPreview />
          <FavoritesCard />
          <TemplatesRail workspaceId={workspaceId} />
        </aside>
      </div>
    </div>
  );
}
