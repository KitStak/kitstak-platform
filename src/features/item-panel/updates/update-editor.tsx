'use client';

/**
 * Tiptap editor used by the composer, replies and inline edit: formatting toolbar (bold,
 * italic, strike, lists, checklist, link, code), @mentions with a keyboard popover, emoji,
 * paste/drop of files, Ctrl/⌘+Enter to submit.
 */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import {
  AtSign,
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Smile,
  Strikethrough,
} from 'lucide-react';
import { Avatar, Button, IconButton, Popover, PopoverAnchor, PopoverContent, cn, useModKey } from '@/components/ui';
import type { UserSummaryDto } from '@/server/services/contracts/dto';
import { rankMentionCandidates } from '../lib/mentions';
import { isDocEmpty, safeHref, type RichDoc } from '../lib/rich-text';
import { EmojiPicker } from './emoji-picker';
import { createEditorBridge, type EditorHandlers, type MentionView } from './editor-bridge';

export interface UpdateEditorHandle {
  readonly editor: Editor | null;
  focus: () => void;
  clear: () => void;
  getDoc: () => RichDoc;
  isEmpty: () => boolean;
}

export interface UpdateEditorProps {
  readonly users: readonly UserSummaryDto[];
  readonly placeholder: string;
  readonly initialContent?: RichDoc | null;
  readonly autoFocus?: boolean;
  readonly onSubmit?: () => void;
  readonly onChange?: (doc: RichDoc, empty: boolean) => void;
  readonly onFiles?: (files: File[]) => void;
  readonly onEscape?: () => boolean;
  /** Extra toolbar controls (attach button) rendered after the formatting buttons. */
  readonly toolbarExtra?: ReactNode;
  /** Content under the editor (attachment chips). */
  readonly footer?: ReactNode;
  /** Right side of the toolbar (Post / Save buttons). */
  readonly actions?: ReactNode;
  readonly minHeight?: number;
  readonly label: string;
  readonly testId?: string;
  readonly disabled?: boolean;
}


export const UpdateEditor = forwardRef<UpdateEditorHandle, UpdateEditorProps>(function UpdateEditor(
  {
    users,
    placeholder,
    initialContent,
    autoFocus,
    onSubmit,
    onChange,
    onFiles,
    onEscape,
    toolbarExtra,
    footer,
    actions,
    minHeight = 72,
    label,
    testId,
    disabled,
  },
  ref,
) {
  const mod = useModKey();
  const [bridge] = useState(createEditorBridge);
  useLayoutEffect(() => {
    bridge.sync(users, { submit: onSubmit, change: onChange as EditorHandlers['change'], files: onFiles, escape: onEscape });
  });
  const mention = useSyncExternalStore(bridge.subscribe, bridge.getMention, () => null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    autofocus: autoFocus ? 'end' : false,
    content: (initialContent as JSONContent | null | undefined) ?? undefined,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Mention.configure({
        HTMLAttributes: { class: 'ks-mention' },
        renderText: ({ node }) => `@${String(node.attrs.label ?? '')}`,
        suggestion: {
          char: '@',
          items: ({ query }) => rankMentionCandidates(bridge.users(), query),
          render: () => ({
            onStart: (props) => bridge.open(props),
            onUpdate: (props) => bridge.open(props),
            onKeyDown: (props) => bridge.keydown(props),
            onExit: () => bridge.setMention(null),
          }),
        },
      }),
    ],
    editorProps: {
      attributes: { 'aria-label': label, 'aria-multiline': 'true', role: 'textbox', class: 'ks-rich' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          bridge.handlers().submit?.();
          return true;
        }
        if (event.key === 'Escape' && bridge.handlers().escape?.()) return true;
        return false;
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length === 0 || !bridge.handlers().files) return false;
        bridge.handlers().files?.(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = [...((event as DragEvent).dataTransfer?.files ?? [])];
        if (files.length === 0 || !bridge.handlers().files) return false;
        event.preventDefault();
        bridge.handlers().files?.(files);
        return true;
      },
    },
    onUpdate: ({ editor: instance }) => {
      const doc = instance.getJSON() as RichDoc;
      (bridge.handlers().change as UpdateEditorProps['onChange'])?.(doc, isDocEmpty(doc));
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useImperativeHandle(
    ref,
    () => ({
      editor,
      focus: () => editor?.commands.focus('end'),
      clear: () => editor?.commands.clearContent(true),
      getDoc: () => (editor?.getJSON() as RichDoc | undefined) ?? { type: 'doc', content: [] },
      isEmpty: () => isDocEmpty(editor?.getJSON() as RichDoc | undefined),
    }),
    [editor],
  );

  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance?.isActive('bold') ?? false,
      italic: instance?.isActive('italic') ?? false,
      strike: instance?.isActive('strike') ?? false,
      code: instance?.isActive('code') ?? false,
      bullet: instance?.isActive('bulletList') ?? false,
      ordered: instance?.isActive('orderedList') ?? false,
      task: instance?.isActive('taskList') ?? false,
      link: instance?.isActive('link') ?? false,
    }),
  });

  const run = (fn: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => {
    if (!editor) return;
    fn(editor.chain().focus()).run();
  };

  const tool = (key: string, toolLabel: string, icon: ReactNode, on: boolean | undefined, action: () => void, shortcut?: string[]) => (
    <IconButton
      key={key}
      size="sm"
      label={toolLabel}
      icon={icon}
      active={on}
      aria-pressed={on}
      shortcut={shortcut}
      tooltipSide="top"
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    />
  );

  return (
    <div
      data-testid={testId}
      className={cn(
        'ks-editor relative rounded-lg border border-border-input bg-panel transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-out',
        'focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--focus-ring-soft)] hover:border-border-input-hover focus-within:hover:border-primary',
      )}
      style={{ ['--ks-editor-min' as string]: `${minHeight}px` }}
    >
      <EditorContent editor={editor} />
      {editor ? null : <div aria-hidden className="ks-skeleton m-3 h-4 w-1/2 rounded-full" style={{ marginBottom: minHeight - 28 }} />}
      {footer}
      <div className="flex flex-wrap items-center gap-0.5 border-t border-border-subtle px-1.5 py-1">
        {tool('bold', 'Bold', <Bold aria-hidden />, active?.bold, () => run((c) => c.toggleBold()), [mod, 'B'])}
        {tool('italic', 'Italic', <Italic aria-hidden />, active?.italic, () => run((c) => c.toggleItalic()), [mod, 'I'])}
        {tool('strike', 'Strikethrough', <Strikethrough aria-hidden />, active?.strike, () => run((c) => c.toggleStrike()))}
        <span aria-hidden className="mx-0.5 h-4 w-px bg-border-subtle" />
        {tool('bullet', 'Bulleted list', <List aria-hidden />, active?.bullet, () => run((c) => c.toggleBulletList()))}
        {tool('ordered', 'Numbered list', <ListOrdered aria-hidden />, active?.ordered, () => run((c) => c.toggleOrderedList()))}
        {tool('task', 'Checklist', <ListChecks aria-hidden />, active?.task, () => run((c) => c.toggleTaskList()))}
        <span aria-hidden className="mx-0.5 h-4 w-px bg-border-subtle" />
        <LinkTool editor={editor} active={active?.link ?? false} disabled={disabled} />
        {tool('code', 'Code', <Code aria-hidden />, active?.code, () => run((c) => c.toggleCode()))}
        {tool('mention', 'Mention someone', <AtSign aria-hidden />, false, () => run((c) => c.insertContent(' @')))}
        <EmojiPicker onPick={(emoji) => run((c) => c.insertContent(emoji))}>
          <IconButton size="sm" label="Emoji" icon={<Smile aria-hidden />} tooltipSide="top" disabled={disabled} />
        </EmojiPicker>
        {toolbarExtra}
        <div className="ml-auto flex items-center gap-1.5">{actions}</div>
      </div>
      {mention ? <MentionPopup view={mention} onHover={(index) => bridge.setMention({ ...mention, index })} /> : null}
    </div>
  );
});

function MentionPopup({ view, onHover }: { readonly view: MentionView; readonly onHover: (index: number) => void }) {
  const rect = view.rect;
  if (!rect) return null;
  const below = rect.bottom + 6;
  const fitsBelow = typeof window === 'undefined' || below + 300 < window.innerHeight;
  const style = fitsBelow
    ? { top: below, left: Math.min(rect.left, (typeof window === 'undefined' ? 9999 : window.innerWidth) - 296) }
    : { bottom: (typeof window === 'undefined' ? 0 : window.innerHeight) - rect.top + 6, left: rect.left };
  const activeId = view.items[view.index] ? `ks-mention-${view.items[view.index]?.id}` : undefined;
  return (
    <div
      role="listbox"
      aria-label="Mention a teammate"
      aria-activedescendant={activeId}
      data-testid="mention-popup"
      className="ks-popover-surface fixed z-[var(--z-popover)] w-[280px] animate-pop-in p-1.5"
      style={style}
      onMouseDown={(event) => event.preventDefault()}
    >
      {view.items.length === 0 ? (
        <p className="px-2.5 py-3 text-sm text-fg-muted">No teammates match</p>
      ) : (
        view.items.map((user, index) => (
          <div
            key={user.id}
            id={`ks-mention-${user.id}`}
            role="option"
            aria-selected={index === view.index}
            className="ks-menu-item cursor-pointer"
            onMouseEnter={() => onHover(index)}
            onClick={() => view.command(user)}
          >
            <Avatar name={user.name} src={user.image} colorKey={user.id} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-base">{user.name}</span>
              {user.title ? <span className="truncate text-xs text-fg-muted">{user.title}</span> : null}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function LinkTool({ editor, active, disabled }: { readonly editor: Editor | null; readonly active: boolean; readonly disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const openTool = () => {
    if (!editor) return;
    setValue(String(editor.getAttributes('link').href ?? ''));
    setError(null);
    setOpen(true);
  };

  const apply = () => {
    if (!editor) return;
    const raw = value.trim();
    if (!raw) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setOpen(false);
      return;
    }
    const href = safeHref(/^[a-z]+:/i.test(raw) ? raw : `https://${raw}`);
    if (!href) {
      setError('Enter a web address (https://…) or an email link (mailto:)');
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty && !active) chain.insertContent({ type: 'text', text: raw, marks: [{ type: 'link', attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <IconButton
          size="sm"
          label={active ? 'Edit link' : 'Add link'}
          icon={<Link2 aria-hidden />}
          active={active}
          aria-pressed={active}
          tooltipSide="top"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={openTool}
        />
      </PopoverAnchor>
      <PopoverContent className="w-[300px]" aria-label="Link" onCloseAutoFocus={(event) => event.stopPropagation()}>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <label htmlFor="ks-link-input" className="text-xs font-semibold text-fg-secondary">
            Link address
          </label>
          <input
            id="ks-link-input"
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            placeholder="https://example.com"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'ks-link-error' : undefined}
            className="h-8 w-full rounded-sm border border-border-input bg-panel px-2.5 text-sm text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-placeholder focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)] aria-[invalid=true]:border-danger"
          />
          {error ? (
            <p id="ks-link-error" role="alert" className="text-xs text-danger-text">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-1.5">
            {active ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  editor?.chain().focus().extendMarkRange('link').unsetLink().run();
                  setOpen(false);
                }}
              >
                Remove
              </Button>
            ) : null}
            <Button type="submit" size="sm">
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
