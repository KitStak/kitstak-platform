'use client';
/**
 * Project description on the Overview: rendered rich text with an Edit button. Editing uses the
 * same Tiptap setup and typography as task descriptions (bold, italic, headings, lists,
 * checklists, links) with an explicit Save / Cancel, ⌘/Ctrl+S to save and Esc to cancel.
 */
import '@/features/task/task.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Bold, Heading2, Italic, List, ListChecks, ListOrdered, Pencil, Quote } from 'lucide-react';
import { Button, IconButton, cn, useModKey } from '@/components/ui';

const isEmptyHtml = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() === '' && !/<(img|hr)/i.test(html);

function Toolbar({ editor }: { readonly editor: Editor | null }) {
  const mod = useModKey();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      heading: e?.isActive('heading') ?? false,
      bullet: e?.isActive('bulletList') ?? false,
      ordered: e?.isActive('orderedList') ?? false,
      task: e?.isActive('taskList') ?? false,
      quote: e?.isActive('blockquote') ?? false,
    }),
  });
  const run = (fn: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => {
    if (editor) fn(editor.chain().focus()).run();
  };
  const tool = (key: string, label: string, icon: ReactNode, on: boolean | undefined, action: () => void, shortcut?: string[]) => (
    <IconButton key={key} size="sm" label={label} icon={icon} active={on} aria-pressed={on} shortcut={shortcut} tooltipSide="top" onMouseDown={(event) => event.preventDefault()} onClick={action} />
  );
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-border-subtle px-1 py-1">
      {tool('bold', 'Bold', <Bold aria-hidden />, state?.bold, () => run((c) => c.toggleBold()), [mod, 'B'])}
      {tool('italic', 'Italic', <Italic aria-hidden />, state?.italic, () => run((c) => c.toggleItalic()), [mod, 'I'])}
      {tool('heading', 'Heading', <Heading2 aria-hidden />, state?.heading, () => run((c) => c.toggleHeading({ level: 2 })))}
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border-subtle" />
      {tool('bullet', 'Bulleted list', <List aria-hidden />, state?.bullet, () => run((c) => c.toggleBulletList()))}
      {tool('ordered', 'Numbered list', <ListOrdered aria-hidden />, state?.ordered, () => run((c) => c.toggleOrderedList()))}
      {tool('task', 'Checklist', <ListChecks aria-hidden />, state?.task, () => run((c) => c.toggleTaskList()))}
      {tool('quote', 'Quote', <Quote aria-hidden />, state?.quote, () => run((c) => c.toggleBlockquote()))}
    </div>
  );
}

function Editing({ initial, onSave, onCancel }: { readonly initial: string; readonly onSave: (html: string | null) => Promise<boolean>; readonly onCancel: () => void }) {
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const save = async (html: string) => {
    setSaving(true);
    const ok = await onSave(isEmptyHtml(html) ? null : html);
    setSaving(false);
    if (ok) onCancel();
  };
  const editor = useEditor({
    immediatelyRender: false,
    autofocus: 'end',
    content: initial,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        trailingNode: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      }),
      Placeholder.configure({ placeholder: 'What is this project for? Who is it for, and what does “done” look like?' }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    editorProps: {
      attributes: { 'aria-label': 'Project description', 'aria-multiline': 'true', role: 'textbox', class: 'ks-rich min-h-28 px-3 py-2.5 outline-none', 'data-testid': 'project-description-editor' },
      handleKeyDown: (view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void save(editorRef.current?.getHTML() ?? view.dom.innerHTML);
          return true;
        }
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
          return true;
        }
        return false;
      },
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-border-input bg-panel focus-within:border-focus focus-within:shadow-[0_0_0_3px_var(--focus-ring-soft)]">
        <Toolbar editor={editor} />
        <EditorContent editor={editor} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" loading={saving} onClick={() => void save(editor?.getHTML() ?? '')} data-testid="save-description">
          Save
        </Button>
      </div>
    </div>
  );
}

export function ProjectDescription({ html, canEdit, onSave }: { readonly html: string | null; readonly canEdit: boolean; readonly onSave: (html: string | null) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <Editing initial={html ?? ''} onSave={onSave} onCancel={() => setEditing(false)} />;
  return (
    <div className="group/desc relative">
      {html ? (
        <div className={cn('ks-rich ks-prose', canEdit && 'pr-10')} dangerouslySetInnerHTML={{ __html: html }} />
      ) : canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-full rounded-lg border border-dashed border-border-default px-4 py-5 text-left text-sm text-fg-muted outline-none hover:border-border-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
        >
          <span className="font-medium text-fg">Add a description.</span> Say what this project is for, who it helps, and what “done” looks like.
        </button>
      ) : (
        <p className="text-sm text-fg-muted">No description yet.</p>
      )}
      {html && canEdit ? (
        <IconButton label="Edit description" icon={<Pencil aria-hidden />} size="sm" className="absolute top-0 right-0" onClick={() => setEditing(true)} data-testid="edit-description" />
      ) : null}
    </div>
  );
}
