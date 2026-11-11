'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlignLeft, Maximize2, Minimize2 } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogHeader, IconButton, Kbd, cn } from '@/components/ui';
import type { CellRenderContext, CellRenderer } from '../cell-context';
import { readText } from '../lib/values';
import { EmptyGhost, TruncText } from '../parts/common';
import { InlineInput } from '../parts/inline-input';
import { useTabFlush } from '../parts/use-tab-flush';

const TEXT_MAX = 2_000;
const LONG_TEXT_MAX = 50_000;

function TextDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const text = readText(ctx.value);
  if (!text) return null;
  return (
    <span className={cn('flex min-w-0 flex-1 px-2.5', ctx.column.type === 'name' && 'font-medium')}>
      <TruncText>{text}</TruncText>
    </span>
  );
}

function TextEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const text = readText(ctx.value);
  const isName = ctx.column.type === 'name';
  return (
    <InlineInput
      grabFocus={!ctx.preview}
      initial={ctx.seed ?? text}
      maxLength={TEXT_MAX}
      aria-label={ctx.column.title}
      validate={(draft) => (isName && !draft.trim() ? 'A name is required' : null)}
      onInvalidBlur={() => undefined}
      onCancel={() => ctx.endEdit()}
      onSubmit={(draft, navigate) => {
        const next = isName ? draft.trim() : draft;
        if (next !== text) ctx.commit(next.trim() ? next : isName ? text : null);
        ctx.endEdit(navigate);
      }}
    />
  );
}

function LongTextDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const text = readText(ctx.value);
  if (!text) return ctx.readOnly ? null : <EmptyGhost icon={<AlignLeft aria-hidden />} label="Add notes" />;
  const firstLine = text.split('\n')[0] ?? '';
  return (
    <span className="flex min-w-0 flex-1 px-2.5 text-fg">
      <TruncText tooltip={<span className="line-clamp-[12] whitespace-pre-wrap">{text}</span>}>
        {firstLine}
        {text.includes('\n') ? <span className="text-fg-muted"> …</span> : null}
      </TruncText>
    </span>
  );
}

function useAutoFocusEnd(ref: React.RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, [ref]);
}

function Counter({ length }: { readonly length: number }) {
  if (length < LONG_TEXT_MAX * 0.8) return null;
  return (
    <span className={cn('text-xs tabular-nums', length >= LONG_TEXT_MAX ? 'text-danger-text' : 'text-warning-text')}>
      {length.toLocaleString()} / {LONG_TEXT_MAX.toLocaleString()}
    </span>
  );
}

function LongTextEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const initial = readText(ctx.value);
  const [draft, setDraft] = useState((ctx.seed ? initial + ctx.seed : initial).slice(0, LONG_TEXT_MAX));
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoFocusEnd(ref);

  const flush = () => {
    if (draft !== initial) ctx.commit(draft.trim() ? draft : null);
    return true;
  };
  useTabFlush(ctx, flush);
  const save = () => {
    flush();
    ctx.endEdit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    }
  };

  const textarea = (rows: number, className?: string) => (
    <textarea
      ref={ref}
      value={draft}
      rows={rows}
      maxLength={LONG_TEXT_MAX}
      aria-label={ctx.column.title}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
      className={cn(
        'block w-full resize-y rounded-sm border border-border-input bg-panel px-2.5 py-2 text-base text-fg outline-none',
        'transition-[border-color,box-shadow] duration-[var(--duration-fast)] focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]',
        className,
      )}
    />
  );

  const footer = (
    <div className="flex items-center gap-2">
      <span className="flex flex-1 items-center gap-1 text-xs text-fg-muted">
        <Kbd>↵</Kbd> save · <Kbd>⇧</Kbd>
        <Kbd>↵</Kbd> new line
      </span>
      <Counter length={draft.length} />
      <Button variant="ghost" size="sm" onClick={() => ctx.endEdit()}>
        Cancel
      </Button>
      <Button size="sm" onClick={save}>
        Save
      </Button>
    </div>
  );

  return (
    <div className="flex w-[320px] flex-col gap-2" data-testid="long-text-editor">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-fg-muted ">{ctx.column.title}</span>
        <IconButton size="xs" label="Expand editor" icon={<Maximize2 aria-hidden />} onClick={() => setExpanded(true)} />
      </div>
      {expanded ? <div className="h-[132px] rounded-sm bg-muted" aria-hidden /> : textarea(6, 'min-h-[132px]')}
      {footer}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent size="lg" onCloseAutoFocus={(event) => event.preventDefault()}>
          <DialogHeader title={ctx.column.title} description={ctx.item.name} />
          <DialogBody className="flex flex-col gap-3 pb-6">
            {expanded ? textarea(16, 'min-h-[320px]') : null}
            <div className="flex items-center gap-2">
              <IconButton size="sm" label="Collapse editor" icon={<Minimize2 aria-hidden />} onClick={() => setExpanded(false)} />
              <span className="flex-1" />
              {footer}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const nameRenderer: CellRenderer = {
  behavior: { mode: 'inline', typeToEdit: true },
  Display: TextDisplay,
  Editor: TextEditor,
};

export const textRenderer: CellRenderer = {
  behavior: { mode: 'inline', clearable: true, typeToEdit: true },
  Display: TextDisplay,
  Editor: TextEditor,
};

export const longTextRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, typeToEdit: true, width: 320 },
  Display: LongTextDisplay,
  Editor: LongTextEditor,
};
