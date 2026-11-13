'use client';
/** Inline "add a task" card at the bottom of a board column. Enter adds and keeps it open; Esc closes. */
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Kbd, cn } from '@/components/ui';

export function BoardComposer({ label, onAdd, onClose }: { readonly label: string; readonly onAdd: (title: string) => Promise<unknown>; readonly onClose: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const submit = async () => {
    const title = value.trim();
    if (!title || busy) return;
    setBusy(true);
    setValue('');
    await onAdd(title);
    setBusy(false);
    ref.current?.focus();
  };

  return (
    <div className="rounded-lg border border-primary bg-panel p-2 shadow-sm" data-testid="board-composer">
      <textarea
        ref={ref}
        rows={2}
        value={value}
        maxLength={500}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        onBlur={() => {
          if (!value.trim() && !busy) onClose();
        }}
        placeholder="What needs to be done?"
        aria-label={label}
        className="block w-full resize-none bg-transparent text-sm leading-5 text-fg outline-none placeholder:text-fg-placeholder"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-2xs text-fg-muted">
          <Kbd>Enter</Kbd> to add · <Kbd>Esc</Kbd> to close
        </p>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void submit()}
          disabled={!value.trim() || busy}
          className={cn('inline-flex h-6 items-center gap-1 rounded-sm bg-primary px-2 text-xs font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40', 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus')}
        >
          <Plus aria-hidden className="size-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}
