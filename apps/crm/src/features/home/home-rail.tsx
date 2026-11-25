'use client';
/** Right rail of the home page: inbox preview, favorites and the template rail. */
import Link from 'next/link';
import { Bell, LayoutTemplate, Star } from 'lucide-react';
import { Avatar, CountBadge, Skeleton, cn } from '@/components/ui';
import { useBoardTemplates, useFavorites, useHydrated, useNotifications, useUnreadCount } from '@/lib/hooks';
import { describeNotification, notificationHref } from '@/features/notifications/describe';
import { EntityIcon } from '@/features/shell/entity-icon';
import { useCan, useOrg } from '@/features/shell/org-context';
import { entityHref, routes } from '@/features/shell/routes';
import { useShellStore } from '@/features/shell/store';
import { formatRelativeTime } from './format';
import { SeeAll, SectionCard } from './home-sections';

const INBOX_PREVIEW = 4;
const TEMPLATE_LIMIT = 4;

function RowSkeletons({ rows }: { readonly rows: number }) {
  return (
    <div className="flex flex-col gap-2 p-4" data-skeleton>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={36} rounded="md" />
      ))}
    </div>
  );
}

export function InboxPreview() {
  const { org } = useOrg();
  const notifications = useNotifications('all');
  const unread = useUnreadCount();
  // The top bar loads the same data first. Until this card is live it shows what the server drew.
  const hydrated = useHydrated();
  const entries = (notifications.data?.pages.flatMap((page) => page.items) ?? []).slice(0, INBOX_PREVIEW);
  return (
    <SectionCard
      id="home-inbox"
      icon={<Bell aria-hidden />}
      title="Inbox"
      aside={
        <span className="flex items-center gap-2">
          {hydrated && unread.data ? <CountBadge count={unread.data} tone="primary" label={`${unread.data} unread`} /> : null}
          <SeeAll href={routes.inbox(org.slug)}>Open</SeeAll>
        </span>
      }
    >
      {!hydrated || notifications.isPending ? (
        <RowSkeletons rows={3} />
      ) : notifications.isError ? (
        <button
          type="button"
          onClick={() => void notifications.refetch()}
          className="m-4 rounded-sm px-2 py-1.5 text-left text-sm text-danger-text hover:bg-danger-subtle focus-visible:outline-2 focus-visible:outline-focus"
        >
          Couldn&apos;t load notifications. Retry
        </button>
      ) : entries.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-fg-muted">You&apos;re all caught up.</p>
      ) : (
        <ul className="flex flex-col py-1">
          {entries.map((entry) => {
            const description = describeNotification(entry);
            const href = notificationHref(org.slug, entry) ?? routes.inbox(org.slug);
            return (
              <li key={entry.id}>
                <Link
                  href={href}
                  aria-label={description.label}
                  className="flex gap-3 px-4 py-2.5 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                >
                  <Avatar name={description.actorName} src={entry.actor?.image} colorKey={entry.actor?.id} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn('line-clamp-2 text-sm', entry.readAt ? 'text-fg-secondary' : 'text-fg')}>
                      {description.segments.map((segment, index) =>
                        segment.strong ? (
                          <strong key={index} className="font-semibold">
                            {segment.text}
                          </strong>
                        ) : (
                          <span key={index}>{segment.text}</span>
                        ),
                      )}
                    </span>
                    <span className="text-xs text-fg-muted">{formatRelativeTime(entry.createdAt)}</span>
                  </span>
                  {entry.readAt ? null : (
                    <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

export function FavoritesCard() {
  const { org } = useOrg();
  const favorites = useFavorites();
  const hydrated = useHydrated();
  const list = (favorites.data ?? []).filter((favorite) => entityHref(org.slug, favorite.entityType, favorite.entityId));
  return (
    <SectionCard id="home-favorites" icon={<Star aria-hidden />} title="Favorites">
      {!hydrated || favorites.isPending ? (
        <RowSkeletons rows={2} />
      ) : list.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-fg-muted">
          Star a board from its “…” menu to pin it here.
        </p>
      ) : (
        <ul className="flex flex-col p-1.5">
          {list.map((favorite) => (
            <li key={favorite.id}>
              <Link
                href={entityHref(org.slug, favorite.entityType, favorite.entityId) ?? '#'}
                className="flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-base text-fg transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
              >
                <EntityIcon type={favorite.entityType === 'dashboard' ? 'dashboard' : 'board'} boardKind={favorite.boardKind} />
                <span className="truncate">{favorite.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function TemplatesRail({ workspaceId }: { readonly workspaceId: string | null }) {
  const templates = useBoardTemplates();
  const hydrated = useHydrated();
  const requestCreate = useShellStore((state) => state.requestCreate);
  const canCreate = useCan('board:create');
  const list = (templates.data ?? []).filter((template) => template.category !== 'blank').slice(0, TEMPLATE_LIMIT);
  if (!canCreate) return null;
  return (
    <SectionCard id="home-templates" icon={<LayoutTemplate aria-hidden />} title="Start from a template">
      {!hydrated || templates.isPending ? (
        <RowSkeletons rows={3} />
      ) : list.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-fg-muted">No templates available.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
          {list.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                disabled={!workspaceId}
                data-testid="home-template"
                onClick={() =>
                  workspaceId &&
                  requestCreate({ kind: 'board', workspaceId, mode: 'templates', templateId: template.id, name: template.name })
                }
                className="group flex h-full w-full items-start gap-3 rounded-lg border border-border-subtle bg-panel p-3 text-left transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] hover:border-primary hover:bg-highlight hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken [&_svg]:size-[18px]">
                  <EntityIcon type="board" boardKind={template.kind} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-fg group-hover:text-primary-text">{template.name}</span>
                  <span className="line-clamp-2 text-xs text-fg-muted">{template.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
