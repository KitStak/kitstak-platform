'use client';
/**
 * Activity center: the bell's right-side panel (non-modal, under the top bar). Tabs, search,
 * board filter, day groups, infinite scroll, realtime arrivals, optimistic read state.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CheckCheck, Inbox, MoreHorizontal, RotateCcw, Settings2, X } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  SearchInput,
  Select,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { useBoards } from '@/lib/hooks';
import { apiRequest } from '@/lib/api';
import { toastError } from '@/lib/hooks/cache';
import { useMe } from '@/features/shell/api';
import { useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import type { NotificationDto } from '@/server/services/contracts/dto';
import {
  useDeleteNotification,
  useMarkRead,
  useNotificationFeed,
  usePrefetchNotificationTabs,
  type FeedParams,
  type PanelTab,
} from './api';
import { clusterSimilar, groupByDay, notificationHref } from './describe';
import { useMenuTooltip } from './menu-tooltip';
import { NotificationRow } from './notification-row';

const BELL_SELECTOR = '[data-notifications-trigger]';
const ROW_LINK_SELECTOR = '[data-notification-link]';

/** Retry points (ms) for placing focus after a row is removed and its menu finished closing. */
const FOCUS_RETRY_MS = [0, 60, 180] as const;

/**
 * Focus the row link at `index` (clamped) once React has committed the row's removal. Radix
 * menus restore focus on a timer after they unmount, so this re-checks a few times and only
 * steps in while focus is lost (on <body> or a detached node).
 */
function focusRowAt(list: HTMLElement | null, index: number): void {
  const place = (force: boolean) => {
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    if (!force && !lost) return;
    const links = [...(list?.querySelectorAll<HTMLElement>(ROW_LINK_SELECTOR) ?? [])];
    const target =
      links.length > 0
        ? links[Math.max(0, Math.min(index, links.length - 1))]
        : (list?.closest('[role="dialog"]')?.querySelector<HTMLElement>('[role="tab"][data-state="active"]') ??
          null);
    target?.focus();
  };
  requestAnimationFrame(() => place(!list?.contains(document.activeElement)));
  for (const delay of FOCUS_RETRY_MS) setTimeout(() => place(false), delay + 16);
}

/**
 * Focus the bell without popping its tooltip: Radix opens a tooltip on focus unless a pointer
 * is down, so a synthetic pointerdown/up pair brackets the programmatic focus.
 */
function focusBellQuietly(): void {
  const bell = document.querySelector<HTMLElement>(BELL_SELECTOR);
  if (!bell) return;
  const init = { bubbles: true, cancelable: true, pointerType: 'mouse' } as const;
  bell.dispatchEvent(new PointerEvent('pointerdown', init));
  bell.focus({ preventScroll: true });
  setTimeout(() => document.dispatchEvent(new PointerEvent('pointerup', init)), 0);
}

const sameParams = (a: FeedParams, b: FeedParams) =>
  a.filter === b.filter && (a.boardId ?? null) === (b.boardId ?? null) && (a.q ?? '') === (b.q ?? '');

const TABS: readonly { value: PanelTab; label: string; short: string }[] = [
  { value: 'all', label: 'All', short: 'All' },
  { value: 'unread', label: 'Unread', short: 'Unread' },
  { value: 'mentions', label: 'I was mentioned', short: 'Mentions' },
  { value: 'assigned', label: 'Assigned to me', short: 'Assigned' },
];

const EMPTY_COPY: Readonly<Record<PanelTab, { title: string; description: string }>> = {
  all: {
    title: "You're all caught up",
    description: 'Mentions, assignments and updates on items you follow will show up here.',
  },
  unread: { title: 'No unread notifications', description: 'Nice work. Everything here has been read.' },
  mentions: {
    title: 'No mentions yet',
    description: 'When a teammate @mentions you in an update, you will see it here.',
  },
  assigned: {
    title: 'Nothing assigned to you',
    description: 'When someone assigns you to an item, it will show up here.',
  },
};

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const handle = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs]);
  return now;
}

function RowSkeletons({ rows = 6 }: { readonly rows?: number }) {
  return (
    <div data-skeleton aria-hidden className="flex flex-col">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-3 py-3 pr-4 pl-6">
          <Skeleton width={40} height={40} rounded="full" />
          <div className="flex flex-1 flex-col gap-2 pt-0.5">
            <Skeleton height={14} width={`${82 - (index % 3) * 14}%`} />
            <Skeleton height={12} width="46%" />
          </div>
          <Skeleton height={10} width={22} />
        </div>
      ))}
    </div>
  );
}

export interface NotificationsPanelProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function NotificationsPanel({ open, onOpenChange }: NotificationsPanelProps) {
  const { org, user } = useOrg();
  const router = useRouter();
  const me = useMe(org.id);
  const optionsTooltip = useMenuTooltip();
  const prefetchTabs = usePrefetchNotificationTabs();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [tab, setTab] = useState<PanelTab>('all');
  const [search, setSearch] = useState('');
  const [boardId, setBoardId] = useState<string>('all');
  const q = useDebounced(search.trim(), 250);
  const params: FeedParams = { filter: tab, boardId: boardId === 'all' ? undefined : boardId, q };
  const feed = useNotificationFeed(params, open);
  // While a new tab/search loads, the previous rows stay on screen. Read them from their own
  // (live) cache entry rather than the frozen placeholder snapshot, so optimistic read state
  // (e.g. "Mark all as read" mid-load) shows on them too.
  const [settled, setSettled] = useState<FeedParams>(params);
  if (feed.data && !feed.isPlaceholderData && !sameParams(settled, params)) setSettled(params);
  const previous = useNotificationFeed(settled, false);
  const boards = useBoards({});
  const markRead = useMarkRead();
  const mutateRead = markRead.mutate;
  const deleteNotification = useDeleteNotification();
  const now = useNow();
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const shown = feed.isPlaceholderData && previous.data ? previous.data : feed.data;
  const entries = useMemo(() => shown?.pages.flatMap((page) => page.items) ?? [], [shown]);
  // One source for every counter: the cache the bell badge reads (setUnreadEverywhere keeps it
  // current). Unknown until either answers; the tab then reserves the pill's width.
  const unreadCount: number | null = me.data?.unreadNotifications ?? feed.data?.pages[0]?.unreadCount ?? null;
  const groups = useMemo(
    () => groupByDay(entries, now).map((group) => ({ ...group, clusters: clusterSimilar(group.entries) })),
    [entries, now],
  );
  const filtered = Boolean(q) || boardId !== 'all';
  const scopedBoard = boardId === 'all' ? undefined : boardId;

  // Warm the other tabs when the panel opens (and when filters change) so switching is instant.
  useEffect(() => {
    if (!open) return;
    prefetchTabs(
      TABS.map((option) => option.value).filter((value) => value !== tab),
      { boardId: scopedBoard, q },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open / filter change
  }, [open, scopedBoard, q]);

  // Rows created after the panel opened arrived through realtime: give them a short highlight.
  const [openedAt] = useState(() => Date.now());
  const isFresh = (entry: NotificationDto) => Date.parse(entry.createdAt) > openedAt;

  // Infinite scroll: load the next page when the sentinel nears the viewport.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const root = listRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { root, rootMargin: '240px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, entries.length]);

  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });
  const close = useCallback(() => onOpenChangeRef.current(false), []);

  const onOpen = useCallback(
    (entry: NotificationDto, navigate?: boolean) => {
      if (!entry.readAt) mutateRead({ ids: [entry.id], read: true });
      const href = notificationHref(org.slug, entry);
      if (navigate && href) router.push(href);
      close();
    },
    [mutateRead, org.slug, router, close],
  );
  /** Index of the row holding focus, so focus can land on its neighbour after removal. */
  const focusedRowIndex = (id: string) => {
    const links = [...(listRef.current?.querySelectorAll<HTMLElement>(ROW_LINK_SELECTOR) ?? [])];
    const index = links.findIndex(
      (link) => link.closest('[data-notification-id]')?.getAttribute('data-notification-id') === id,
    );
    return index;
  };

  // Row callbacks read the latest groups/tab through a ref so they stay referentially stable:
  // a read toggle then re-renders only the rows whose data changed (rows are memoized).
  const latest = useRef({ groups, expanded, tab });
  useEffect(() => {
    latest.current = { groups, expanded, tab };
  });

  /** Ids a row stands for: itself plus folded similar events. */
  const clusterIds = useCallback((entry: NotificationDto) => {
    const { groups: currentGroups, expanded: currentExpanded } = latest.current;
    for (const group of currentGroups)
      for (const cluster of group.clusters)
        if (cluster.head.id === entry.id && !currentExpanded.has(entry.id))
          return [entry.id, ...cluster.similar.map((similar) => similar.id)];
    return [entry.id];
  }, []);

  const onToggleRead = useCallback(
    (entry: NotificationDto) => {
      const index = focusedRowIndex(entry.id);
      mutateRead({ ids: clusterIds(entry), read: !entry.readAt });
      // In the Unread tab the row disappears: keep the keyboard user's place.
      if (latest.current.tab === 'unread' && !entry.readAt && index >= 0) focusRowAt(listRef.current, index);
    },
    [mutateRead, clusterIds],
  );
  const onDelete = useCallback(
    (entry: NotificationDto) => {
      const index = focusedRowIndex(entry.id);
      deleteNotification(entry);
      focusRowAt(listRef.current, index >= 0 ? index : 0);
    },
    [deleteNotification],
  );
  const onMute = useCallback(
    (entry: NotificationDto) => {
      if (!entry.itemId) return;
      const path = `/item-panel/items/${entry.itemId}/subscribers`;
      const name = entry.itemName ?? 'this item';
      apiRequest(path, { orgId: org.id, method: 'POST', body: { remove: [user.id] } })
        .then(() =>
          toast.undo(`Notifications turned off for ${name}`, {
            onUndo: () =>
              apiRequest(path, { orgId: org.id, method: 'POST', body: { add: [user.id] } })
                .then(() => undefined)
                .catch((error: unknown) => toastError(error, 'Could not turn notifications back on')),
          }),
        )
        .catch((error: unknown) => toastError(error, 'Could not turn off notifications'));
    },
    [org.id, user.id],
  );
  const onToggleSimilar = useCallback((entry: NotificationDto) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  }, []);
  // With a board filter or search active, "mark all" only covers what the panel shows.
  const markAll = () =>
    mutateRead({
      all: true,
      read: true,
      boardId: scopedBoard,
      q: q || undefined,
      undoable: true,
    });
  const markAllLabel = filtered ? 'Mark these as read' : 'Mark all as read';
  const feedFailed = feed.isError && entries.length === 0;
  const hasUnreadInView =
    !feedFailed && (filtered ? entries.some((entry) => !entry.readAt) : (unreadCount ?? 0) > 0);

  /**
   * Roving focus (captured before the row menu trigger sees the key): ArrowUp/Down move between
   * rows from anywhere in a row, Home/End jump, ArrowRight enters the row's actions and
   * ArrowLeft walks back to the row. Keys inside an open menu are left to the menu.
   */
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const list = listRef.current;
    if (!list || !list.contains(target)) return; // portaled menu content
    const row = target.closest<HTMLElement>('[data-notification-id]');
    if (row && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      const stops = [
        row.querySelector<HTMLElement>(ROW_LINK_SELECTOR),
        ...row.querySelectorAll<HTMLElement>('[data-row-actions] button'),
      ].filter((stop): stop is HTMLElement => Boolean(stop));
      const at = stops.indexOf(target);
      if (at < 0) return;
      const next = event.key === 'ArrowRight' ? Math.min(stops.length - 1, at + 1) : Math.max(0, at - 1);
      event.preventDefault();
      event.stopPropagation();
      stops[next]?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const links = [...list.querySelectorAll<HTMLElement>(ROW_LINK_SELECTOR)];
    if (links.length === 0) return;
    const current = row?.querySelector<HTMLElement>(ROW_LINK_SELECTOR) ?? null;
    const index = links.findIndex((link) => link === current);
    let next = index;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : Math.min(links.length - 1, index + 1);
    if (event.key === 'ArrowUp') next = index < 0 ? 0 : Math.max(0, index - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = links.length - 1;
    event.preventDefault();
    event.stopPropagation();
    links[next]?.focus();
  };

  const boardOptions = [
    { value: 'all', label: 'All boards' },
    ...(boards.data ?? []).map((board) => ({ value: board.id, label: board.name })),
  ];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          data-testid="notifications-panel"
          aria-describedby={undefined}
          style={{ width: 'min(520px, 100vw)' }}
          onInteractOutside={(event) => {
            const target = event.target as Element | null;
            if (target?.closest?.('[data-notifications-trigger], [data-sonner-toaster]'))
              event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            // The bell sits outside this dialog's trigger, so Radix cannot restore focus to it.
            const active = document.activeElement;
            if (
              !active ||
              active === document.body ||
              event.currentTarget === null ||
              (event.currentTarget as HTMLElement).contains?.(active)
            ) {
              event.preventDefault();
              focusBellQuietly();
            }
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)
              ?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
              ?.focus();
          }}
          className={cn(
            'fixed top-[var(--topbar-height)] right-0 bottom-0 z-[var(--z-modal)] flex flex-col overflow-hidden',
            'border-l border-border-subtle bg-raised text-fg shadow-modal outline-none',
            'sm:right-2 sm:bottom-2 sm:rounded-xl sm:border',
            'data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right',
          )}
        >
          <header className="flex items-center gap-2 px-5 pt-4 pb-2 sm:px-6">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate font-heading text-xl font-semibold">
              Notifications
            </DialogPrimitive.Title>
            <Button
              variant="tertiary"
              size="sm"
              leadingIcon={<CheckCheck aria-hidden />}
              disabled={!hasUnreadInView}
              onClick={markAll}
              className="hidden sm:inline-flex"
              data-testid="notifications-mark-all"
            >
              {markAllLabel}
            </Button>
            <DropdownMenu {...optionsTooltip.menuProps}>
              <Tooltip
                content="Notification options"
                open={optionsTooltip.open}
                onOpenChange={optionsTooltip.onOpenChange}
              >
                <DropdownMenuTrigger asChild>
                  <IconButton
                    label="Notification options"
                    hideTooltip
                    icon={<MoreHorizontal aria-hidden />}
                    data-testid="notifications-options"
                    {...optionsTooltip.triggerProps}
                  />
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent
                align="end"
                className="w-60"
                onCloseAutoFocus={optionsTooltip.onCloseAutoFocus}
              >
                <DropdownMenuItem
                  icon={<CheckCheck aria-hidden />}
                  disabled={!hasUnreadInView}
                  onSelect={markAll}
                >
                  {markAllLabel}
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={<Inbox aria-hidden />}
                  onSelect={() => {
                    router.push(routes.inbox(org.slug));
                    close();
                  }}
                >
                  Open inbox
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  icon={<Settings2 aria-hidden />}
                  onSelect={() => {
                    router.push(`${routes.profile(org.slug)}?tab=notifications`);
                    close();
                  }}
                >
                  Notification settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DialogPrimitive.Close asChild>
              <IconButton label="Close notifications" icon={<X aria-hidden />} shortcut={['Esc']} />
            </DialogPrimitive.Close>
          </header>

          <div className="px-5 sm:px-6">
            <Tabs value={tab} onValueChange={(value) => setTab(value as PanelTab)}>
              <TabsList aria-label="Filter notifications" className="gap-5 overflow-x-auto">
                {TABS.map((option) => (
                  <TabsTrigger
                    key={option.value}
                    value={option.value}
                    count={option.value === 'unread' && unreadCount ? unreadCount : undefined}
                    onPointerEnter={() => prefetchTabs([option.value], { boardId: scopedBoard, q })}
                    // The list scrolls horizontally (and so clips vertically): keep the ring inside.
                    className="shrink-0 focus-visible:outline-offset-[-2px]"
                    data-testid={`notifications-tab-${option.value}`}
                  >
                    <span className="sm:hidden">{option.short}</span>
                    <span className="hidden sm:inline">{option.label}</span>
                    {option.value === 'unread' && unreadCount === null ? (
                      // Count not known yet: reserve the pill so the tabs to the right never jump.
                      <span aria-hidden className="h-4 w-6 animate-pulse rounded-full bg-muted" />
                    ) : null}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2 py-3">
              <SearchInput
                size="sm"
                value={search}
                onValueChange={setSearch}
                placeholder="Search notifications"
                aria-label="Search notifications"
                containerClassName="flex-1"
              />
              <Select
                size="sm"
                value={boardId}
                onValueChange={setBoardId}
                options={boardOptions}
                aria-label="Filter by board"
                className="w-36 sm:w-44"
              />
            </div>
          </div>

          <div
            ref={listRef}
            onKeyDownCapture={onListKeyDown}
            aria-busy={feed.isPending || feed.isPlaceholderData || undefined}
            className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border-subtle"
            data-testid="notifications-list"
            data-refreshing={feed.isPlaceholderData || undefined}
          >
            {feed.isPlaceholderData ? (
              <span
                aria-hidden
                className="sticky top-0 z-[3] -mb-0.5 block h-0.5 w-full animate-pulse bg-primary"
              />
            ) : null}
            {feed.isPending ? (
              <RowSkeletons />
            ) : feedFailed ? (
              <div className="p-5">
                <div
                  role="alert"
                  className="flex items-center gap-3 rounded-md border border-danger/30 bg-danger-subtle px-4 py-3 text-sm text-danger-text"
                >
                  <span className="flex-1">We couldn&apos;t load your notifications.</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<RotateCcw aria-hidden />}
                    onClick={() => void feed.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              </div>
            ) : entries.length === 0 ? (
              filtered ? (
                <EmptyState
                  size="sm"
                  illustration="search"
                  title="No matching notifications"
                  description="Try another search or board."
                  actions={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSearch('');
                        setBoardId('all');
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  illustration="notifications"
                  title={EMPTY_COPY[tab].title}
                  description={EMPTY_COPY[tab].description}
                />
              )
            ) : (
              <>
                {groups.map((group) => (
                  <section key={group.bucket} aria-label={group.bucket}>
                    <h3 className="sticky top-0 z-[1] bg-raised/95 px-6 pt-3 pb-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase backdrop-blur-sm">
                      {group.bucket}
                    </h3>
                    <ul
                      className={cn(
                        'flex flex-col transition-opacity duration-[var(--duration-fast)] ease-out',
                        feed.isPlaceholderData && 'opacity-60',
                      )}
                    >
                      {group.clusters.map(({ head, similar }) => {
                        const open = expanded.has(head.id);
                        return (
                          <Fragment key={head.id}>
                            <NotificationRow
                              entry={head}
                              href={notificationHref(org.slug, head)}
                              now={now}
                              fresh={isFresh(head)}
                              onOpen={onOpen}
                              onToggleRead={onToggleRead}
                              onDelete={onDelete}
                              onMute={onMute}
                              similarCount={similar.length}
                              similarExpanded={open}
                              onToggleSimilar={onToggleSimilar}
                            />
                            {open
                              ? similar.map((entry) => (
                                  <NotificationRow
                                    key={entry.id}
                                    nested
                                    entry={entry}
                                    href={notificationHref(org.slug, entry)}
                                    now={now}
                                    fresh={isFresh(entry)}
                                    onOpen={onOpen}
                                    onToggleRead={onToggleRead}
                                    onDelete={onDelete}
                                    onMute={onMute}
                                  />
                                ))
                              : null}
                          </Fragment>
                        );
                      })}
                    </ul>
                  </section>
                ))}
                <div ref={sentinelRef} aria-hidden className="h-px" />
                {isFetchingNextPage ? <RowSkeletons rows={2} /> : null}
                {feed.isError && entries.length > 0 ? (
                  <div className="flex justify-center p-3">
                    <Button
                      size="sm"
                      variant="tertiary"
                      leadingIcon={<RotateCcw aria-hidden />}
                      onClick={() => void fetchNextPage()}
                    >
                      Couldn&apos;t load more. Retry
                    </Button>
                  </div>
                ) : null}
                {!hasNextPage && entries.length > 8 ? (
                  <p className="py-5 text-center text-sm text-fg-muted">You&apos;ve reached the end.</p>
                ) : null}
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
