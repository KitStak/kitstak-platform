'use client';
/**
 * Inbox: mentions, assignments, comments, status changes and due-date reminders.
 * Click a notification to open its task in the drawer (it's marked read). Filters, date groups,
 * multi-select bulk actions, archive with Undo, "Load older" paging and keyboard control:
 * J/K move · Enter open · E archive · U read/unread · X select.
 *
 * Wide screens (1200px and up) split the page: the list on the left and the selected item's task
 * (details, comments, reply box) on the right, so J/K triage never leaves the inbox. E archives and
 * the next item slides into the preview.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { BellRing } from 'lucide-react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, CheckCheck, CircleDot, MailOpen } from 'lucide-react';
import {
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  Kbd,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from '@/components/ui';
import { Page } from '@/components/layout/page';
import { apiGet, apiPath } from '@/lib/api-client';
import { formatRelative } from '@/lib/dates';
import { useProjects, useUnreadCount, type InboxPage } from '@/lib/hooks/use-data';
import { useHotkey } from '@/lib/hooks/use-hotkeys';
import type { NotificationDTO } from '@/lib/types';
import { KIND_TONE, NotificationAvatar } from './notification-avatar';
import { KIND_LABEL, groupByDate } from './notification-utils';
import { useInboxActions } from './use-inbox-actions';
import { TaskDetailView } from '@/features/task/task-detail';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { useIsNarrow } from '@/features/timeline/use-view-prefs';

export type InboxFilter = 'all' | 'unread' | 'mentions' | 'assigned' | 'comments' | 'due' | 'archived';

const FILTERS: readonly { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'mentions', label: 'Mentions' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'comments', label: 'Comments' },
  { value: 'due', label: 'Due dates' },
  { value: 'archived', label: 'Archive' },
];

const EMPTY: Record<InboxFilter, { title: string; description: string }> = {
  all: {
    title: 'You’re all caught up',
    description:
      'When someone mentions you, assigns you a task or updates something you follow, it shows up here.',
  },
  unread: { title: 'Nothing unread', description: 'You’ve seen everything. New updates will appear here.' },
  mentions: {
    title: 'No mentions yet',
    description: 'When someone types @ and your name in a comment, you’ll see it here.',
  },
  assigned: {
    title: 'Nothing assigned lately',
    description: 'When a teammate gives you a task, it shows up here.',
  },
  comments: { title: 'No new comments', description: 'Comments on tasks you follow show up here.' },
  due: {
    title: 'No due-date reminders',
    description: 'We remind you here when a task of yours is due today, tomorrow, or is late.',
  },
  archived: {
    title: 'Nothing archived',
    description: 'Archive notifications you’re done with to keep your inbox tidy.',
  },
};

export function InboxView({ initial }: { readonly initial: InboxPage }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const { markRead, archive, markAll, open } = useInboxActions();
  const projects = useProjects();
  const projectKeys = useMemo(
    () => new Map((projects.data ?? []).map((p) => [p.id, p.key])),
    [projects.data],
  );

  const inbox = useInfiniteQuery({
    queryKey: ['notifications', filter, 'feed'],
    queryFn: ({ pageParam }) =>
      apiGet<InboxPage>(apiPath('notifications', { filter, before: pageParam ?? undefined })),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    initialData: filter === 'all' ? { pages: [initial], pageParams: [null] } : undefined,
  });
  const items = useMemo(() => inbox.data?.pages.flatMap((page) => page.items) ?? [], [inbox.data]);
  const unread = useUnreadCount();
  const unreadCount = unread.data?.count ?? inbox.data?.pages[0]?.unread ?? 0;

  // New notifications arrive through the unread poll: refresh the list when the count goes up.
  const lastCount = useRef(unreadCount);
  useEffect(() => {
    if (unreadCount > lastCount.current)
      void queryClient.invalidateQueries({
        queryKey: ['notifications'],
        predicate: (q) => q.queryKey[1] !== 'unread-count',
      });
    lastCount.current = unreadCount;
  }, [unreadCount, queryClient]);

  const groups = useMemo(() => groupByDate(items), [items]);
  const selectedItems = items.filter((item) => selected.has(item.id));
  const allSelected = items.length > 0 && selectedItems.length === items.length;
  const active = items[Math.min(cursor, items.length - 1)];
  // Split view: list plus live task preview at 1200px and wider.
  const split = useIsNarrow('(min-width: 1200px)');
  const { openTask } = useTaskDrawer();
  const previewTask = split && active?.taskId ? active.taskId : null;
  // Previewing an unread item for a moment marks it read (like opening it would).
  useEffect(() => {
    if (!split || !active || active.readAt) return;
    const timer = window.setTimeout(() => void markRead([active], true), 1200);
    return () => window.clearTimeout(timer);
  }, [split, active, markRead]);

  const changeFilter = (value: InboxFilter) => {
    setFilter(value);
    setSelected(new Set());
    setCursor(0);
  };
  const toggleSelect = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const focusRow = (index: number) => {
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    setCursor(clamped);
    listRef.current?.querySelector<HTMLElement>(`[data-row-index="${clamped}"]`)?.focus();
  };

  // Keyboard control (outside text fields and dialogs).
  useHotkey(['j', 'ArrowDown'], () => focusRow(cursor + 1), { enabled: items.length > 0 });
  useHotkey(['k', 'ArrowUp'], () => focusRow(cursor - 1), { enabled: items.length > 0 });
  useHotkey('e', () => active && void archive([active], !active.archivedAt), { enabled: Boolean(active) });
  useHotkey('u', () => active && void markRead([active], !active.readAt), { enabled: Boolean(active) });
  useHotkey('x', () => active && toggleSelect(active.id), { enabled: Boolean(active) });
  useHotkey('shift+r', () => void markAll(), { enabled: unreadCount > 0 });

  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, item: NotificationDTO) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      open(item);
    }
  };

  const bulk = selectedItems.length > 0;
  return (
    <Page
      title="Inbox"
      subtitle="Mentions, assignments and updates on tasks you follow."
      width={split ? 'full' : 'narrow'}
      actions={
        <Button
          variant="secondary"
          leadingIcon={<CheckCheck aria-hidden />}
          onClick={() => void markAll()}
          disabled={unreadCount === 0}
          data-testid="inbox-mark-all"
        >
          Mark all read
        </Button>
      }
      tabs={
        <Tabs value={filter} onValueChange={(value) => changeFilter(value as InboxFilter)}>
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList aria-label="Filter notifications" className="min-w-max">
              {FILTERS.map((entry) => (
                <TabsTrigger
                  key={entry.value}
                  value={entry.value}
                  data-testid={`inbox-filter-${entry.value}`}
                  count={entry.value === 'unread' && unreadCount ? unreadCount : undefined}
                >
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
      }
    >
      <div
        className={cn(split && 'grid grid-cols-[minmax(380px,440px)_minmax(0,1fr)] items-start gap-6')}
        data-testid={split ? 'inbox-split' : undefined}
      >
        <div className="min-w-0">
          {items.length > 0 ? (
            <div className="mb-2 flex min-h-9 items-center gap-2 px-1" data-testid="inbox-toolbar">
              <Checkbox
                aria-label={allSelected ? 'Clear selection' : 'Select all'}
                checked={allSelected ? true : bulk ? 'indeterminate' : false}
                onCheckedChange={() =>
                  setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))
                }
                className="ml-3 max-sm:hidden"
              />
              {bulk ? (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-sm font-medium text-fg">{selectedItems.length} selected</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<MailOpen aria-hidden />}
                    onClick={() => {
                      void markRead(selectedItems, true);
                      setSelected(new Set());
                    }}
                  >
                    Mark read
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<CircleDot aria-hidden />}
                    onClick={() => {
                      void markRead(selectedItems, false);
                      setSelected(new Set());
                    }}
                  >
                    Mark unread
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={
                      filter === 'archived' ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />
                    }
                    onClick={() => {
                      void archive(selectedItems, filter !== 'archived');
                      setSelected(new Set());
                    }}
                  >
                    {filter === 'archived' ? 'Move to inbox' : 'Archive'}
                  </Button>
                </div>
              ) : (
                <p className="hidden items-center gap-1 text-xs whitespace-nowrap text-fg-muted sm:flex">
              <Kbd>J</Kbd>
              <Kbd>K</Kbd> move · <Kbd>E</Kbd> archive{split ? null : <> · <Kbd>Enter</Kbd> open · <Kbd>U</Kbd> read/unread · <Kbd>X</Kbd> select</>}
            </p>
              )}
            </div>
          ) : null}

          {inbox.isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} height={64} rounded="md" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              illustration={filter === 'unread' || filter === 'all' ? 'inbox' : 'notifications'}
              title={EMPTY[filter].title}
              description={EMPTY[filter].description}
            />
          ) : (
            <ul
              ref={listRef}
              className="flex flex-col gap-4"
              data-testid="inbox-list"
              aria-label="Notifications"
            >
              {groups.map((group) => (
                <li key={group.label}>
                  <h2 className="mb-1 px-1 text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
                    {group.label}
                  </h2>
                  <ul className="overflow-hidden rounded-xl border border-border-subtle bg-panel">
                    {group.items.map((item) => {
                      const index = items.indexOf(item);
                      return (
                        <InboxRow
                          key={item.id}
                          item={item}
                          index={index}
                          projectKey={item.projectId ? projectKeys.get(item.projectId) : undefined}
                          selected={selected.has(item.id)}
                          current={index === cursor}
                          onFocus={() => setCursor(index)}
                          onKeyDown={(event) => onRowKeyDown(event, item)}
                          onOpen={() => open(item)}
                          onSelect={() => toggleSelect(item.id)}
                          onRead={() => void markRead([item], !item.readAt)}
                          onArchive={() => void archive([item], !item.archivedAt)}
                        />
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {inbox.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void inbox.fetchNextPage()}
                loading={inbox.isFetchingNextPage}
              >
                Load older notifications
              </Button>
            </div>
          ) : null}
        </div>
        {split ? (
          <aside
            aria-label="Preview"
            className="sticky top-0 flex max-h-[calc(100dvh-180px)] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs"
            data-testid="inbox-preview"
          >
            {previewTask ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <TaskDetailView
                  key={previewTask}
                  taskRef={previewTask}
                  variant="drawer"
                  onOpenTask={(key) => openTask(key)}
                />
              </div>
            ) : active ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <BellRing aria-hidden className="size-6 text-icon" />
                <p className="text-sm font-semibold text-fg">{active.title}</p>
                {active.body ? <p className="max-w-md text-sm text-fg-secondary">{active.body}</p> : null}
              </div>
            ) : (
              <p className="m-auto p-8 text-sm text-fg-muted">Pick a notification to see it here.</p>
            )}
          </aside>
        ) : null}
      </div>
    </Page>
  );
}

function InboxRow({
  item,
  index,
  projectKey,
  selected,
  current,
  onFocus,
  onKeyDown,
  onOpen,
  onSelect,
  onRead,
  onArchive,
}: {
  readonly item: NotificationDTO;
  readonly index: number;
  readonly projectKey?: string;
  readonly selected: boolean;
  readonly current: boolean;
  readonly onFocus: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onOpen: () => void;
  readonly onSelect: () => void;
  readonly onRead: () => void;
  readonly onArchive: () => void;
}) {
  const unread = !item.readAt;
  return (
    <li
      data-testid="inbox-item"
      data-unread={unread || undefined}
      onClick={onOpen}
      className={cn(
        'group relative flex cursor-pointer items-start gap-3 border-b border-border-subtle px-3 py-3 last:border-b-0 sm:px-4',
        'hover:bg-hover has-[[data-row-main]:focus-visible]:bg-hover has-[[data-row-main]:focus-visible]:shadow-[inset_2px_0_0_var(--color-primary)]',
        selected && 'bg-selected hover:bg-selected-hover',
      )}
    >
      <span className="hidden pt-1.5 sm:block" onClick={(event) => event.stopPropagation()}>
        <Checkbox
          aria-label={selected ? `Unselect “${item.title}”` : `Select “${item.title}”`}
          checked={selected}
          onCheckedChange={onSelect}
          tabIndex={-1}
          className={cn(
            'transition-opacity',
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          )}
        />
      </span>
      <NotificationAvatar item={item} />
      <button
        type="button"
        data-row-main
        data-row-index={index}
        tabIndex={current ? 0 : -1}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        aria-label={`${unread ? 'Unread. ' : ''}${item.title}${item.body ? `. ${item.body}` : ''}`}
        className="min-w-0 flex-1 text-left outline-none"
      >
        <span
          className={cn('block text-sm leading-5', unread ? 'font-semibold text-fg' : 'text-fg-secondary')}
        >
          {item.title}
        </span>
        {item.body ? (
          <span className="mt-0.5 line-clamp-2 block text-sm text-fg-muted">{item.body}</span>
        ) : null}
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
          <span className={KIND_TONE[item.kind]}>{KIND_LABEL[item.kind]}</span>
          {projectKey ? (
            <>
              <span aria-hidden>·</span>
              <span className="rounded-sm bg-sunken px-1 font-medium text-fg-secondary">{projectKey}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <time dateTime={item.createdAt} suppressHydrationWarning>
            {formatRelative(item.createdAt)}
          </time>
        </span>
      </button>
      <span
        className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:group-focus-visible:opacity-100"
        onClick={(event) => event.stopPropagation()}
      >
        <IconButton
          size="sm"
          label={unread ? 'Mark as read' : 'Mark as unread'}
          shortcut={['U']}
          icon={unread ? <MailOpen aria-hidden /> : <CircleDot aria-hidden />}
          onClick={onRead}
          tabIndex={-1}
        />
        <IconButton
          size="sm"
          label={item.archivedAt ? 'Move back to inbox' : 'Archive'}
          shortcut={['E']}
          icon={item.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          onClick={onArchive}
          tabIndex={-1}
          data-testid="inbox-archive"
        />
      </span>
      <span className="flex h-5 w-2 shrink-0 items-center">
        {unread ? (
          <span aria-hidden data-testid="unread-dot" className="size-2 rounded-full bg-primary" />
        ) : null}
      </span>
    </li>
  );
}
