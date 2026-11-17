'use client';

/**
 * Updates tab: composer, pinned-first threads, empty state, skeletons, retryable error,
 * realtime arrivals with a highlight + live-region announcement, and read receipts.
 */
import { useEffect, useMemo, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { errorMessage, useItemUpdates, useMarkItemUpdatesRead, useToggleReaction } from '@/lib/hooks';
import type { FileDto, UpdateDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { itemShareUrl } from '../lib/url-state';
import { useUpdateMutations } from '../hooks/use-update-mutations';
import { Lightbox } from '../files/lightbox';
import { UpdatesArt } from '../parts/illustrations';
import { useNow } from '../parts/common';
import { Composer } from './composer';
import { UpdateThread, copyToClipboard, type ThreadContext } from './update-card';

export interface UpdatesTabProps {
  readonly itemId: string;
  readonly boardId: string;
  readonly term: string;
  readonly me: UserSummaryDto | null;
  readonly users: readonly UserSummaryDto[];
  readonly usersById: ReadonlyMap<string, UserSummaryDto>;
  readonly canWrite: boolean;
  readonly canModerate: boolean;
  readonly focusUpdateId: string | null;
  readonly fileUrl: (fileId: string, download?: boolean) => string;
  /** Known update count (from the item row) so the loading skeleton matches what arrives. */
  readonly expectedCount?: number;
}

function UpdatesSkeleton({ count }: { readonly count: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading updates" data-skeleton className="flex flex-col gap-3">
      {Array.from({ length: Math.min(3, Math.max(1, count)) }, (_, key) => (
        <div key={key} className="rounded-lg border border-border-subtle bg-panel p-4">
          <div className="flex items-center gap-3">
            <Skeleton width={32} height={32} rounded="full" />
            <Skeleton width={120} height={12} rounded="full" />
            <Skeleton width={36} height={10} rounded="full" />
          </div>
          <div className="mt-3 flex flex-col gap-2 pl-11">
            <Skeleton width="92%" height={10} rounded="full" />
            <Skeleton width="64%" height={10} rounded="full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function UpdatesTab({
  itemId,
  boardId,
  term,
  me,
  users,
  usersById,
  canWrite,
  canModerate,
  focusUpdateId,
  fileUrl,
  expectedCount,
}: UpdatesTabProps) {
  const query = useItemUpdates(itemId);
  const mutations = useUpdateMutations(itemId, boardId, me);
  const react = useToggleReaction(itemId, me?.id ?? '');
  const { mutate: markItemRead } = useMarkItemUpdatesRead(itemId);
  const now = useNow();
  const [focusSignal, setFocusSignal] = useState(0);
  const [lightbox, setLightbox] = useState<{ files: readonly FileDto[]; index: number } | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');

  const threads = useMemo(
    () => (query.data ?? []).filter((thread) => !mutations.hidden.has(thread.id)),
    [mutations.hidden, query.data],
  );

  // Realtime: highlight updates that arrive from other people after the first load
  // (derived while rendering when the list changes; cleared by a timer).
  const [seen, setSeen] = useState<{ itemId: string; data: UpdateDto[] | undefined; ids: ReadonlySet<string> | null }>({
    itemId,
    data: undefined,
    ids: null,
  });
  if (seen.itemId !== itemId || seen.data !== query.data) {
    const ids = new Set<string>();
    const arrivals: UpdateDto[] = [];
    for (const thread of query.data ?? []) {
      for (const update of [thread, ...thread.replies]) {
        ids.add(update.id);
        const known = seen.itemId === itemId ? seen.ids : null;
        if (known && !known.has(update.id) && !update.id.startsWith('temp-') && update.author?.id !== me?.id) arrivals.push(update);
      }
    }
    setSeen({ itemId, data: query.data, ids: query.data ? ids : null });
    if (arrivals.length > 0) {
      setFresh((current) => new Set([...current, ...arrivals.map((update) => update.id)]));
      setAnnouncement(`New update from ${arrivals[0]?.author?.name ?? 'a teammate'}`);
    }
  }
  useEffect(() => {
    if (fresh.size === 0) return;
    const timer = setTimeout(() => setFresh(new Set()), 2600);
    return () => clearTimeout(timer);
  }, [fresh]);

  // Read receipts: mark the item's updates as read once they are on screen.
  const hasUnread = (query.data ?? []).some((thread) => !thread.readByMe || thread.replies.some((reply) => !reply.readByMe));
  useEffect(() => {
    if (!hasUnread) return;
    const timer = setTimeout(() => markItemRead(), 800);
    return () => clearTimeout(timer);
  }, [hasUnread, itemId, markItemRead]);

  // Deep link to an update: scroll into view and flash it.
  useEffect(() => {
    if (!focusUpdateId || !query.data) return;
    const node = document.getElementById(`update-${focusUpdateId}`);
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusUpdateId, query.data]);

  const ctx: ThreadContext = {
    me,
    users,
    usersById,
    canWrite,
    canModerate,
    now,
    hidden: mutations.hidden,
    fresh: focusUpdateId ? new Set([...fresh, focusUpdateId]) : fresh,
    onReact: (update, emoji) => react.mutate({ updateId: update.id, emoji }),
    onEdit: (update, body) => mutations.edit.mutateAsync({ update, body }),
    onPin: (update) => mutations.pin.mutate({ updateId: update.id, pinned: !update.pinned }),
    onDelete: (update) => mutations.remove(update),
    onReply: (thread, body) => mutations.post(body, thread.id),
    onCopyLink: (update) => copyToClipboard(itemShareUrl(window.location, itemId, { updateId: update.parentUpdateId ?? update.id }), 'Link to update copied'),
    onOpenFile: (files, index) => setLightbox({ files, index }),
  };

  return (
    <div className="flex flex-col gap-4">
      <Composer key={itemId} itemId={itemId} boardId={boardId} users={users} me={me} readOnly={!canWrite} post={(body) => mutations.post(body)} focusSignal={focusSignal} />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {query.isLoading ? (
        <UpdatesSkeleton count={expectedCount ?? 1} />
      ) : query.isError ? (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-border-subtle bg-panel px-6 py-8 text-center">
          <p className="font-medium text-fg">Couldn’t load updates</p>
          <p className="text-sm text-fg-secondary">{errorMessage(query.error)}</p>
          <Button variant="secondary" size="sm" leadingIcon={<RotateCw aria-hidden />} onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : threads.length === 0 ? (
        <EmptyState
          visual={<UpdatesArt />}
          title="No updates yet"
          description="@mention a teammate to loop them in."
          actions={
            canWrite ? (
              <Button variant="secondary" size="sm" onClick={() => setFocusSignal((value) => value + 1)}>
                Write the first update
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="flex flex-col gap-3" data-testid="updates-list">
          {threads.map((thread) => (
            <UpdateThread key={thread.id} thread={thread} ctx={ctx} />
          ))}
        </div>
      )}
      <Lightbox
        files={lightbox?.files ?? []}
        index={lightbox?.index ?? null}
        onIndexChange={(index) => setLightbox((current) => (index === null || !current ? null : { ...current, index }))}
        fileUrl={fileUrl}
        uploaderName={(id) => (id ? (usersById.get(id)?.name ?? null) : null)}
      />
    </div>
  );
}
