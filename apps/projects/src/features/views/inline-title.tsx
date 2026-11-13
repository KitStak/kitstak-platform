'use client';
/** Inline title editor (list rows, table cells): Enter saves, Escape cancels, blur saves. */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/components/ui';

export function InlineTitle({ value, onSave, onDone, className }: { readonly value: string; readonly onSave: (title: string) => void; readonly onDone: () => void; readonly className?: string }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    const title = text.trim();
    if (title && title !== value) onSave(title);
    onDone();
  };
  return (
    <input
      ref={ref}
      value={text}
      maxLength={500}
      aria-label="Task name"
      onChange={(event) => setText(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onDone();
        }
      }}
      onBlur={commit}
      className={cn('h-7 min-w-0 flex-1 rounded-sm border border-primary bg-panel px-1.5 text-sm text-fg shadow-[0_0_0_3px_var(--focus-ring-soft)] outline-none', className)}
    />
  );
}
