'use client';

/** Emoji grid in a popover (search + groups). Arrow keys move, Enter picks, Esc closes. */
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger, cn } from '@/components/ui';
import { EMOJI_GROUPS, searchEmojis } from '../lib/emoji';

const COLUMNS = 8;

export function EmojiPicker({
  onPick,
  children,
  label = 'Insert emoji',
  align = 'start',
}: {
  readonly onPick: (emoji: string) => void;
  readonly children: ReactNode;
  readonly label?: string;
  readonly align?: 'start' | 'center' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const results = useMemo(() => (query ? searchEmojis(query) : null), [query]);

  const pick = (emoji: string) => {
    onPick(emoji);
    setOpen(false);
    setQuery('');
  };

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(grid.current?.querySelectorAll<HTMLButtonElement>('button[data-emoji]') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, index + delta))]?.focus();
  };

  const renderButton = (emoji: { char: string; name: string }) => (
    <button
      key={emoji.char}
      type="button"
      data-emoji
      aria-label={emoji.name}
      title={emoji.name}
      onClick={() => pick(emoji.char)}
      className="flex size-8 items-center justify-center rounded-sm text-lg transition-[background-color,transform] duration-[var(--duration-instant)] ease-out hover:scale-110 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus active:scale-95"
    >
      {emoji.char}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-[296px] p-2" aria-label={label} onCloseAutoFocus={(event) => event.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              grid.current?.querySelector<HTMLButtonElement>('button[data-emoji]')?.focus();
            }
            if (event.key === 'Enter' && results?.[0]) {
              event.preventDefault();
              pick(results[0].char);
            }
          }}
          placeholder="Search emoji"
          aria-label="Search emoji"
          className="mb-2 h-8 w-full rounded-sm border border-border-input bg-panel px-2.5 text-sm text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-placeholder focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]"
        />
        <div ref={grid} onKeyDown={onGridKey} className="max-h-60 overflow-y-auto" role="group" aria-label="Emoji">
          {results ? (
            results.length > 0 ? (
              <div className="grid grid-cols-8 gap-0.5">{results.map(renderButton)}</div>
            ) : (
              <p className="px-1 py-4 text-center text-sm text-fg-muted">No emoji match “{query}”</p>
            )
          ) : (
            EMOJI_GROUPS.map((group) => (
              <div key={group.label} className={cn('mb-1.5')}>
                <p className="px-1 pb-1 text-xs font-semibold text-fg-muted">{group.label}</p>
                <div className="grid grid-cols-8 gap-0.5">{group.emojis.map(renderButton)}</div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
