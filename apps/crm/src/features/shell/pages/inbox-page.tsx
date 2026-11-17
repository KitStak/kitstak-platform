'use client';
/** Inbox: the signed-in user's notifications with filters, read state and deep links. */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCheck, Inbox as InboxIcon } from 'lucide-react';
import { Avatar, Button, EmptyState, Skeleton, Tabs, TabsList, TabsTrigger, cn } from '@/components/ui';
import { useMarkNotifications, useNotifications, type NotificationFilter } from '@/lib/hooks';
import { useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import { formatRelativeTime } from '@/features/home/format';
import type { NotificationDto, NotificationKind } from '@/server/services/contracts/dto';
import { PageFrame, PageSection } from './page-frame';

const FILTERS: readonly { value: NotificationFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'mentions', label: 'Mentions' },
  { value: 'assigned', label: 'Assigned to me' },
];

const VERB: Record<NotificationKind, string> = {
  mention: 'mentioned you on',
  assigned: 'assigned you to',
  update_reply: 'replied to your update on',
  update_on_subscribed: 'posted an update on',
  status_change: 'changed the status of',
  due_date: 'has a date arriving on',
  invitation: 'invited you to',
  automation: 'triggered an automation on',
  reaction: 'reacted to your update on',
  board_shared: 'shared a board with you:',
};

function isFilter(value: string | null): value is NotificationFilter {
  return FILTERS.some((filter) => filter.value === value);
}

function NotificationRow({ entry, orgSlug, onOpen }: { readonly entry: NotificationDto; readonly orgSlug: string; readonly onOpen: () => void }) {
  const actor = entry.actor?.name ?? 'KitStak';
  const target = entry.itemName ?? entry.boardName ?? 'an item';
  const href = entry.boardId ? routes.board(orgSlug, entry.boardId) : null;
  const body = (
    <>
      <span className="relative mt-0.5">
        <Avatar name={actor} src={entry.actor?.image ?? null} size="md" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base text-fg">
          <span className="font-semibold">{actor}</span> {VERB[entry.kind]}{' '}
          <span className="font-medium">{target}</span>
        </span>
        <span className="mt-0.5 block text-sm text-fg-muted">
          {entry.boardName ? `${entry.boardName} · ` : ''}
          {formatRelativeTime(entry.createdAt)}
        </span>
      </span>
      {entry.readAt ? null : <span aria-label="Unread" className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
    </>
  );
  const className = cn(
    'flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
    !entry.readAt && 'bg-primary-subtle/40',
  );
  return (
    <li className="border-b border-border-subtle last:border-b-0">
      {href ? (
        <Link href={href} className={className} onClick={onOpen}>
          {body}
        </Link>
      ) : (
        <button type="button" className={className} onClick={onOpen}>
          {body}
        </button>
      )}
    </li>
  );
}

export function InboxPage() {
  const { org } = useOrg();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get('filter');
  const filter: NotificationFilter = isFilter(requested) ? requested : 'all';
  const notifications = useNotifications(filter);
  const mark = useMarkNotifications();
  const entries = notifications.data?.pages.flatMap((page) => page.items) ?? [];
  const hasUnread = entries.some((entry) => !entry.readAt);

  return (
    <PageFrame
      title="Inbox"
      icon={<InboxIcon />}
      actions={
        <Button
          variant="secondary"
          leadingIcon={<CheckCheck />}
          disabled={!hasUnread}
          onClick={() => mark.mutate({ all: true, read: true })}
        >
          Mark all as read
        </Button>
      }
    >
      <Tabs
        value={filter}
        onValueChange={(value) => router.replace(`${routes.inbox(org.slug)}?filter=${value}`, { scroll: false })}
      >
        <TabsList aria-label="Filter notifications">
          {FILTERS.map((option) => (
            <TabsTrigger key={option.value} value={option.value}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <PageSection>
        {notifications.isPending ? (
          <div className="flex flex-col gap-3 p-5" data-skeleton>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} height={44} rounded="md" />
            ))}
          </div>
        ) : notifications.isError ? (
          <EmptyState
            illustration="error"
            title="Couldn't load your inbox"
            actions={
              <Button variant="secondary" onClick={() => void notifications.refetch()}>
                Try again
              </Button>
            }
          />
        ) : entries.length === 0 ? (
          <EmptyState
            illustration="inbox"
            title={filter === 'all' ? "You're all caught up" : 'Nothing here'}
            description="Mentions, assignments and replies show up here."
          />
        ) : (
          <ul aria-label="Notifications">
            {entries.map((entry) => (
              <NotificationRow
                key={entry.id}
                entry={entry}
                orgSlug={org.slug}
                onOpen={() => {
                  if (!entry.readAt) mark.mutate({ ids: [entry.id], read: true });
                }}
              />
            ))}
          </ul>
        )}
        {notifications.hasNextPage ? (
          <div className="border-t border-border-subtle p-3 text-center">
            <Button
              variant="tertiary"
              loading={notifications.isFetchingNextPage}
              onClick={() => void notifications.fetchNextPage()}
            >
              Load older notifications
            </Button>
          </div>
        ) : null}
      </PageSection>
    </PageFrame>
  );
}
