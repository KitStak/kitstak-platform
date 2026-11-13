'use client';
/** One "label → value" row of the task properties panel (Jira/Linear style). */
import type { ReactNode } from 'react';
import { cn } from '@/components/ui';

/** Ghost button used as the value trigger of every property (hover tint, focus ring, read-only friendly). */
export const PROPERTY_TRIGGER =
  'inline-flex h-8 min-w-0 max-w-full items-center gap-2 rounded-md px-2 text-left text-sm whitespace-nowrap text-fg transition-colors duration-[var(--duration-fast)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default disabled:hover:bg-transparent';

export function PropertyRow({
  icon,
  label,
  children,
  className,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'grid min-h-9 grid-cols-[minmax(104px,128px)_minmax(0,1fr)] items-start gap-2',
        className,
      )}
    >
      <span className="flex h-8 min-w-0 items-center gap-2 text-sm text-fg-secondary [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-icon">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <div className="flex min-w-0 flex-wrap items-center">{children}</div>
    </div>
  );
}

/** Small uppercase section heading with optional count and right-side actions. */
export function SectionHeading({
  id,
  icon,
  children,
  count,
  actions,
}: {
  readonly id?: string;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly count?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <h3
        id={id}
        className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-icon"
      >
        {icon}
        <span className="truncate">{children}</span>
        {count !== undefined && count !== null && count !== '' ? (
          <span className="font-normal text-fg-muted tabular-nums">{count}</span>
        ) : null}
      </h3>
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}
