'use client';

/**
 * One update thread: author, relative time, pinned / edited markers, sanitized body,
 * attachments, reactions (Like + any emoji), Reply (threaded, inline editor), "Seen by N"
 * and a "…" menu (Edit, Pin, Copy link, Delete with Undo).
 */
import { useRef, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SmilePlus,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import type { FileDto, ReactionDto, UpdateDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { formatBytes, formatRelativeShort, pluralize } from '../lib/format';
import { isDocEmpty, type RichDoc } from '../lib/rich-text';
import { useUpdateReaders } from '../hooks/use-panel-queries';
import { FileKindIcon, RelativeTime } from '../parts/common';
import { EmojiPicker } from './emoji-picker';
import { RichTextView } from './rich-text-view';
import { UpdateEditor, type UpdateEditorHandle } from './update-editor';

export interface ThreadContext {
  readonly me: UserSummaryDto | null;
  readonly users: readonly UserSummaryDto[];
  readonly usersById: ReadonlyMap<string, UserSummaryDto>;
  readonly canWrite: boolean;
  readonly canModerate: boolean;
  readonly now: Date;
  readonly hidden: ReadonlySet<string>;
  readonly fresh: ReadonlySet<string>;
  readonly onReact: (update: UpdateDto, emoji: string) => void;
  readonly onEdit: (update: UpdateDto, body: RichDoc) => Promise<unknown>;
  readonly onPin: (update: UpdateDto) => void;
  readonly onDelete: (update: UpdateDto) => void;
  readonly onReply: (thread: UpdateDto, body: RichDoc) => Promise<unknown>;
  readonly onCopyLink: (update: UpdateDto) => void;
  readonly onOpenFile: (files: readonly FileDto[], index: number) => void;
}

const LIKE = '👍';

function reactorNames(reaction: ReactionDto, ctx: ThreadContext): string {
  const names = reaction.userIds.map((id) => (id === ctx.me?.id ? 'You' : (ctx.usersById.get(id)?.name ?? 'Someone')));
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : names.join(', ');
}

function SeenBy({ update, now }: { readonly update: UpdateDto; readonly now: Date }) {
  const [open, setOpen] = useState(false);
  const readers = useUpdateReaders(update.id, open && !update.id.startsWith('temp-'));
  if (update.readCount === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-sm px-1.5 text-xs text-fg-muted transition-colors hover:bg-hover hover:text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-hover"
        >
          <Eye aria-hidden className="size-3.5" />
          Seen by {update.readCount}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5" aria-label="Seen by">
        <p className="px-2 pt-1 pb-1.5 text-xs font-semibold text-fg-muted">Seen by {pluralize(update.readCount, 'person', 'people')}</p>
        {readers.isLoading ? (
          <div role="status" aria-busy="true" aria-label="Loading readers" className="flex flex-col gap-1 p-1">
            {Array.from({ length: Math.min(5, Math.max(1, update.readCount)) }, (_, key) => (
              <div key={key} className="flex items-center gap-2 px-1 py-1">
                <Skeleton width={24} height={24} rounded="full" />
                <Skeleton width="60%" height={10} rounded="full" />
              </div>
            ))}
          </div>
        ) : readers.isError ? (
          <p className="px-2 py-2 text-sm text-danger-text">Couldn’t load readers.</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto">
            {(readers.data ?? []).map((reader) => (
              <li key={reader.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5">
                <Avatar name={reader.name} src={reader.image} colorKey={reader.id} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{reader.name}</span>
                <span className="text-xs text-fg-muted">{formatRelativeShort(reader.readAt, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Attachments({ files, ctx }: { readonly files: readonly FileDto[]; readonly ctx: ThreadContext }) {
  if (files.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attachments">
      {files.map((file, index) => (
        <li key={file.id}>
          <button
            type="button"
            onClick={() => ctx.onOpenFile(files, index)}
            className="group flex max-w-[240px] items-center gap-2 rounded-md border border-border-subtle bg-panel p-1.5 pr-3 text-left transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)] ease-out hover:border-border-default hover:bg-hover hover:shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {file.mime.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element -- authenticated file URL
              <img src={file.url} alt="" className="size-9 rounded-sm object-cover" loading="lazy" />
            ) : (
              <FileKindIcon mime={file.mime} name={file.name} size={36} />
            )}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-fg">{file.name}</span>
              <span className="text-xs text-fg-muted">{formatBytes(file.size)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Reactions({ update, ctx, compact }: { readonly update: UpdateDto; readonly ctx: ThreadContext; readonly compact?: boolean }) {
  const pending = update.id.startsWith('temp-');
  const like = update.reactions.find((reaction) => reaction.emoji === LIKE);
  const others = update.reactions.filter((reaction) => reaction.emoji !== LIKE);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        pressed={like?.reactedByMe ?? false}
        aria-pressed={like?.reactedByMe ?? false}
        leadingIcon={<ThumbsUp aria-hidden className={cn(like?.reactedByMe && 'fill-current')} />}
        onClick={() => ctx.onReact(update, LIKE)}
        className={cn('text-fg-secondary', like?.reactedByMe && 'text-primary-text')}
        data-testid="like-update"
      >
        {compact ? null : 'Like'}
        {like ? <span className="tabular-nums">{like.count}</span> : null}
      </Button>
      {others.map((reaction) => (
        <Tooltip key={reaction.emoji} content={`${reactorNames(reaction, ctx)} reacted ${reaction.emoji}`} side="top">
          <button
            type="button"
            aria-pressed={reaction.reactedByMe}
            aria-label={`${reaction.emoji} ${reaction.count}${reaction.reactedByMe ? ', you reacted' : ''}`}
            disabled={pending}
            onClick={() => ctx.onReact(update, reaction.emoji)}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold tabular-nums transition-[background-color,border-color,transform] duration-[var(--duration-instant)] ease-out active:scale-95',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-[0.38]',
              reaction.reactedByMe
                ? 'border-primary bg-primary-subtle text-primary-text hover:bg-primary-selected'
                : 'border-border-subtle bg-panel text-fg-secondary hover:border-border-default hover:bg-hover',
            )}
          >
            <span aria-hidden>{reaction.emoji}</span>
            {reaction.count}
          </button>
        </Tooltip>
      ))}
      <EmojiPicker onPick={(emoji) => ctx.onReact(update, emoji)} label="Add reaction">
        <IconButton size="sm" label="Add reaction" icon={<SmilePlus aria-hidden />} tooltipSide="top" disabled={pending} />
      </EmojiPicker>
    </div>
  );
}

function UpdateBody({
  update,
  ctx,
  isReply,
  onReplyClick,
}: {
  readonly update: UpdateDto;
  readonly ctx: ThreadContext;
  readonly isReply?: boolean;
  readonly onReplyClick?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<UpdateEditorHandle>(null);
  const author = update.author;
  const mine = Boolean(ctx.me && author?.id === ctx.me.id);
  const pending = update.id.startsWith('temp-');
  const canEdit = mine && ctx.canWrite && !pending;
  const canDelete = (mine || ctx.canModerate) && ctx.canWrite && !pending;

  const save = async () => {
    const doc = editorRef.current?.getDoc();
    if (!doc || isDocEmpty(doc)) return;
    setSaving(true);
    try {
      await ctx.onEdit(update, doc);
      setEditing(false);
    } catch {
      // toast shown by the mutation; keep the editor open with the text
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn('flex gap-3', isReply && 'gap-2.5')}>
      <Avatar name={author?.name ?? 'Deleted user'} src={author?.image} colorKey={author?.id} size={isReply ? 'sm' : 'md'} />
      <div className="min-w-0 flex-1">
        <div className="flex min-h-7 items-center gap-2">
          <span className="truncate text-base font-semibold text-fg">{author?.name ?? 'Deleted user'}</span>
          {update.pinned && !isReply ? (
            <Badge tone="primary" size="sm" icon={<Pin aria-hidden />}>
              Pinned
            </Badge>
          ) : null}
          <RelativeTime iso={update.createdAt} now={ctx.now} />
          {update.editedAt ? (
            <Tooltip content={`Edited ${formatRelativeShort(update.editedAt, ctx.now).toLowerCase()}`} side="top">
              <span tabIndex={0} className="rounded-xs text-xs text-fg-muted italic outline-none focus-visible:outline-2 focus-visible:outline-focus">
                (edited)
              </span>
            </Tooltip>
          ) : null}
          {pending ? <span className="text-xs text-fg-muted">Posting…</span> : null}
          <div className="ml-auto flex items-center" data-print-hide>
            {!pending ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton size="sm" label={isReply ? 'Reply actions' : 'Update actions'} icon={<MoreHorizontal aria-hidden />} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit ? (
                    <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => setEditing(true)}>
                      Edit
                    </DropdownMenuItem>
                  ) : null}
                  {!isReply && ctx.canWrite ? (
                    <DropdownMenuItem icon={update.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />} onSelect={() => ctx.onPin(update)}>
                      {update.pinned ? 'Unpin' : 'Pin to top'}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem icon={<Copy aria-hidden />} onSelect={() => ctx.onCopyLink(update)}>
                    Copy link
                  </DropdownMenuItem>
                  {canDelete ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="danger" icon={<Trash2 aria-hidden />} onSelect={() => ctx.onDelete(update)}>
                        Delete
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        {editing ? (
          <div className="mt-1">
            <UpdateEditor
              ref={editorRef}
              label="Edit update"
              users={ctx.users}
              placeholder="Edit your update"
              initialContent={update.body as RichDoc}
              autoFocus
              minHeight={56}
              onSubmit={() => void save()}
              onEscape={() => {
                setEditing(false);
                return true;
              }}
              actions={
                <>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" loading={saving} leadingIcon={<Check aria-hidden />} onClick={() => void save()}>
                    Save
                  </Button>
                </>
              }
            />
          </div>
        ) : (
          <RichTextView doc={update.body as RichDoc} meId={ctx.me?.id ?? null} className={cn(pending && 'opacity-70')} />
        )}
        <Attachments files={update.files} ctx={ctx} />
        <div className="-ml-2 mt-1.5 flex flex-wrap items-center gap-1" data-print-hide>
          <Reactions update={update} ctx={ctx} compact={isReply} />
          {onReplyClick && ctx.canWrite ? (
            <Button variant="ghost" size="sm" leadingIcon={<MessageSquare aria-hidden />} onClick={onReplyClick} disabled={pending} className="text-fg-secondary">
              Reply
            </Button>
          ) : null}
          <div className="ml-auto">
            <SeenBy update={update} now={ctx.now} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function UpdateThread({ thread, ctx }: { readonly thread: UpdateDto; readonly ctx: ThreadContext }) {
  const [replying, setReplying] = useState(false);
  const [sending, setSending] = useState(false);
  const replyRef = useRef<UpdateEditorHandle>(null);
  const replies = thread.replies.filter((reply) => !ctx.hidden.has(reply.id));

  const sendReply = async () => {
    const doc = replyRef.current?.getDoc();
    if (!doc || isDocEmpty(doc)) return;
    setSending(true);
    replyRef.current?.clear();
    try {
      await ctx.onReply(thread, doc);
    } catch {
      replyRef.current?.editor?.commands.setContent(doc as never);
    } finally {
      setSending(false);
    }
  };

  const openReply = () => {
    setReplying(true);
    requestAnimationFrame(() => replyRef.current?.focus());
  };

  return (
    <article
      id={`update-${thread.id}`}
      data-testid="update-card"
      data-update-id={thread.id}
      aria-label={`Update from ${thread.author?.name ?? 'a deleted user'}`}
      className={cn(
        'rounded-lg border bg-panel p-4 shadow-xs transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-out hover:shadow-sm',
        thread.pinned ? 'border-primary-selected' : 'border-border-subtle',
        ctx.fresh.has(thread.id) && 'ks-update-fresh',
      )}
    >
      <UpdateBody update={thread} ctx={ctx} onReplyClick={openReply} />
      {replies.length > 0 || replying ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-border-subtle pt-3 pl-2 sm:pl-[52px]">
          {replies.map((reply) => (
            <div key={reply.id} id={`update-${reply.id}`} data-testid="update-reply" className={cn('rounded-md', ctx.fresh.has(reply.id) && 'ks-update-fresh')}>
              <UpdateBody update={reply} ctx={ctx} isReply />
            </div>
          ))}
          {replying && ctx.canWrite ? (
            <div className="flex gap-2.5">
              {ctx.me ? <Avatar name={ctx.me.name} src={ctx.me.image} colorKey={ctx.me.id} size="sm" /> : null}
              <div className="min-w-0 flex-1">
                <UpdateEditor
                  ref={replyRef}
                  testId="reply-editor"
                  label="Write a reply"
                  users={ctx.users}
                  placeholder="Write a reply…"
                  autoFocus
                  minHeight={44}
                  onSubmit={() => void sendReply()}
                  onEscape={() => {
                    if (replyRef.current?.isEmpty()) {
                      setReplying(false);
                      return true;
                    }
                    return false;
                  }}
                  actions={
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setReplying(false)}>
                        Cancel
                      </Button>
                      <Button size="sm" loading={sending} onClick={() => void sendReply()} data-testid="send-reply">
                        Reply
                      </Button>
                    </>
                  }
                />
              </div>
            </div>
          ) : ctx.canWrite ? (
            <button
              type="button"
              onClick={openReply}
              className="flex h-9 items-center rounded-md border border-border-input bg-panel px-3 text-left text-sm text-fg-placeholder transition-[border-color,background-color] hover:border-border-input-hover hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              Write a reply…
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function copyToClipboard(text: string, success: string): void {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => toast.success(success))
    .catch(() => toast.error('Couldn’t copy the link', 'Your browser blocked clipboard access.'));
}
