'use client';
/**
 * Chip-aware message editor: a contenteditable where `{name}` / `{board}` are atomic,
 * non-editable chips ("Item name", "Board name"). The value stays the engine's template string.
 * Paste is plain text; Backspace removes a chip as one unit (the browser handles
 * contenteditable=false nodes atomically).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { cn } from '@/components/ui';
import { templateSegments, templateVarLabel, type TemplateVar } from '../model/template';

export interface TemplateEditorHandle {
  insertVar(name: TemplateVar): void;
  focus(): void;
}

export interface TemplateEditorProps {
  readonly initialValue: string;
  readonly term: string;
  readonly maxLength: number;
  readonly onChange: (value: string) => void;
  readonly onSubmit?: () => void;
  readonly placeholder?: string;
  readonly 'aria-label': string;
  readonly className?: string;
}

const CHIP_CLASS =
  'mx-px inline-flex items-center rounded-xs bg-primary-subtle px-1 align-baseline text-[0.9em] font-medium text-primary-text select-none';

function chipNode(name: TemplateVar, term: string): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.contentEditable = 'false';
  chip.dataset.var = name;
  chip.className = CHIP_CLASS;
  chip.textContent = templateVarLabel(name, term);
  return chip;
}

function render(root: HTMLElement, value: string, term: string) {
  root.replaceChildren();
  for (const segment of templateSegments(value)) {
    if (segment.kind === 'var') root.append(chipNode(segment.name, term));
    else {
      const lines = segment.text.split('\n');
      lines.forEach((line, index) => {
        if (index > 0) root.append(document.createElement('br'));
        if (line) root.append(document.createTextNode(line));
      });
    }
  }
}

/** DOM → template string (`{name}` for chips, `\n` for line breaks / blocks). */
export function serializeTemplate(root: Node): string {
  let out = '';
  root.childNodes.forEach((node, index) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? '').replace(/ /g, ' ');
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.var === 'name' || node.dataset.var === 'board') {
      out += `{${node.dataset.var}}`;
      return;
    }
    if (node.tagName === 'BR') {
      out += '\n';
      return;
    }
    // Browsers wrap new lines in <div> / <p>.
    if (index > 0 && (node.tagName === 'DIV' || node.tagName === 'P')) out += '\n';
    out += serializeTemplate(node);
  });
  return out;
}

export const TemplateEditor = forwardRef<TemplateEditorHandle, TemplateEditorProps>(function TemplateEditor(
  { initialValue, term, maxLength, onChange, onSubmit, placeholder, className, ...aria },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    render(root, initialValue, term);
    root.focus();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    savedRange.current = range.cloneRange();
    // Initial render only: the DOM is the source of truth while editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(() => {
    const root = rootRef.current;
    if (root) onChange(serializeTemplate(root));
  }, [onChange]);

  const rememberSelection = () => {
    const selection = window.getSelection();
    const root = rootRef.current;
    if (!selection || selection.rangeCount === 0 || !root) return;
    const range = selection.getRangeAt(0);
    if (root.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
  };

  const insertNode = (node: Node) => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    const selection = window.getSelection();
    let range = savedRange.current;
    if (!range || !root.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(node);
    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(after);
    savedRange.current = after.cloneRange();
    emit();
  };

  useImperativeHandle(ref, () => ({
    insertVar: (name) => {
      const root = rootRef.current;
      if (root && serializeTemplate(root).length + name.length + 2 > maxLength) return;
      insertNode(chipNode(name, term));
    },
    focus: () => rootRef.current?.focus(),
  }));

  return (
    <div
      ref={rootRef}
      role="textbox"
      aria-multiline="true"
      aria-label={aria['aria-label']}
      aria-placeholder={placeholder}
      contentEditable
      suppressContentEditableWarning
      tabIndex={0}
      data-testid="template-editor"
      data-placeholder={placeholder}
      onInput={() => {
        rememberSelection();
        emit();
      }}
      onKeyUp={rememberSelection}
      onMouseUp={rememberSelection}
      onBlur={rememberSelection}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onSubmit?.();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          insertNode(document.createElement('br'));
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain');
        const root = rootRef.current;
        const room = maxLength - (root ? serializeTemplate(root).length : 0);
        if (room <= 0 || !text) return;
        rememberSelection();
        insertNode(document.createTextNode(text.slice(0, room)));
      }}
      className={cn(
        'min-h-[96px] w-full overflow-y-auto rounded-md border border-border-default bg-panel px-3 py-2 text-sm leading-6 whitespace-pre-wrap text-fg',
        'transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:border-border-strong',
        'focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus',
        'empty:before:pointer-events-none empty:before:text-fg-muted empty:before:content-[attr(data-placeholder)]',
        'max-h-48',
        className,
      )}
    />
  );
});
