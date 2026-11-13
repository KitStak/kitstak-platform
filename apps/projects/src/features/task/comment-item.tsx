'use client';
/**
 * One comment: author, time, markdown body with mentions, attached files, emoji reactions
 * (optimistic toggle), and a hover bar to react, copy a link, edit or delete (own comments;
 * editors can delete anyone's). Delete has Undo.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link2, MoreHorizontal, Paperclip, Pencil, SmilePlus, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { REACTION_EMOJIS } from '@/lib/constants';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { AttachmentDTO, CommentDTO } from '@/lib/types';
import {
  deleteCommentAction,
  editCommentAction,
  restoreCommentAction,
  toggleReactionAction,
} from '@/server/actions/comments';
import { useShell } from '@/features/shell/shell-context';
import { CommentComposer } from './comment-composer';
import { MarkdownView } from './markdown-view';
import { useTaskContext } from './task-context';
import { formatBytes, isImageType } from './task-utils';
import { LocalTime } from './local-time';

function ReactionPicker({
  onPick,
  children,
}: {
  readonly onPick: (emoji: string) => void;
  readonly children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-1.5" aria-label="Add a reaction">
        <div className="flex gap-0.5">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(emoji);
              }}
              className="inline-flex size-8 items-center justify-center rounded-md text-lg transition-transform hover:scale-110 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CommentFiles({ files }: { readonly files: readonly AttachmentDTO[] }) {
  if (!files.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Files in this comment">
      {files.map((file) =>
        isImageType(file.contentType) ? (
          <li key={file.id}>
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-md border border-border-subtle hover:border-border-strong"
              aria-label={`Open ${file.name}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- private file route */}
              <img src={file.url} alt={file.name} loading="lazy" className="h-24 max-w-56 object-cover" />
            </a>
          </li>
        ) : (
          <li key={file.id}>
            <a
              href={`${file.url}?download=1`}
              className="flex h-8 max-w-64 items-center gap-1.5 rounded-md border border-border-subtle bg-sunken px-2 text-xs text-fg hover:border-border-strong"
            >
              <Paperclip aria-hidden className="size-3.5 shrink-0 text-icon" />
              <span className="truncate font-medium">{file.name}</span>
              <span className="shrink-0 text-fg-muted">{formatBytes(file.sizeBytes)}</span>
            </a>
          </li>
        ),
      )}
    </ul>
  );
}

export function CommentItem({
  comment,
  highlighted,
}: {
  readonly comment: CommentDTO;
  readonly highlighted?: boolean;
}) {
  const { task, canComment, canDelete, refresh } = useTaskContext();
  const { user } = useShell();
  const queryClient = useQueryClient();
  const people = usePeopleMap();
  const [editing, setEditing] = useState(false);
  const author = comment.authorId ? people.get(comment.authorId) : undefined;
  const mine = comment.authorId === user.id;
  const key = qk.taskComments(task.id);

  const react = async (emoji: string) => {
    const before = queryClient.getQueryData<CommentDTO[]>(key);
    queryClient.setQueryData<CommentDTO[]>(key, (list) =>
      list?.map((entry) => {
        if (entry.id !== comment.id) return entry;
        const users = entry.reactions[emoji] ?? [];
        const next = users.includes(user.id) ? users.filter((id) => id !== user.id) : [...users, user.id];
        const reactions = { ...entry.reactions } as Record<string, readonly string[]>;
        if (next.length) reactions[emoji] = next;
        else delete reactions[emoji];
        return { ...entry, reactions };
      }),
    );
    const result = await toggleReactionAction({ commentId: comment.id, emoji });
    if (!result.ok) {
      queryClient.setQueryData(key, before);
      toast.error("Couldn't add that reaction", result.error.message);
      return;
    }
    queryClient.setQueryData<CommentDTO[]>(key, (list) =>
      list?.map((entry) => (entry.id === comment.id ? { ...entry, reactions: result.data } : entry)),
    );
  };

  const save = async (body: string) => {
    const result = await editCommentAction({ commentId: comment.id, body });
    if (!result.ok) {
      toast.error("Couldn't save your comment", result.error.message);
      return false;
    }
    queryClient.setQueryData<CommentDTO[]>(key, (list) =>
      list?.map((entry) => (entry.id === comment.id ? result.data : entry)),
    );
    setEditing(false);
    void queryClient.invalidateQueries({ queryKey: qk.taskActivity(task.id) });
    return true;
  };

  const remove = async () => {
    const before = queryClient.getQueryData<CommentDTO[]>(key);
    queryClient.setQueryData<CommentDTO[]>(key, (list) => list?.filter((entry) => entry.id !== comment.id));
    const result = await deleteCommentAction({ commentId: comment.id });
    if (!result.ok) {
      queryClient.setQueryData(key, before);
      toast.error("Couldn't delete that comment", result.error.message);
      return;
    }
    refresh();
    if (!mine) {
      toast.success('Comment deleted');
      return;
    }
    toast.undo('Comment deleted', {
      onUndo: async () => {
        const undo = await restoreCommentAction({ commentId: comment.id });
        if (!undo.ok) throw new Error(undo.error.message);
        refresh();
      },
    });
  };

  const copyLink = async () => {
    const url = `${window.location.origin}${routes.task(task.projectKey, task.number)}#comment-${comment.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link to comment copied');
    } catch {
      toast.error("Couldn't copy the link", url);
    }
  };

  const reactions = Object.entries(comment.reactions).filter(([, users]) => users.length > 0);

  return (
    <li
      id={`comment-${comment.id}`}
      className={cn(
        'group/comment relative -mx-2 flex scroll-mt-20 gap-3 rounded-lg px-2 py-2',
        highlighted && 'ks-task-flash',
      )}
      data-testid="comment-item"
    >
      <PersonAvatar userId={comment.authorId} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-fg-muted">
          <span className="text-sm font-semibold text-fg">
            {author?.name ?? (comment.authorId ? 'Former member' : 'Automation')}
          </span>
          <LocalTime iso={comment.createdAt} />
          {comment.editedAt ? (
            <LocalTime iso={comment.editedAt} className="italic">
              (edited)
            </LocalTime>
          ) : null}
        </p>
        {editing ? (
          <div className="mt-1.5">
            <CommentComposer
              initialBody={comment.body}
              submitLabel="Save"
              autoFocus
              onSubmit={(body) => save(body)}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <>
            <MarkdownView source={comment.body} meId={user.id} className="mt-0.5 text-sm" />
            <CommentFiles files={comment.attachments} />
          </>
        )}
        {reactions.length && !editing ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {reactions.map(([emoji, users]) => {
              const reacted = users.includes(user.id);
              const names = users
                .map((id) => (id === user.id ? 'You' : (people.get(id)?.name ?? 'Someone')))
                .join(', ');
              return (
                <Tooltip key={emoji} content={`${names} reacted with ${emoji}`}>
                  <button
                    type="button"
                    onClick={() => canComment && void react(emoji)}
                    disabled={!canComment}
                    aria-pressed={reacted}
                    aria-label={`${emoji} ${users.length}. ${reacted ? 'Remove your reaction' : 'React too'}`}
                    className={cn(
                      'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-focus',
                      reacted
                        ? 'border-primary bg-primary-subtle font-semibold text-primary-text'
                        : 'border-border-subtle bg-panel text-fg-secondary hover:border-border-strong',
                    )}
                  >
                    <span aria-hidden>{emoji}</span>
                    {users.length}
                  </button>
                </Tooltip>
              );
            })}
            {canComment ? (
              <ReactionPicker onPick={(emoji) => void react(emoji)}>
                <button
                  type="button"
                  aria-label="Add a reaction"
                  className="inline-flex h-6 items-center rounded-full border border-dashed border-border-default px-1.5 text-icon hover:border-border-strong hover:text-icon-strong"
                >
                  <SmilePlus aria-hidden className="size-3.5" />
                </button>
              </ReactionPicker>
            ) : null}
          </div>
        ) : null}
      </div>
      {!editing ? (
        <div className="absolute -top-2 right-1 flex items-center gap-0.5 rounded-md border border-border-subtle bg-raised p-0.5 opacity-0 shadow-sm transition-opacity group-focus-within/comment:opacity-100 group-hover/comment:opacity-100 has-[[data-state=open]]:opacity-100">
          {canComment ? (
            <ReactionPicker onPick={(emoji) => void react(emoji)}>
              <IconButton size="sm" label="Add a reaction" icon={<SmilePlus aria-hidden />} />
            </ReactionPicker>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" label="More for this comment" icon={<MoreHorizontal aria-hidden />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem icon={<Link2 aria-hidden />} onSelect={() => void copyLink()}>
                Copy link
              </DropdownMenuItem>
              {mine && canComment ? (
                <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => setEditing(true)}>
                  Edit
                </DropdownMenuItem>
              ) : null}
              {(mine && canComment) || canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    icon={<Trash2 aria-hidden />}
                    variant="danger"
                    onSelect={() => void remove()}
                  >
                    Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </li>
  );
}
