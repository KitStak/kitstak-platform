'use client';
/** My work, dashboard overview, import entry point and Trash. */
import Link from 'next/link';
import {
  BarChart3,
  CalendarCheck,
  FileSpreadsheet,
  LayoutDashboard,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton, cn } from '@/components/ui';
import { useBoardLifecycle, useBoards, useDashboard, useNotifications } from '@/lib/hooks';
import { useOrg } from '@/features/shell/org-context';
import { EntityIcon } from '@/features/shell/entity-icon';
import { routes } from '@/features/shell/routes';
import { formatRelativeTime } from '@/features/home/format';
import type { WidgetType } from '@/server/services/contracts/dto';
import { PageFrame, PageSection } from './page-frame';

function ListSkeleton({ rows = 5 }: { readonly rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-5" data-skeleton>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={40} rounded="md" />
      ))}
    </div>
  );
}

function RetryState({ title, onRetry }: { readonly title: string; readonly onRetry: () => void }) {
  return (
    <EmptyState
      illustration="error"
      title={title}
      actions={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}

export function MyWorkPage() {
  const { org } = useOrg();
  const assigned = useNotifications('assigned');
  const entries = assigned.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <PageFrame title="My work" icon={<CalendarCheck />}>
      <PageSection title="Assigned to me" aside={<Badge>{entries.length}</Badge>}>
        {assigned.isPending ? (
          <ListSkeleton />
        ) : assigned.isError ? (
          <RetryState title="Couldn't load your work" onRetry={() => void assigned.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState
            illustration="board"
            title="Nothing assigned to you"
            description="Items assigned to you appear here."
          />
        ) : (
          <ul>
            {entries.map((entry) => (
              <li key={entry.id} className="border-b border-border-subtle last:border-b-0">
                <Link
                  href={entry.boardId ? routes.board(org.slug, entry.boardId) : routes.inbox(org.slug)}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                >
                  <EntityIcon type="board" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-fg">{entry.itemName ?? 'Untitled item'}</span>
                    <span className="block truncate text-sm text-fg-muted">
                      {entry.boardName ?? 'Board'} · assigned {formatRelativeTime(entry.createdAt)}
                      {entry.actor ? ` by ${entry.actor.name}` : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </PageFrame>
  );
}

const WIDGET_LABEL: Record<WidgetType, string> = {
  number: 'Numbers',
  chart: 'Chart',
  battery: 'Battery',
  table: 'Table',
  calendar: 'Calendar',
  timeline: 'Timeline',
  workload: 'Workload',
  leaderboard: 'Leaderboard',
  funnel: 'Funnel',
  text: 'Text',
};

export function DashboardPage({ dashboardId }: { readonly dashboardId: string }) {
  const dashboard = useDashboard(dashboardId);
  if (dashboard.isPending) {
    return (
      <PageFrame title="Loading dashboard…" icon={<LayoutDashboard />} width="wide">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-skeleton>
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} height={160} rounded="lg" />
          ))}
        </div>
      </PageFrame>
    );
  }
  if (dashboard.isError) {
    return <RetryState title="This dashboard couldn't be loaded" onRetry={() => void dashboard.refetch()} />;
  }
  const { name, description, widgets } = dashboard.data;
  const ordered = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
  return (
    <PageFrame
      title={name}
      description={description ?? `${widgets.length} widgets`}
      icon={<LayoutDashboard />}
      width="wide"
    >
      {ordered.length === 0 ? (
        <PageSection>
          <EmptyState illustration="board" title="No widgets yet" description="Add widgets to summarize your boards." />
        </PageSection>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ordered.map((widget) => (
            <article
              key={widget.id}
              className={cn(
                'flex min-h-[140px] flex-col gap-3 rounded-lg border border-border-subtle bg-panel p-5 shadow-xs',
                widget.w >= 8 && 'sm:col-span-2',
              )}
            >
              <header className="flex items-center justify-between gap-2">
                <h2 className="truncate text-md font-semibold text-fg">{widget.title}</h2>
                <Badge tone="outline" icon={<BarChart3 />}>
                  {WIDGET_LABEL[widget.type]}
                </Badge>
              </header>
            </article>
          ))}
        </div>
      )}
    </PageFrame>
  );
}

export function ImportPage() {
  const { org } = useOrg();
  return (
    <PageFrame title="Import data" icon={<Upload />}>
      <PageSection>
        <EmptyState
          visual={
            <span className="flex size-16 items-center justify-center rounded-xl bg-success-subtle text-success-text">
              <FileSpreadsheet className="size-8" aria-hidden />
            </span>
          }
          title="Import from CSV or Excel"
          description="Open the board you want to fill, then use Import from its board menu to map spreadsheet columns onto board columns."
          actions={
            <Link
              href={routes.home(org.slug)}
              className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-base font-medium text-primary-fg hover:bg-primary-hover"
            >
              Choose a board
            </Link>
          }
        />
      </PageSection>
    </PageFrame>
  );
}

export function TrashPage() {
  const deleted = useBoards({ state: 'deleted' });
  const lifecycle = useBoardLifecycle();
  const boards = deleted.data ?? [];
  return (
    <PageFrame
      title="Trash"
      description="Deleted boards are removed permanently after 30 days."
      icon={<Trash2 />}
    >
      <PageSection title="Deleted boards" aside={<Badge>{boards.length}</Badge>}>
        {deleted.isPending ? (
          <ListSkeleton />
        ) : deleted.isError ? (
          <RetryState title="Couldn't load Trash" onRetry={() => void deleted.refetch()} />
        ) : boards.length === 0 ? (
          <EmptyState illustration="board" title="Trash is empty" description="Boards you delete will appear here." />
        ) : (
          <ul>
            {boards.map((board) => (
              <li key={board.id} className="flex items-center gap-3 border-b border-border-subtle px-5 py-3 last:border-b-0">
                <EntityIcon type="board" boardKind={board.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">{board.name}</span>
                  <span className="block text-sm text-fg-muted">
                    Deleted {board.deletedAt ? formatRelativeTime(board.deletedAt) : ''}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<RotateCcw />}
                  loading={lifecycle.isPending && lifecycle.variables?.boardId === board.id}
                  onClick={() =>
                    lifecycle.mutate(
                      { boardId: board.id, action: 'restore' },
                      { onSuccess: () => void deleted.refetch() },
                    )
                  }
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </PageFrame>
  );
}
