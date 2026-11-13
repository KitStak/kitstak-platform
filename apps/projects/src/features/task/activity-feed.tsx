'use client';
/**
 * Conversation + history in one timeline (oldest first, composer at the bottom). Filter:
 * Everything · Comments · History (remembered per browser). Long histories fold older changes
 * behind "Show N earlier changes". A `#comment-<id>` link scrolls to and highlights the comment.
 */
import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  CircleDashed,
  Clock,
  GitBranch,
  History,
  Link2,
  MessageSquare,
  MoveRight,
  Paperclip,
  Pencil,
  Plus,
  Tag,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { Skeleton, ToggleGroup, toast } from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { describeActivity } from '@/lib/activity-text';
import { formatRelative } from '@/lib/dates';
import { useTaskActivity, useTaskComments } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { qk } from '@/lib/query-keys';
import type { ActivityDTO, CommentDTO } from '@/lib/types';
import { addCommentAction } from '@/server/actions/comments';
import { useShell } from '@/features/shell/shell-context';
import { CommentComposer, type ComposerHandle } from './comment-composer';
import { CommentItem } from './comment-item';
import { SectionHeading } from './property-row';
import { useTaskContext } from './task-context';
import { useTaskUploads } from './use-task-uploads';
import { LocalTime } from './local-time';

type Filter = 'all' | 'comments' | 'history';
const FILTER_KEY = 'kitstak.projects.taskFeedFilter';
const FOLD_AFTER = 8;

/** Verbs that are shown as comments (or are noise) rather than history lines. */
const HIDDEN_VERBS = new Set(['comment.added', 'comment.edited']);

function verbIcon(event: ActivityDTO): LucideIcon {
  if (event.actorKind === 'automation' || event.verb === 'automation.ran') return Bot;
  if (event.verb === 'task.created') return Plus;
  if (event.verb === 'task.updated' && event.field === 'status') return CircleDashed;
  if (event.verb === 'task.updated' && (event.field === 'assignee' || event.field === 'reporter'))
    return UserRound;
  if (event.verb.startsWith('task.label')) return Tag;
  if (event.verb.startsWith('task.dependency')) return GitBranch;
  if (event.verb.startsWith('task.link')) return Link2;
  if (event.verb.startsWith('attachment')) return Paperclip;
  if (event.verb.startsWith('time')) return Clock;
  if (event.verb.startsWith('task.moved')) return MoveRight;
  if (event.verb.includes('deleted')) return Trash2;
  if (event.verb.startsWith('comment')) return MessageSquare;
  return Pencil;
}

type Entry =
  { kind: 'comment'; at: string; comment: CommentDTO } | { kind: 'event'; at: string; event: ActivityDTO };

/** Remembered feed filter (per browser), as an external store so server and client agree. */
const filterListeners = new Set<() => void>();
function readFilter(): Filter {
  try {
    const value = window.localStorage.getItem(FILTER_KEY);
    return value === 'comments' || value === 'history' ? value : 'all';
  } catch {
    return 'all';
  }
}
function writeFilter(next: Filter) {
  try {
    window.localStorage.setItem(FILTER_KEY, next);
  } catch {
    // Not remembered in private mode.
  }
  for (const listener of filterListeners) listener();
}
function subscribeFilter(listener: () => void) {
  filterListeners.add(listener);
  return () => filterListeners.delete(listener);
}

function HistoryLine({ event }: { readonly event: ActivityDTO }) {
  const { project, statusById } = useTaskContext();
  const people = usePeopleMap();
  const actor =
    event.actorKind === 'automation'
      ? 'Automation'
      : event.actorId
        ? (people.get(event.actorId)?.name ?? 'Former member')
        : 'KitStak';
  const text = describeActivity(event, {
    statusName: (id) => statusById.get(id)?.name,
    personName: (id) => people.get(id)?.name,
    labelName: (id) => project.labels.find((label) => label.id === id)?.name,
    sectionName: (id) => project.sections.find((section) => section.id === id)?.name,
  });
  return (
    <li className="flex items-start gap-3 py-1.5 pl-1" data-testid="history-item">
      <span className="relative z-[1] mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-raised text-icon">
        {createElement(verbIcon(event), { 'aria-hidden': true, className: 'size-3' })}
      </span>
      <p className="min-w-0 flex-1 pt-0.5 text-xs leading-5 text-fg-secondary">
        <span className="font-medium text-fg">{actor}</span> {text}{' '}
        <LocalTime iso={event.createdAt} className="text-fg-muted">
          · {formatRelative(event.createdAt)}
        </LocalTime>
      </p>
    </li>
  );
}

export function ActivityFeed() {
  const { task, canComment, refresh, live } = useTaskContext();
  const { user } = useShell();
  const queryClient = useQueryClient();
  const comments = useTaskComments(task.id, { enabled: live });
  const activity = useTaskActivity(task.id, { enabled: live });
  const filter = useSyncExternalStore(subscribeFilter, readFilter, () => 'all' as Filter);
  const [unfolded, setUnfolded] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const composer = useRef<ComposerHandle>(null);
  // Files attached in the comment box upload on their own (they show as chips there, not in Files).
  const commentUploads = useTaskUploads(task, { silent: true });

  const commentList = useMemo(() => comments.data ?? [], [comments.data]);
  const events = useMemo(
    () => (activity.data?.items ?? []).filter((event) => !HIDDEN_VERBS.has(event.verb)),
    [activity.data?.items],
  );

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    if (filter !== 'history')
      for (const comment of commentList) list.push({ kind: 'comment', at: comment.createdAt, comment });
    if (filter !== 'comments')
      for (const event of events) list.push({ kind: 'event', at: event.createdAt, event });
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [commentList, events, filter]);

  // Fold the oldest history lines (never comments) when the timeline is long.
  const foldable = entries.length > FOLD_AFTER + 4 && !unfolded && filter !== 'comments';
  let hiddenCount = 0;
  const visible = foldable
    ? entries.filter((entry, index) => {
        if (entry.kind === 'comment' || index >= entries.length - FOLD_AFTER) return true;
        hiddenCount += 1;
        return false;
      })
    : entries;

  // Deep link: /p/OPS/42#comment-<id>.
  useEffect(() => {
    if (!comments.data) return;
    const match = /^#comment-([0-9a-f-]{36})$/i.exec(window.location.hash);
    if (!match) return;
    const id = match[1];
    requestAnimationFrame(() => {
      const element = document.getElementById(`comment-${id}`);
      if (!element) return;
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlash(id);
    });
  }, [comments.data]);

  const post = async (body: string, attachmentIds: string[]) => {
    const result = await addCommentAction({ taskId: task.id, body, attachmentIds });
    if (!result.ok) {
      toast.error("Couldn't post your comment", result.error.message);
      return false;
    }
    queryClient.setQueryData<CommentDTO[]>(qk.taskComments(task.id), (list) => [
      ...(list ?? []),
      result.data,
    ]);
    void queryClient.invalidateQueries({ queryKey: qk.taskComments(task.id) });
    void queryClient.invalidateQueries({ queryKey: qk.taskActivity(task.id) });
    void queryClient.invalidateQueries({ queryKey: qk.taskAttachments(task.id) });
    refresh();
    return true;
  };

  const choose = (next: Filter) => {
    setUnfolded(false);
    writeFilter(next);
  };

  const loading = comments.isLoading || activity.isLoading;

  return (
    <section aria-labelledby="task-activity-heading" data-testid="task-activity">
      <SectionHeading
        id="task-activity-heading"
        icon={<MessageSquare aria-hidden />}
        actions={
          <ToggleGroup
            size="sm"
            label="Show"
            value={filter}
            onValueChange={choose}
            options={[
              { value: 'all', label: 'Everything' },
              { value: 'comments', label: `Comments${commentList.length ? ` ${commentList.length}` : ''}` },
              { value: 'history', label: 'History' },
            ]}
          />
        }
      >
        Activity
      </SectionHeading>

      {loading ? (
        <div className="mt-3 flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex gap-3">
              <Skeleton width={28} height={28} rounded="full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton height={12} width="30%" />
                <Skeleton height={14} width={index === 1 ? '50%' : '80%'} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="relative mt-2">
          {visible.length > 1 ? (
            <span aria-hidden className="absolute top-3 bottom-3 left-[13px] w-px bg-border-subtle" />
          ) : null}
          <ol className="relative flex flex-col gap-0.5">
            {foldable && hiddenCount > 0 ? (
              <li className="py-1 pl-1">
                <button
                  type="button"
                  onClick={() => setUnfolded(true)}
                  className="relative z-[1] inline-flex h-7 items-center gap-2 rounded-full border border-border-subtle bg-raised px-2.5 text-xs font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <History aria-hidden className="size-3.5" />
                  Show {hiddenCount} earlier {hiddenCount === 1 ? 'change' : 'changes'}
                </button>
              </li>
            ) : null}
            {visible.map((entry) =>
              entry.kind === 'comment' ? (
                <CommentItem
                  key={`c-${entry.comment.id}`}
                  comment={entry.comment}
                  highlighted={flash === entry.comment.id}
                />
              ) : (
                <HistoryLine key={`e-${entry.event.id}`} event={entry.event} />
              ),
            )}
          </ol>
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border-default px-4 py-6 text-center">
              <MessageSquare aria-hidden className="size-5 text-icon" />
              <p className="text-sm font-medium text-fg">
                {filter === 'history' ? 'No changes yet' : 'No comments yet'}
              </p>
              <p className="text-xs text-fg-muted">
                {filter === 'history'
                  ? 'Every change to this task will show up here.'
                  : canComment
                    ? 'Ask a question, share an update, or @mention a teammate to loop them in.'
                    : 'Comments from your team will show up here.'}
              </p>
            </div>
          ) : null}
        </div>
      )}

      {canComment ? (
        <div className="mt-3 flex gap-3" data-testid="comment-composer">
          <PersonAvatar userId={user.id} size="sm" className="mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <CommentComposer
              ref={composer}
              draftKey={`kitstak.projects.commentDraft.${task.id}`}
              submitLabel="Comment"
              onSubmit={post}
              uploads={commentUploads}
              compact
            />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-fg-muted">
          You can read this task. Ask a project owner for comment access to join the conversation.
        </p>
      )}
    </section>
  );
}
