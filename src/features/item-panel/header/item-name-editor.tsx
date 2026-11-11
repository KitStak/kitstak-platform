'use client';

/**
 * Inline-editable item name. The textarea *is* the heading (same font, size and box), so
 * switching into edit mode causes zero layout shift. Long names wrap: up to three lines at
 * rest (with a fade + ellipsis when longer), the full name while editing. Enter saves,
 * Esc reverts; newlines are never inserted.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/components/ui';

/** Matches the board's item-name limit (monday-style 255). */
export const ITEM_NAME_MAX = 255;
/** Lines shown when not editing. */
const REST_LINES = 3;

export function ItemNameEditor({
  name,
  term,
  readOnly,
  onRename,
}: {
  readonly name: string;
  readonly term: string;
  readonly readOnly: boolean;
  readonly onRename: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  const [invalid, setInvalid] = useState(false);
  const [editing, setEditing] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Follow outside renames (realtime, undo) unless the user is typing.
  const [syncedName, setSyncedName] = useState(name);
  if (name !== syncedName && !editing) {
    setSyncedName(name);
    setValue(name);
  }

  /** Size the textarea to its content; at rest cap it at REST_LINES lines. */
  const fit = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.paddingBottom = '';
    element.style.marginBottom = '';
    const style = window.getComputedStyle(element);
    const line = Number.parseFloat(style.lineHeight) || 28;
    const borders = element.offsetHeight - element.clientHeight;
    const padTop = Number.parseFloat(style.paddingTop);
    const padBottom = Number.parseFloat(style.paddingBottom);
    const full = element.scrollHeight + borders;
    const isClamped = !editing && full > borders + padTop + padBottom + line * REST_LINES + 1;
    if (isClamped) {
      // Overflow paints into the bottom padding, so move that space outside the box: the
      // fourth line is cut exactly at the line boundary and the layout height is unchanged.
      element.style.paddingBottom = '0px';
      element.style.marginBottom = `${padBottom}px`;
      element.style.height = `${Math.ceil(borders + padTop + line * REST_LINES)}px`;
    } else {
      element.style.height = `${Math.ceil(full)}px`;
    }
    setClamped(isClamped);
  }, [editing]);

  useLayoutEffect(() => {
    fit();
  }, [fit, value]);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let width = element.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (element.offsetWidth === width) return;
      width = element.offsetWidth;
      fit();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  const commit = () => {
    const next = value.replace(/\s+/g, ' ').trim();
    if (!next) {
      setValue(name);
      setInvalid(false);
      return;
    }
    if (next !== name) onRename(next);
    setValue(next);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <textarea
        ref={ref}
        value={value}
        rows={1}
        readOnly={readOnly}
        maxLength={ITEM_NAME_MAX}
        aria-label={`${term} name`}
        aria-invalid={invalid || undefined}
        title={clamped ? value : undefined}
        spellCheck={editing}
        data-testid="item-panel-name"
        onFocus={() => setEditing(true)}
        onChange={(event) => {
          const next = event.target.value.replace(/[\r\n]+/g, ' ');
          setValue(next);
          setInvalid(next.trim().length === 0);
        }}
        onBlur={() => {
          setEditing(false);
          commit();
          ref.current?.scrollTo({ top: 0 });
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            ref.current?.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setValue(name);
            setInvalid(false);
            requestAnimationFrame(() => ref.current?.blur());
          }
        }}
        className={cn(
          'block w-full min-w-0 resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 text-lg leading-7 font-semibold break-words text-fg outline-none sm:text-xl sm:leading-8',
          'transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)] ease-out',
          !readOnly && 'hover:border-border-subtle hover:bg-hover focus:border-primary focus:bg-panel focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]',
          invalid && 'focus:border-danger',
          readOnly && 'cursor-default',
        )}
      />
      {clamped ? (
        <span
          aria-hidden
          className="pointer-events-none absolute right-px bottom-[5px] pl-8 text-lg leading-7 font-semibold text-fg sm:text-xl sm:leading-8"
          style={{ background: 'linear-gradient(to right, transparent, var(--surface-raised) 2rem)' }}
        >
          …
        </span>
      ) : null}
      {invalid ? (
        <p role="alert" className="sr-only">
          The name can’t be empty. Press Escape to keep the current name.
        </p>
      ) : null}
    </div>
  );
}
