'use client';

import * as React from 'react';
import { Count } from '@kitstak/ui/dashboard';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface HeaderIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly label: string;
  readonly badge?: number;
  /** Animated dot (e.g. a background task is running). */
  readonly pulse?: boolean;
}

/** Round icon button in the header, with a tooltip and an optional neutral count. */
export const HeaderIconButton = React.forwardRef<HTMLButtonElement, HeaderIconButtonProps>(
  ({ label, badge, pulse, className, children, ...props }, ref) => (
    <Tooltip content={label} side="bottom">
      <button
        ref={ref}
        type="button"
        className={cn(
          'relative flex h-8 w-8 items-center justify-center rounded-full text-fg-secondary outline-none transition-colors',
          'hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-pressed data-[state=open]:text-fg',
          className,
        )}
        {...props}
      >
        {/* Named by content: sr-only label, then the visible badge, so the name contains the visible text. */}
        <span className="sr-only">{label}</span>
        {children}
        {/* An unread count is neutral (UI-CLEANUP "Pills" rule 6): the shared Count, with a ring cut out of the icon. */}
        {badge ? (
          <span className="absolute -right-1 -top-1 flex rounded-full ring-2 ring-panel">
            <Count value={badge} placement="icon" />
          </span>
        ) : null}
        {pulse && !badge ? (
          <span
            className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-success"
            aria-hidden
          />
        ) : null}
      </button>
    </Tooltip>
  ),
);
HeaderIconButton.displayName = 'HeaderIconButton';
