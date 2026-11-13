'use client';
/**
 * Task description: a lightweight rich editor (Tiptap) that saves itself. Bold, italic, strike,
 * headings, bullet / numbered lists, checklists, links, inline code, code blocks and quotes.
 * Stored as sanitized HTML (the server's sanitizeRichText allow-list); autosaves ~1s after you
 * stop typing, on blur, and on ⌘/Ctrl+S. Read-only viewers see the rendered text.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import {
  Bold,
  Check,
  Code,
  FileCode2,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Quote,
  Strikethrough,
  TriangleAlert,
} from 'lucide-react';
import { Button, IconButton, Popover, PopoverAnchor, PopoverContent, cn, useModKey } from '@/components/ui';
import { safeHref } from './markdown';
import { SectionHeading } from './property-row';
import { useTaskContext } from './task-context';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const SAVE_DELAY_MS = 900;

/** Drop empty trailing paragraphs (extra blank lines at the end). */
function stripTrailingEmpty(html: string): string {
  return html.replace(/(<p>(<br\s*\/?>)?<\/p>)+$/i, '');
}

function isEmptyHtml(html: string): boolean {
  const text = html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text.length === 0 && !/<(hr|input)\b/i.test(html);
}

export function DescriptionEditor() {
  const { task, canEdit, patch } = useTaskContext();
  const mod = useModKey();
  const [state, setState] = useState<SaveState>('idle');
  const lastSaved = useRef<string>(stripTrailingEmpty(task.description ?? ''));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const latestHtml = useRef<string>(task.description ?? '');
  const patchRef = useRef(patch);
  useEffect(() => {
    patchRef.current = patch;
  });

  const save = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // Only real edits save (focus/blur or a refresh from the server never do). The HTML is
    // captured on every edit, so a save still works while the editor is being torn down.
    if (!dirty.current) return;
    dirty.current = false;
    const html = stripTrailingEmpty(latestHtml.current);
    const value = isEmptyHtml(html) ? '' : html;
    if (value === lastSaved.current) {
      setState((current) => (current === 'dirty' ? 'idle' : current));
      return;
    }
    setState('saving');
    const ok = await patchRef.current({ description: value || null });
    if (ok) {
      lastSaved.current = value;
      setState('saved');
    } else {
      dirty.current = true;
      setState('error');
    }
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    content: task.description ?? '',
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // No forced empty paragraph after lists/code: it adds a blank line to every description.
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        },
      }),
      Placeholder.configure({ placeholder: 'Add details: what needs to happen, links, a checklist…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    editorProps: {
      attributes: {
        'aria-label': 'Description',
        'aria-multiline': 'true',
        role: 'textbox',
        class: 'ks-rich',
        'data-testid': 'task-description-editor',
      },
      handleKeyDown: (view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void save();
          return true;
        }
        if (event.key === 'Escape') {
          event.stopPropagation();
          (view.dom as HTMLElement).blur();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: instance }) => {
      latestHtml.current = instance.getHTML();
      dirty.current = true;
      setState('dirty');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    },
    onBlur: () => void save(),
  });

  // Someone else (or another tab) changed the description: show it unless you're editing.
  useEffect(() => {
    if (!editor || editor.isFocused || dirty.current) return;
    const incoming = stripTrailingEmpty(task.description ?? '');
    if (incoming === lastSaved.current) return;
    lastSaved.current = incoming;
    latestHtml.current = incoming;
    editor.commands.setContent(incoming, { emitUpdate: false });
  }, [editor, task.description]);

  useEffect(() => {
    // Second argument false: changing editability must not count as an edit (no autosave).
    if (editor && editor.isEditable !== canEdit) editor.setEditable(canEdit, false);
  }, [canEdit, editor]);

  // Save pending edits when the task closes.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void save();
      }
    },
    [save],
  );

  useEffect(() => {
    if (state !== 'saved') return;
    const id = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(id);
  }, [state]);

  if (!canEdit) {
    return (
      <section aria-labelledby="task-description-heading" className="flex flex-col gap-1">
        <SectionHeading id="task-description-heading">Description</SectionHeading>
        {task.description ? (
          <div className="ks-rich px-0.5 [&_input]:pointer-events-none" dangerouslySetInnerHTML={{ __html: task.description }} />
        ) : (
          <p className="px-0.5 text-sm text-fg-muted">No description yet.</p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="task-description-heading" className="flex flex-col gap-1">
      <SectionHeading
        id="task-description-heading"
        actions={<SaveIndicator state={state} onRetry={() => void save()} />}
      >
        Description
      </SectionHeading>
      <div className="group/desc relative -mx-2.5">
        <div
          className={cn(
            'ks-task-editor rounded-lg border border-transparent transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)]',
            'hover:border-border-subtle focus-within:border-primary focus-within:bg-panel focus-within:shadow-[0_0_0_3px_var(--focus-ring-soft)] hover:focus-within:border-primary',
          )}
        >
          <Toolbar editor={editor} mod={mod} />
          <EditorContent editor={editor} />
          {editor ? null : (
            <div
              aria-hidden
              className="ks-skeleton m-2.5 h-4 w-1/2 rounded-full"
              style={{ marginBottom: 72 }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function SaveIndicator({ state, onRetry }: { readonly state: SaveState; readonly onRetry: () => void }) {
  let body: ReactNode = null;
  if (state === 'saving' || state === 'dirty')
    body = (
      <>
        <Loader2 aria-hidden className="size-3 animate-spin" /> Saving…
      </>
    );
  if (state === 'saved')
    body = (
      <>
        <Check aria-hidden className="size-3 text-success-text" /> Saved
      </>
    );
  if (state === 'error')
    body = (
      <>
        <TriangleAlert aria-hidden className="size-3 text-danger-text" /> Not saved.{' '}
        <button type="button" className="font-medium text-fg-link hover:underline" onClick={onRetry}>
          Try again
        </button>
      </>
    );
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex h-4 items-center justify-end gap-1 text-xs text-fg-muted"
    >
      {body}
    </p>
  );
}

function Toolbar({ editor, mod }: { readonly editor: Editor | null; readonly mod: string }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance?.isActive('bold') ?? false,
      italic: instance?.isActive('italic') ?? false,
      strike: instance?.isActive('strike') ?? false,
      heading: instance?.isActive('heading') ?? false,
      code: instance?.isActive('code') ?? false,
      codeBlock: instance?.isActive('codeBlock') ?? false,
      quote: instance?.isActive('blockquote') ?? false,
      bullet: instance?.isActive('bulletList') ?? false,
      ordered: instance?.isActive('orderedList') ?? false,
      task: instance?.isActive('taskList') ?? false,
      link: instance?.isActive('link') ?? false,
    }),
  });
  const run = (fn: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => {
    if (editor) fn(editor.chain().focus()).run();
  };
  const tool = (
    key: string,
    label: string,
    icon: ReactNode,
    on: boolean | undefined,
    action: () => void,
    shortcut?: string[],
  ) => (
    <IconButton
      key={key}
      size="sm"
      label={label}
      icon={icon}
      active={on}
      aria-pressed={on}
      shortcut={shortcut}
      tooltipSide="top"
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    />
  );
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className={cn(
        'flex flex-wrap items-center gap-0.5 overflow-hidden border-b border-transparent px-1 transition-[max-height,opacity,padding] duration-[var(--duration-fast)]',
        'max-h-0 py-0 opacity-0 group-focus-within/desc:max-h-20 group-focus-within/desc:border-border-subtle group-focus-within/desc:py-1 group-focus-within/desc:opacity-100',
      )}
    >
      {tool('bold', 'Bold', <Bold aria-hidden />, active?.bold, () => run((c) => c.toggleBold()), [mod, 'B'])}
      {tool('italic', 'Italic', <Italic aria-hidden />, active?.italic, () => run((c) => c.toggleItalic()), [
        mod,
        'I',
      ])}
      {tool('strike', 'Strikethrough', <Strikethrough aria-hidden />, active?.strike, () =>
        run((c) => c.toggleStrike()),
      )}
      {tool('heading', 'Heading', <Heading2 aria-hidden />, active?.heading, () =>
        run((c) => c.toggleHeading({ level: 2 })),
      )}
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border-subtle" />
      {tool('bullet', 'Bulleted list', <List aria-hidden />, active?.bullet, () =>
        run((c) => c.toggleBulletList()),
      )}
      {tool('ordered', 'Numbered list', <ListOrdered aria-hidden />, active?.ordered, () =>
        run((c) => c.toggleOrderedList()),
      )}
      {tool('task', 'Checklist', <ListChecks aria-hidden />, active?.task, () =>
        run((c) => c.toggleTaskList()),
      )}
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border-subtle" />
      <LinkTool editor={editor} active={active?.link ?? false} />
      {tool('code', 'Inline code', <Code aria-hidden />, active?.code, () => run((c) => c.toggleCode()))}
      {tool('codeBlock', 'Code block', <FileCode2 aria-hidden />, active?.codeBlock, () =>
        run((c) => c.toggleCodeBlock()),
      )}
      {tool('quote', 'Quote', <Quote aria-hidden />, active?.quote, () => run((c) => c.toggleBlockquote()))}
      <span className="ml-auto hidden pr-1.5 text-2xs text-fg-muted sm:inline">Saves by itself</span>
    </div>
  );
}

function LinkTool({ editor, active }: { readonly editor: Editor | null; readonly active: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

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
      setError('Enter a web address (https://…) or an email link (mailto:…)');
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty && !active)
      chain.insertContent({ type: 'text', text: raw, marks: [{ type: 'link', attrs: { href } }] }).run();
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
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!editor) return;
            setValue(String(editor.getAttributes('link').href ?? ''));
            setError(null);
            setOpen(true);
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[300px]"
        aria-label="Link"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <label htmlFor="task-link-input" className="text-xs font-semibold text-fg-secondary">
            Link address
          </label>
          <input
            id="task-link-input"
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            placeholder="https://example.com"
            aria-invalid={error ? true : undefined}
            className="h-8 w-full rounded-sm border border-border-input bg-panel px-2.5 text-sm text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-placeholder focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)] aria-[invalid=true]:border-danger"
          />
          {error ? (
            <p role="alert" className="text-xs text-danger-text">
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
