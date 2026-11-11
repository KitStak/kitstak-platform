'use client';
/**
 * Critic workbench for board views: a view-type switcher over the seeded board (missing view
 * types are created on first visit), an "Add view" menu fed by VIEW_TYPES, a theme toggle
 * and a lightweight item drawer for onOpenItem.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Moon, Plus, Sun } from 'lucide-react';
import {
  Button,
  Drawer,
  DrawerContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Skeleton,
  cn,
} from '@/components/ui';
import {
  BoardView,
  CalendarSkeleton,
  ChartSkeleton,
  FilesSkeleton,
  focusItemInView,
  FormSkeleton,
  KanbanSkeleton,
  TimelineSkeleton,
  VIEW_TYPES,
  viewTypeMeta,
} from '@/features/board-views';
import { Cell, CellServicesProvider, useBoardCellServices } from '@/features/cells';
import { useTheme } from '@/features/shell/theme';
import { OrgProvider, useBoard, useCreateView, useUpdateCell } from '@/lib/hooks';
import type { ViewDto, ViewType } from '@/server/services/contracts/dto';

const TYPES = VIEW_TYPES.filter((meta) => meta.rendered);

const SKELETONS: Partial<Record<ViewType, ComponentType>> = {
  kanban: KanbanSkeleton,
  calendar: CalendarSkeleton,
  timeline: TimelineSkeleton,
  chart: ChartSkeleton,
  form: FormSkeleton,
  files: FilesSkeleton,
};

/** View-shaped placeholder (toolbar + the view's own skeleton) while the board loads. */
function ViewLoading({ type }: { readonly type: ViewType }) {
  const ViewSkeleton = SKELETONS[type] ?? KanbanSkeleton;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="views-loading">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle bg-panel px-4">
        <Skeleton width={180} height={28} rounded="sm" />
        <span className="flex-1" />
        <Skeleton width={28} height={28} rounded="sm" />
      </div>
      <ViewSkeleton />
    </div>
  );
}

function ItemDrawer({ boardId, itemId, onClose }: { readonly boardId: string; readonly itemId: string | null; readonly onClose: () => void }) {
  // Remember the item after close so focus can go back to its card / event / bar.
  const [lastId, setLastId] = useState<string | null>(itemId);
  if (itemId && itemId !== lastId) setLastId(itemId);
  const board = useBoard(boardId);
  const item = board.data?.items.find((entry) => entry.id === itemId);
  const services = useBoardCellServices(boardId, board.data?.items ?? []);
  const updateCell = useUpdateCell();
  const columns = (board.data?.columns ?? []).filter((column) => column.type !== 'name' && column.scope === 'item');
  return (
    <Drawer open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      {item ? (
        <DrawerContent
          title={item.name}
          description={board.data?.groups.find((group) => group.id === item.groupId)?.title}
          width={560}
          data-testid="item-panel"
          aria-label={item.name}
          onCloseAutoFocus={(event: Event) => {
            if (focusItemInView(lastId)) event.preventDefault();
          }}
        >
          <CellServicesProvider value={services}>
            <div role="grid" aria-label="Fields" className="flex flex-col px-6 py-4">
              {columns.map((column) => (
                <div role="row" key={column.key} className="flex h-10 items-center gap-3 border-b border-border-subtle">
                  <span className="w-36 shrink-0 truncate text-sm text-fg-muted">{column.title}</span>
                  <div className="min-w-0 flex-1 overflow-hidden rounded-sm">
                    <Cell
                      column={column}
                      item={item}
                      board={{ id: boardId, columns: board.data?.columns, groups: board.data?.groups, canEdit: board.data?.board.canEdit }}
                      users={board.data?.users ?? []}
                      onCommit={(value) => updateCell.mutate({ itemId: item.id, boardId, columnKey: column.key, value })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CellServicesProvider>
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

function Workbench({ boardId }: { readonly boardId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const board = useBoard(boardId);
  const createView = useCreateView(boardId);
  const { resolved, setPreference } = useTheme();
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const requested = params.get('type') as ViewType | null;
  const type: ViewType = TYPES.some((meta) => meta.type === requested) ? (requested as ViewType) : 'kanban';
  const views = useMemo(() => (board.data?.views ?? []).filter((view) => view.type === type), [board.data?.views, type]);
  const viewId = params.get('view');
  const view: ViewDto | undefined = views.find((entry) => entry.id === viewId) ?? views[0];
  const creating = useRef(new Set<ViewType>());
  const { mutate: create } = createView;

  // Missing view types are created once so every view can be reviewed on the seeded board.
  useEffect(() => {
    if (!board.data || view || creating.current.has(type) || !board.data.board.canEdit) return;
    creating.current.add(type);
    create({ type, name: viewTypeMeta(type)?.defaultName ?? type });
  }, [board.data, create, type, view]);

  const go = (next: ViewType, id?: string) => {
    const search = new URLSearchParams(params.toString());
    search.set('type', next);
    if (id) search.set('view', id);
    else search.delete('view');
    router.replace(`?${search.toString()}`, { scroll: false });
  };

  const addView = (next: ViewType) => {
    const meta = viewTypeMeta(next);
    const count = board.data?.views.filter((entry) => entry.type === next).length ?? 0;
    create(
      { type: next, name: `${meta?.defaultName ?? next} ${count + 1}` },
      {
        onSuccess: (created) => {
          setFresh(created.id);
          go(next, created.id);
        },
      },
    );
  };

  return (
    <div className="flex h-dvh flex-col bg-app" data-testid="views-workbench">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border-subtle bg-panel px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-fg-muted ">Board views · dev</p>
          <h1 className="flex h-7 items-center truncate text-xl leading-7 font-semibold text-fg">
            {board.data ? board.data.board.name : <Skeleton width={140} height={20} rounded="sm" />}
          </h1>
        </div>
        <span className="flex-1" />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" leadingIcon={<Plus aria-hidden />} data-testid="add-view">
              Add view
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {VIEW_TYPES.map((meta) => {
              const Icon = meta.icon;
              return (
                <DropdownMenuItem
                  key={meta.type}
                  disabled={!meta.rendered}
                  icon={<Icon aria-hidden />}
                  description={meta.description}
                  onSelect={() => addView(meta.type)}
                >
                  {meta.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          icon={resolved === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
          onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
        />
      </header>
      <nav aria-label="View type" className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-border-subtle bg-panel px-3">
        {TYPES.map((meta) => {
          const Icon = meta.icon;
          const active = meta.type === type;
          return (
            <button
              key={meta.type}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => go(meta.type)}
              data-testid={`view-tab-${meta.type}`}
              className={cn(
                'relative flex h-9 shrink-0 items-center gap-1.5 rounded-t-sm px-3 text-base transition-colors duration-[var(--duration-fast)]',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                active
                  ? 'text-fg after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
                  : 'text-fg-muted hover:bg-hover hover:text-fg',
              )}
            >
              <Icon aria-hidden className="size-4" />
              {meta.label}
            </button>
          );
        })}
        {views.length > 1 ? (
          <select
            aria-label="Saved view"
            value={view?.id}
            onChange={(event) => go(type, event.target.value)}
            className="mb-1.5 ml-auto h-7 shrink-0 rounded-sm border border-border-input bg-panel px-2 text-sm text-fg"
          >
            {views.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        ) : null}
      </nav>
      <main className="flex min-h-0 flex-1 flex-col">
        {board.isError ? (
          <EmptyState illustration="error" title="Couldn't load this board" actions={<Button onClick={() => void board.refetch()}>Retry</Button>} />
        ) : view ? (
          <BoardView key={view.id} boardId={boardId} view={view} onOpenItem={setOpenItem} initialSettingsOpen={fresh === view.id} />
        ) : (
          <ViewLoading type={type} />
        )}
      </main>
      <ItemDrawer boardId={boardId} itemId={openItem} onClose={() => setOpenItem(null)} />
    </div>
  );
}

export function ViewsWorkbench({ boardId, orgId }: { readonly boardId: string; readonly orgId: string }) {
  return (
    <OrgProvider orgId={orgId}>
      <Suspense>
        <Workbench boardId={boardId} />
      </Suspense>
    </OrgProvider>
  );
}
