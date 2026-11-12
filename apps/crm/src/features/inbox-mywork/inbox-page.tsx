'use client';
/**
 * Inbox: update threads on items I follow or was mentioned in. Filters (All / Mentions /
 * Unread / board) persist in the URL; cards support Like, inline Reply and read state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Inbox as InboxIcon, RotateCcw } from 'lucide-react';
import { Button, EmptyState, Select, Skeleton, Tabs, TabsList, TabsTrigger, cn } from '@/components/ui';
import { useMembers } from '@/lib/hooks';
import { useOrg } from '@/features/shell/org-context';
import { PageFrame } from '@/features/shell/pages/page-frame';
import type { UpdateDto, UserSummaryDto } from '@/server/services/contracts/dto';
import {
  INBOX_FILTERS,
  type InboxFilter,
  type InboxThreadDto,
} from '@/server/services/contracts/inbox-mywork';
import { useInboxBoards, useInboxFeed, useInboxLike, useInboxMarkRead, useInboxReply } from './api';
import type { RichDoc } from '@/features/item-panel/lib/rich-text';
import { InboxCard } from './inbox-card';
import { useUrlState } from './use-url-state';

const FILTER_LABEL: Readonly<Record<InboxFilter, string>> = {
  all: 'All updates',
  mentions: 'Mentions',
  unread: 'Unread',
};

const EMPTY: Readonly<Record<InboxFilter, { title: string; description: string }>> = {
  all: {
    title: 'Inbox zero',
    description: 'Updates on items you own, follow or were mentioned in will land here.',
  },
  mentions: {
    title: 'No mentions',
    description: 'When someone @mentions you in an update, it shows up here.',
  },
  unread: { title: "You're all caught up", description: 'Every update in your inbox has been read.' },
};

function isFilter(value: string | null): value is InboxFilter {
  return INBOX_FILTERS.some((filter) => filter === value);
}

function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border-subtle bg-panel p-5" aria-hidden>
      <div className="flex gap-3">
        <Skeleton width={32} height={32} rounded="full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton width="30%" height={14} />
          <Skeleton width="45%" height={12} />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:pl-11">
        <Skeleton width="92%" height={14} />
        <Skeleton width="70%" height={14} />
      </div>
    </div>
  );
}

let tempCounter = 0;

export function InboxPage() {
  const { org, user } = useOrg();
  const [requested, setFilterParam] = useUrlState('filter');
  const [boardParam, setBoardParam] = useUrlState('board');
  const filter: InboxFilter = isFilter(requested) ? requested : 'all';
  const boardId = boardParam ?? undefined;
  const feed = useInboxFeed({ filter, boardId });
  const boards = useInboxBoards();
  const members = useMembers();
  const me: UserSummaryDto = useMemo(
    () => ({ id: user.id, name: user.name, email: user.email, image: user.image, title: null }),
    [user],
  );
  const markRead = useInboxMarkRead();
  const like = useInboxLike(user.id);
  const reply = useInboxReply(me);
  const sentinel = useRef<HTMLDivElement>(null);
  const [now] = useState(() => new Date());

  const threads = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data]);
  const unreadCount = feed.data?.pages[0]?.unreadCount ?? 0;
  const names = useMemo(() => (members.data ?? []).map((member) => member.name), [members.data]);
  const users = useMemo<UserSummaryDto[]>(
    () =>
      (members.data ?? []).map((member) => ({
        id: member.userId,
        name: member.name,
        email: member.email,
        image: member.image,
        title: member.title,
      })),
    [members.data],
  );
  // Mutation `mutate` functions are stable; depending on them (not the mutation objects, which
  // change on every state transition) keeps the card callbacks stable, so a Like re-renders
  // only the card it touched.
  const markReadMutate = markRead.mutate;
  const likeMutate = like.mutate;
  const replyAsync = reply.mutateAsync;

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, threads.length]);

  const onToggleRead = useCallback(
    (thread: InboxThreadDto) => markReadMutate({ thread, read: thread.unread }),
    [markReadMutate],
  );
  const onLike = useCallback(
    (thread: InboxThreadDto, update: UpdateDto) => likeMutate({ updateId: update.id, itemId: thread.itemId }),
    [likeMutate],
  );
  const onReply = useCallback(
    async (thread: InboxThreadDto, body: RichDoc, text: string) => {
      tempCounter += 1;
      await replyAsync({ thread, body, text, tempId: `temp-${Date.now()}-${tempCounter}` });
      if (thread.unread) markReadMutate({ thread, read: true });
    },
    [replyAsync, markReadMutate],
  );

  const boardOptions = [
    { value: 'all', label: 'All boards' },
    ...(boards.data ?? []).map((board) => ({ value: board.id, label: board.name })),
  ];

  return (
    <PageFrame
      title="Inbox"
      description="Updates on the items you own, follow or were mentioned in."
      icon={<InboxIcon />}
    >
      <div className="-mt-3 flex w-full max-w-[800px] flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <Tabs value={filter} onValueChange={(value) => setFilterParam(value === 'all' ? null : value)}>
            <TabsList aria-label="Filter inbox" className="gap-5">
              {INBOX_FILTERS.map((option) => (
                <TabsTrigger
                  key={option}
                  value={option}
                  count={option === 'unread' && unreadCount > 0 ? unreadCount : undefined}
                  data-testid={`inbox-filter-${option}`}
                >
                  {FILTER_LABEL[option]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Select
            value={boardId ?? 'all'}
            onValueChange={(value) => setBoardParam(value === 'all' ? null : value)}
            options={boardOptions}
            aria-label="Filter by board"
            className="sm:w-56"
          />
        </div>

        <div
          aria-busy={feed.isPending || feed.isPlaceholderData || undefined}
          data-refreshing={feed.isPlaceholderData || undefined}
          className={cn(
            'relative flex w-full flex-col gap-3 transition-opacity duration-[var(--duration-fast)] ease-out',
            feed.isPlaceholderData && 'pointer-events-none opacity-60',
          )}
        >
          {feed.isPlaceholderData ? (
            <span
              aria-hidden
              className="absolute -top-2 right-0 left-0 h-0.5 animate-pulse rounded-full bg-primary"
            />
          ) : null}
          {feed.isPending ? (
            <div data-skeleton className="flex flex-col gap-3">
              {Array.from({ length: 4 }, (_, index) => (
                <CardSkeleton key={index} />
              ))}
            </div>
          ) : feed.isError && threads.length === 0 ? (
            <EmptyState
              illustration="error"
              title="We couldn't load your inbox"
              description="Check your connection and try again."
              actions={
                <Button
                  variant="secondary"
                  leadingIcon={<RotateCcw aria-hidden />}
                  onClick={() => void feed.refetch()}
                >
                  Try again
                </Button>
              }
            />
          ) : threads.length === 0 ? (
            <EmptyState
              illustration="inbox"
              title={boardId ? 'No updates on this board' : EMPTY[filter].title}
              description={boardId ? 'Try another board or clear the filter.' : EMPTY[filter].description}
              actions={
                boardId || filter !== 'all' ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFilterParam(null);
                      setBoardParam(null);
                    }}
                  >
                    Show all updates
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {threads.map((thread) => (
                <InboxCard
                  key={thread.update.id}
                  thread={thread}
                  orgSlug={org.slug}
                  me={me}
                  names={names}
                  users={users}
                  now={now}
                  onToggleRead={onToggleRead}
                  onLike={onLike}
                  onReply={onReply}
                />
              ))}
              <div ref={sentinel} aria-hidden className="h-px" />
              {isFetchingNextPage ? <CardSkeleton /> : null}
              {feed.isError ? (
                <Button
                  variant="tertiary"
                  leadingIcon={<RotateCcw aria-hidden />}
                  onClick={() => void fetchNextPage()}
                >
                  Couldn&apos;t load more. Retry
                </Button>
              ) : null}
              {!hasNextPage && threads.length > 4 ? (
                <p className="py-4 text-center text-sm text-fg-muted">You&apos;re all caught up.</p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </PageFrame>
  );
}
