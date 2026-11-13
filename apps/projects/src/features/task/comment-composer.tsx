'use client';
/**
 * Comment box: markdown with a small formatting bar, @mention autocomplete (type @ and a name;
 * arrows + Enter pick), file attach / paste, ⌘/Ctrl+Enter to send, Esc to cancel an edit.
 * New-comment drafts are kept per task in this browser until sent.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { AtSign, Bold, Code, Italic, Link2, List, ListChecks, Paperclip, Send, X } from 'lucide-react';
import {
  Avatar,
  Button,
  IconButton,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Spinner,
  cn,
  useModKey,
} from '@/components/ui';
import { safeHref } from './markdown';
import { usePeople } from '@/lib/hooks/use-data';
import type { AttachmentDTO } from '@/lib/types';
import { deleteAttachmentAction } from '@/server/actions/attachments';
import {
  decodeMentions,
  encodeMentions,
  insertLink,
  mentionQueryAt,
  prefixLines,
  rankPeople,
  wrapSelection,
  type PendingMention,
  type TextEdit,
} from './task-utils';
import type { useTaskUploads } from './use-task-uploads';
import { isImageType } from './task-utils';

export interface ComposerHandle {
  focus: () => void;
  /** Insert text at the caret (e.g. "@Maya " from a reply). */
  insert: (text: string, mention?: PendingMention) => void;
}

export interface CommentComposerProps {
  /** Existing body (edit mode) with mention tokens. */
  readonly initialBody?: string;
  readonly draftKey?: string;
  readonly placeholder?: string;
  readonly submitLabel: string;
  readonly onSubmit: (body: string, attachmentIds: string[]) => Promise<boolean>;
  readonly onCancel?: () => void;
  readonly uploads?: ReturnType<typeof useTaskUploads>;
  readonly autoFocus?: boolean;
  readonly compact?: boolean;
}

function readDraft(key: string | undefined): { text: string; mentions: PendingMention[] } | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { text: string; mentions: PendingMention[] }) : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string | undefined, text: string, mentions: readonly PendingMention[]) {
  if (!key) return;
  try {
    if (text.trim()) window.localStorage.setItem(key, JSON.stringify({ text, mentions }));
    else window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode): drafts simply aren't kept.
  }
}

export const CommentComposer = forwardRef<ComposerHandle, CommentComposerProps>(function CommentComposer(
  {
    initialBody,
    draftKey,
    placeholder = 'Write a comment… Type @ to mention someone',
    submitLabel,
    onSubmit,
    onCancel,
    uploads,
    autoFocus,
    compact,
  },
  ref,
) {
  const mod = useModKey();
  const people = usePeople();
  const initial = useMemo(
    () => (initialBody ? decodeMentions(initialBody) : { text: '', mentions: [] as PendingMention[] }),
    [initialBody],
  );
  const [text, setText] = useState(initial.text);
  const [mentions, setMentions] = useState<PendingMention[]>(initial.mentions);
  const [files, setFiles] = useState<AttachmentDTO[]>([]);
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [popup, setPopup] = useState<{ query: string; start: number; index: number } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Restore a saved draft after mount (localStorage is browser-only, so not during SSR).
  useEffect(() => {
    const draft = readDraft(draftKey);
    if (draft && !initialBody) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(draft.text);
      setMentions(draft.mentions);
    }
  }, [draftKey, initialBody]);

  const candidates = useMemo(
    () => (popup ? rankPeople(people.data ?? [], popup.query, 6) : []),
    [people.data, popup],
  );

  const apply = (edit: TextEdit) => {
    setText(edit.text);
    writeDraft(draftKey, edit.text, mentions);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  };

  const insertAtCaret = (snippet: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    apply({
      text: text.slice(0, start) + snippet + text.slice(end),
      selectionStart: start + snippet.length,
      selectionEnd: start + snippet.length,
    });
  };

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    insert: (snippet, mention) => {
      if (mention) setMentions((list) => [...list, mention]);
      insertAtCaret(snippet);
    },
  }));

  const updatePopup = (value: string, caret: number) => {
    const found = mentionQueryAt(value, caret);
    setPopup(found ? { query: found.query, start: found.start, index: 0 } : null);
  };

  const pickMention = (person: { id: string; name: string }) => {
    if (!popup) return;
    const el = area.current;
    const caret = el?.selectionStart ?? text.length;
    const snippet = `@${person.name} `;
    const next = text.slice(0, popup.start) + snippet + text.slice(caret);
    const nextMentions = [...mentions, { name: person.name, id: person.id }];
    setMentions(nextMentions);
    setPopup(null);
    setText(next);
    writeDraft(draftKey, next, nextMentions);
    requestAnimationFrame(() => {
      el?.focus();
      const at = popup.start + snippet.length;
      el?.setSelectionRange(at, at);
    });
  };

  const addFiles = async (picked: readonly File[]) => {
    if (!uploads || picked.length === 0) return;
    const uploaded = await uploads.upload(picked);
    setFiles((list) => [...list, ...uploaded]);
  };

  const removeFile = (file: AttachmentDTO) => {
    setFiles((list) => list.filter((entry) => entry.id !== file.id));
    void deleteAttachmentAction({ attachmentId: file.id });
  };

  const submit = async () => {
    const body = encodeMentions(text.trim(), mentions);
    if ((!body && files.length === 0) || sending) return;
    setSending(true);
    const ok = await onSubmit(
      body || 'Attached files',
      files.map((file) => file.id),
    );
    setSending(false);
    if (ok) {
      setText('');
      setMentions([]);
      setFiles([]);
      writeDraft(draftKey, '', []);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (popup && candidates.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setPopup({ ...popup, index: (popup.index + delta + candidates.length) % candidates.length });
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pickMention(candidates[popup.index]);
        return;
      }
    }
    if (event.key === 'Escape') {
      if (popup) {
        event.preventDefault();
        event.stopPropagation();
        setPopup(null);
        return;
      }
      if (onCancel) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (text) {
        event.stopPropagation();
        event.currentTarget.blur();
      }
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
      return;
    }
    const el = event.currentTarget;
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i') {
        event.preventDefault();
        apply(wrapSelection(text, el.selectionStart, el.selectionEnd, key === 'b' ? '**' : '_'));
      }
    }
  };

  /** Apply a markdown edit to the current selection (event handlers only). */
  const format = (edit: (start: number, end: number) => TextEdit) => {
    const el = area.current;
    apply(edit(el?.selectionStart ?? text.length, el?.selectionEnd ?? text.length));
  };
  const expanded = focused || Boolean(text) || files.length > 0 || Boolean(onCancel) || !compact;
  const canSend = Boolean(text.trim()) || files.length > 0;

  return (
    <div
      className={cn(
        'relative rounded-lg border border-border-input bg-panel transition-[border-color,box-shadow] duration-[var(--duration-fast)]',
        'focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--focus-ring-soft)] hover:border-border-input-hover focus-within:hover:border-primary',
      )}
      onDragOver={(event) => {
        if (uploads && event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!uploads || !event.dataTransfer.files.length) return;
        event.preventDefault();
        event.stopPropagation();
        void addFiles([...event.dataTransfer.files]);
      }}
    >
      <textarea
        ref={area}
        autoFocus={autoFocus}
        value={text}
        rows={expanded ? 3 : 1}
        placeholder={placeholder}
        aria-label={onCancel ? 'Edit comment' : 'Write a comment'}
        data-testid={onCancel ? 'comment-edit-input' : 'comment-input'}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setTimeout(() => setPopup(null), 120);
        }}
        onChange={(event) => {
          setText(event.target.value);
          writeDraft(draftKey, event.target.value, mentions);
          updatePopup(event.target.value, event.target.selectionStart);
        }}
        onSelect={(event) => updatePopup(event.currentTarget.value, event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const pasted = [...(event.clipboardData?.files ?? [])];
          if (pasted.length && uploads) {
            event.preventDefault();
            void addFiles(pasted);
          }
        }}
        className="block max-h-72 min-h-10 w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed text-fg outline-none [field-sizing:content] placeholder:text-fg-placeholder"
      />
      {files.length || uploads?.queue.length ? (
        <ul className="flex flex-wrap gap-1.5 px-3 pb-2" aria-label="Attached files">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex h-7 max-w-56 items-center gap-1.5 rounded-md border border-border-subtle bg-sunken pr-0.5 pl-1.5 text-xs text-fg"
            >
              {isImageType(file.contentType) ? (
                // eslint-disable-next-line @next/next/no-img-element -- private file route
                <img src={file.url} alt="" className="size-5 rounded-xs object-cover" />
              ) : (
                <Paperclip aria-hidden className="size-3.5 text-icon" />
              )}
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(file)}
                aria-label={`Remove ${file.name}`}
                className="inline-flex size-5 items-center justify-center rounded-xs text-icon hover:bg-hover hover:text-icon-strong"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
          {uploads?.queue.map((item) => (
            <li
              key={item.id}
              className="flex h-7 max-w-56 items-center gap-1.5 rounded-md border border-border-subtle bg-sunken px-1.5 text-xs text-fg-muted"
            >
              <Spinner size="xs" label={null} />
              <span className="truncate">{item.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {expanded ? (
        <div className="flex flex-wrap items-center gap-0.5 border-t border-border-subtle px-1.5 py-1">
          <ToolButton
            label="Bold"
            icon={<Bold aria-hidden />}
            shortcut={[mod, 'B']}
            onClick={() => format((start, end) => wrapSelection(text, start, end, '**'))}
          />
          <ToolButton
            label="Italic"
            icon={<Italic aria-hidden />}
            shortcut={[mod, 'I']}
            onClick={() => format((start, end) => wrapSelection(text, start, end, '_'))}
          />
          <ToolButton
            label="Code"
            icon={<Code aria-hidden />}
            onClick={() => format((start, end) => wrapSelection(text, start, end, '`', 'code'))}
          />
          <ToolButton
            label="Bulleted list"
            icon={<List aria-hidden />}
            onClick={() => format((start, end) => prefixLines(text, start, end, () => '- '))}
          />
          <ToolButton
            label="Checklist"
            icon={<ListChecks aria-hidden />}
            onClick={() => format((start, end) => prefixLines(text, start, end, () => '- [ ] '))}
          />
          <LinkButton
            textarea={area}
            onApply={(range, href) => apply(insertLink(text, range.start, range.end, href))}
          />
          <ToolButton
            label="Mention someone"
            icon={<AtSign aria-hidden />}
            onClick={() => {
              const start = area.current?.selectionStart ?? text.length;
              const lead = start > 0 && !/\s/.test(text[start - 1] ?? '') ? ' @' : '@';
              const next = text.slice(0, start) + lead + text.slice(start);
              const caret = start + lead.length;
              setText(next);
              setPopup({ query: '', start: caret - 1, index: 0 });
              requestAnimationFrame(() => {
                area.current?.focus();
                area.current?.setSelectionRange(caret, caret);
              });
            }}
          />
          {uploads ? (
            <>
              <ToolButton
                label="Attach files"
                icon={<Paperclip aria-hidden />}
                onClick={() => fileInput.current?.click()}
              />
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                aria-hidden
                tabIndex={-1}
                onChange={(event) => {
                  const picked = [...(event.target.files ?? [])];
                  event.target.value = '';
                  void addFiles(picked);
                }}
              />
            </>
          ) : null}
          <span className="ml-auto hidden pr-1 text-2xs text-fg-muted sm:inline">{mod}+Enter to send</span>
          <div className="flex items-center gap-1.5 pl-1">
            {onCancel ? (
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => void submit()}
              loading={sending}
              disabled={!canSend || Boolean(uploads?.queue.length)}
              leadingIcon={onCancel ? undefined : <Send aria-hidden />}
              data-testid="comment-submit"
            >
              {submitLabel}
            </Button>
          </div>
        </div>
      ) : null}
      {popup && candidates.length ? (
        <div
          role="listbox"
          aria-label="Mention a teammate"
          data-testid="mention-popup"
          className="ks-popover-surface absolute bottom-full left-2 z-[var(--z-popover)] mb-1.5 w-[280px] max-w-[calc(100%-16px)] animate-pop-in p-1.5"
          onMouseDown={(event) => event.preventDefault()}
        >
          {candidates.map((person, index) => (
            <div
              key={person.id}
              role="option"
              aria-selected={index === popup.index}
              className="ks-menu-item cursor-pointer"
              onMouseEnter={() => setPopup({ ...popup, index })}
              onClick={() => pickMention(person)}
            >
              <Avatar name={person.name} src={person.image} size="sm" decorative />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{person.name}</span>
                <span className="truncate text-2xs text-fg-muted">{person.title ?? person.email}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});

/** Link tool: remembers the selection, asks for the address in a small popover. */
function LinkButton({
  textarea,
  onApply,
}: {
  readonly textarea: React.RefObject<HTMLTextAreaElement | null>;
  readonly onApply: (range: { start: number; end: number }, href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const range = useRef({ start: 0, end: 0 });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <IconButton
          size="sm"
          label="Add link"
          icon={<Link2 aria-hidden />}
          tooltipSide="top"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const el = textarea.current;
            range.current = { start: el?.selectionStart ?? 0, end: el?.selectionEnd ?? 0 };
            setValue('');
            setError(null);
            setOpen(true);
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[300px]"
        aria-label="Add link"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const raw = value.trim();
            const href = raw ? safeHref(/^[a-z]+:/i.test(raw) ? raw : `https://${raw}`) : null;
            if (!href) {
              setError('Enter a web address (https://…) or an email link (mailto:…)');
              return;
            }
            setOpen(false);
            onApply(range.current, href);
          }}
        >
          <label htmlFor="comment-link-input" className="text-xs font-semibold text-fg-secondary">
            Link address
          </label>
          <input
            id="comment-link-input"
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            placeholder="https://example.com"
            aria-invalid={error ? true : undefined}
            className="h-8 w-full rounded-sm border border-border-input bg-panel px-2.5 text-sm text-fg outline-none placeholder:text-fg-placeholder focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)] aria-[invalid=true]:border-danger"
          />
          {error ? (
            <p role="alert" className="text-xs text-danger-text">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm">
              Add link
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function ToolButton({
  label,
  icon,
  shortcut,
  onClick,
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly shortcut?: string[];
  readonly onClick: () => void;
}) {
  return (
    <IconButton
      size="sm"
      label={label}
      icon={icon}
      shortcut={shortcut}
      tooltipSide="top"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    />
  );
}
