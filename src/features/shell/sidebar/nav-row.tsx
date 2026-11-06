'use client';
import Link from 'next/link';
import { forwardRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { HighlightText } from '../highlight';

export const ROW_INDENT_PX = 16;

const rowClass = [
  'group/row relative flex h-8 w-full min-w-0 items-center gap-2 rounded-sm pr-1 text-base text-fg outline-none',
  'transition-[background-color] duration-[var(--duration-instant)] ease-out',
  'hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
  'aria-[current=page]:bg-selected aria-[current=page]:hover:bg-selected-hover aria-[current=page]:font-medium aria-[current=page]:text-primary-text',
  '[&[aria-current=page]_[data-row-icon]]:text-primary-text',
].join(' ');

export interface NavRowProps {
  readonly href?: string;
  readonly onClick?: () => void;
  readonly onDoubleClick?: () => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  readonly icon: ReactNode;
  readonly label: ReactNode;
  readonly active?: boolean;
  readonly depth?: number;
  /** Leading control before the icon (folder chevron). */
  readonly leading?: ReactNode;
  /** Trailing content always visible (badges, lock glyph). */
  readonly meta?: ReactNode;
  /** Trailing actions revealed on hover / focus-within (e.g. "…" menu). */
  readonly actions?: ReactNode;
  readonly title?: string;
  readonly className?: string;
  readonly 'aria-expanded'?: boolean;
  /** Stable e2e hook (see docs/QA.md selector contract). */
  readonly testId?: string;
}

/**
 * Sidebar row: a real link (so Cmd/Ctrl-click opens a new tab) or button, with a soft selected
 * state, inset focus ring and hover-revealed actions that never shift the label.
 */
export const NavRow = forwardRef<HTMLDivElement, NavRowProps>(function NavRow(
  {
    href,
    onClick,
    onDoubleClick,
    onKeyDown,
    icon,
    label,
    active,
    depth = 0,
    leading,
    meta,
    actions,
    title,
    className,
    testId,
    ...aria
  },
  ref,
) {
  const padding = { paddingLeft: 8 + depth * ROW_INDENT_PX };
  const inner = (
    <>
      {leading}
      <span data-row-icon className="flex size-5 shrink-0 items-center justify-center text-icon">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? (
        <span className="flex shrink-0 items-center gap-1 text-fg-muted group-hover/item:hidden">{meta}</span>
      ) : null}
    </>
  );
  return (
    <div ref={ref} className={cn('group/item relative', className)}>
      {href ? (
        <Link
          href={href}
          prefetch={false}
          aria-current={active ? 'page' : undefined}
          title={title}
          data-testid={testId}
          className={cn(rowClass, actions && 'pr-9')}
          style={padding}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onKeyDown={onKeyDown}
        >
          {inner}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onKeyDown={onKeyDown}
          title={title}
          data-testid={testId}
          aria-current={active ? 'page' : undefined}
          aria-expanded={aria['aria-expanded']}
          className={cn(rowClass, 'text-left', actions && 'pr-9')}
          style={padding}
        >
          {inner}
        </button>
      )}
      {actions ? (
        <span
          className={cn(
            'absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-[var(--duration-fast)]',
            'group-hover/item:opacity-100 group-focus-within/item:opacity-100 has-[[data-state=open]]:opacity-100',
          )}
        >
          {actions}
        </span>
      ) : null}
    </div>
  );
});

/** Wraps matched words in a highlight mark (case-insensitive). */
export function Highlight({ text, query }: { readonly text: string; readonly query: string }) {
  return <HighlightText text={text} query={query} />;
}
