'use client';
/** One Inbox thread card: author, breadcrumb, body with Show more, Like, inline Reply, read state. */
import Link from 'next/link';
import { memo, useId, useRef, useState } from 'react';
import { AtSign, Check, ChevronRight, MessageSquare, ThumbsUp, Undo2 } from 'lucide-react';
import { Avatar, Badge, Button, IconButton, Tooltip, cn } from '@/components/ui';
import { UpdateEditor, type UpdateEditorHandle } from '@/features/item-panel/updates/update-editor';
import { docText, type RichDoc } from '@/features/item-panel/lib/rich-text';
import { formatFullTime, formatShortTime } from '@/features/notifications/describe';
import type { UpdateDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { InboxThreadDto } from '@/server/services/contracts/inbox-mywork';
import { LIKE_EMOJI } from './api';
import { collapseText, isUnreadForMe, needsCollapse, splitMentions } from './inbox-model';

const VISIBLE_REPLIES = 2;

function UpdateText({
  text,
  names,
  expanded,
}: {
  readonly text: string;
  readonly names: readonly string[];
  readonly expanded: boolean;
}) {
  const shown = expanded ? text : collapseText(text);
  return (
    <p className="text-base leading-[22px] whitespace-pre-line text-fg [overflow-wrap:anywhere]">
      {splitMentions(shown, names).map((part, index) =>
        part.mention ? (
          <span key={index} className="rounded-xs bg-info-subtle px-0.5 font-medium text-info-text">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

function likeOf(update: UpdateDto) {
  return update.reactions.find((reaction) => reaction.emoji === LIKE_EMOJI);
}

function LikeButton({
  update,
  onLike,
  compact,
}: {
  readonly update: UpdateDto;
  readonly onLike: () => void;
  readonly compact?: boolean;
}) {
  const like = likeOf(update);
  const pending = update.id.startsWith('temp-');
  return (
    <Button
      variant="ghost"
      size={compact ? 'xs' : 'sm'}
      pressed={like?.reactedByMe ?? false}
      disabled={pending}
      leadingIcon={<ThumbsUp aria-hidden className={cn(like?.reactedByMe && 'fill-current')} />}
      onClick={onLike}
      aria-label={like?.reactedByMe ? 'Unlike' : 'Like'}
      data-testid="inbox-like"
    >
      {compact ? (like?.count ? like.count : null) : `Like${like?.count ? ` · ${like.count}` : ''}`}
    </Button>
  );
}

/** Unread marker, always in the left gutter (same place for an update and for its replies). */
function UnreadDot({ className, label }: { readonly className: string; readonly label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      data-testid="inbox-unread-dot"
      className={cn('absolute size-2 rounded-full bg-info', className)}
    />
  );
}

function Reply({
  reply,
  names,
  now,
  meId,
  onLike,
}: {
  readonly reply: UpdateDto;
  readonly names: readonly string[];
  readonly now: Date;
  readonly meId: string;
  readonly onLike: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = needsCollapse(reply.bodyText);
  const unread = isUnreadForMe(reply, meId);
  return (
    <li className={cn('relative flex gap-2.5', reply.id.startsWith('temp-') && 'opacity-70')}>
      {unread ? <UnreadDot label="Unread reply" className="top-3 -left-3.5" /> : null}
      <Avatar
        name={reply.author?.name ?? 'Former member'}
        src={reply.author?.image ?? null}
        size="sm"
        colorKey={reply.author?.id}
      />
      <div className="min-w-0 flex-1 rounded-lg bg-muted px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className={cn('truncate text-sm text-fg', unread ? 'font-bold' : 'font-semibold')}>
            {reply.author?.name ?? 'Former member'}
          </span>
          <time
            dateTime={reply.createdAt}
            title={formatFullTime(reply.createdAt)}
            className="shrink-0 text-xs text-fg-muted"
          >
            {reply.id.startsWith('temp-') ? 'Sending…' : formatShortTime(reply.createdAt, now)}
          </time>
          <span className="ml-auto -my-1 -mr-1.5">
            <LikeButton update={reply} onLike={onLike} compact />
          </span>
        </div>
        <UpdateText text={reply.bodyText} names={names} expanded={expanded} />
        {long ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="mt-1 rounded-xs text-sm font-medium text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export interface InboxCardProps {
  readonly thread: InboxThreadDto;
  readonly orgSlug: string;
  readonly me: UserSummaryDto;
  readonly names: readonly string[];
  /** Mention candidates for the reply composer. */
  readonly users: readonly UserSummaryDto[];
  readonly now: Date;
  readonly onToggleRead: (thread: InboxThreadDto) => void;
  readonly onLike: (thread: InboxThreadDto, update: UpdateDto) => void;
  readonly onReply: (thread: InboxThreadDto, body: RichDoc, text: string) => Promise<void>;
}

export const InboxCard = memo(function InboxCard({
  thread,
  orgSlug,
  me,
  names,
  users,
  now,
  onToggleRead,
  onLike,
  onReply,
}: InboxCardProps) {
  const { update } = thread;
  const [expanded, setExpanded] = useState(false);
  const [showAllReplies, setShowAllReplies] = useState(false);
  const [replying, setReplying] = useState(false);
  const [empty, setEmpty] = useState(true);
  const [sending, setSending] = useState(false);
  const composerRef = useRef<UpdateEditorHandle>(null);
  const composerId = useId();
  const long = needsCollapse(update.bodyText);
  const replies = update.replies;
  const hiddenReplies = showAllReplies ? 0 : Math.max(0, replies.length - VISIBLE_REPLIES);
  const visibleReplies = replies.slice(hiddenReplies);
  const itemHref = `/${orgSlug}/boards/${thread.boardId}?item=${thread.itemId}&update=${update.id}`;
  const author = update.author?.name ?? 'Former member';
  const updateUnread = isUnreadForMe(update, me.id);
  const newReplies = replies.filter((reply) => isUnreadForMe(reply, me.id)).length;

  const openComposer = () => {
    setReplying(true);
    requestAnimationFrame(() => composerRef.current?.focus());
  };
  const send = async () => {
    const editor = composerRef.current;
    if (!editor || editor.isEmpty() || sending) return;
    const body = editor.getDoc();
    setSending(true);
    try {
      await onReply(thread, body, docText(body));
      editor.clear();
      setEmpty(true);
      setReplying(false);
    } catch {
      /* error toast shown by the mutation; keep the draft for retry */
    } finally {
      setSending(false);
    }
  };

  return (
    <article
      data-testid="inbox-card"
      data-update-id={update.id}
      data-unread={thread.unread || undefined}
      aria-labelledby={`${composerId}-title`}
      className={cn(
        'relative overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xs transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-out hover:border-border-default hover:shadow-sm',
      )}
    >
      {updateUnread ? <UnreadDot label="Unread update" className="top-[30px] left-2" /> : null}
      <header className="flex items-start gap-3 px-5 pt-4">
        <Avatar name={author} src={update.author?.image ?? null} size="md" colorKey={update.author?.id} />
        <div className="min-w-0 flex-1">
          <div id={`${composerId}-title`} className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn('text-fg', updateUnread ? 'font-semibold' : 'font-medium')}>{author}</span>
            <time
              dateTime={update.createdAt}
              title={formatFullTime(update.createdAt)}
              className="text-sm text-fg-muted"
            >
              {formatShortTime(update.createdAt, now)}
            </time>
            {thread.mentionsMe ? (
              <Badge tone="info" icon={<AtSign aria-hidden />}>
                Mentioned you
              </Badge>
            ) : null}
          </div>
          <nav
            aria-label="Item location"
            className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-fg-muted"
          >
            <Link
              href={`/${orgSlug}/boards/${thread.boardId}`}
              className="max-w-[45%] shrink-0 truncate rounded-xs hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              {thread.boardName}
            </Link>
            {thread.groupTitle ? (
              <>
                <ChevronRight aria-hidden className="size-3 shrink-0" />
                <span className="hidden truncate sm:inline">{thread.groupTitle}</span>
                <ChevronRight aria-hidden className="hidden size-3 shrink-0 sm:inline" />
              </>
            ) : (
              <ChevronRight aria-hidden className="size-3 shrink-0" />
            )}
            <Link
              href={itemHref}
              className="truncate rounded-xs font-medium text-fg-secondary hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              {thread.itemName}
            </Link>
          </nav>
        </div>
        <Tooltip content={thread.unread ? 'Mark as read' : 'Mark as unread'}>
          <IconButton
            label={thread.unread ? 'Mark as read' : 'Mark as unread'}
            hideTooltip
            icon={thread.unread ? <Check aria-hidden /> : <Undo2 aria-hidden />}
            variant={thread.unread ? 'outline' : 'ghost'}
            round
            onClick={() => onToggleRead(thread)}
            data-testid="inbox-toggle-read"
          />
        </Tooltip>
      </header>

      <div className="px-5 pt-3 sm:pl-[64px]">
        <UpdateText text={update.bodyText} names={names} expanded={expanded} />
        {long ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="mt-1 rounded-xs text-sm font-medium text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            data-testid="inbox-show-more"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-1 px-4 pt-2 pb-2 sm:pl-[60px]">
        <LikeButton update={update} onLike={() => onLike(thread, update)} />
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<MessageSquare aria-hidden />}
          onClick={openComposer}
          aria-expanded={replying}
          aria-controls={`${composerId}-composer`}
          data-testid="inbox-reply"
        >
          Reply{replies.length ? ` · ${replies.length}` : ''}
          {newReplies > 0 ? (
            <span className="font-semibold text-fg" data-testid="inbox-new-replies">
              {`(${newReplies} new)`}
            </span>
          ) : null}
        </Button>
      </div>

      {replies.length > 0 || replying ? (
        <div className="flex flex-col gap-2 border-t border-border-subtle bg-sunken/40 px-5 py-3 sm:pl-[64px]">
          {hiddenReplies > 0 ? (
            <button
              type="button"
              onClick={() => setShowAllReplies(true)}
              className="self-start rounded-xs text-sm font-medium text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              Show {hiddenReplies} earlier {hiddenReplies === 1 ? 'reply' : 'replies'}
            </button>
          ) : null}
          {visibleReplies.length ? (
            <ul className="flex flex-col gap-2">
              {visibleReplies.map((reply) => (
                <Reply
                  key={reply.id}
                  reply={reply}
                  names={names}
                  now={now}
                  meId={me.id}
                  onLike={() => onLike(thread, reply)}
                />
              ))}
            </ul>
          ) : null}
          {replying ? (
            <div id={`${composerId}-composer`} className="flex gap-2.5 animate-fade-in">
              <Avatar name={me.name} src={me.image} size="sm" colorKey={me.id} />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <UpdateEditor
                  ref={composerRef}
                  testId="inbox-reply-input"
                  label={`Reply to ${author}`}
                  users={users}
                  placeholder={`Reply to ${author}, mention others with @`}
                  autoFocus
                  minHeight={52}
                  disabled={sending}
                  onChange={(_doc, isEmpty) => setEmpty(isEmpty)}
                  onSubmit={() => void send()}
                  onEscape={() => {
                    if (!composerRef.current?.isEmpty()) return false;
                    setReplying(false);
                    return true;
                  }}
                  actions={
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setReplying(false)} disabled={sending}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={empty}
                        loading={sending}
                        onClick={() => void send()}
                        data-testid="inbox-reply-send"
                      >
                        Reply
                      </Button>
                    </>
                  }
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={openComposer}
              className="flex h-8 items-center gap-2.5 rounded-md text-left text-sm text-fg-placeholder hover:text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Avatar name={me.name} src={me.image} size="sm" colorKey={me.id} />
              <span className="flex h-8 flex-1 items-center rounded-full border border-border-input bg-panel px-3 hover:border-border-input-hover">
                Write a reply…
              </span>
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
});
