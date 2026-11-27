'use client';
/**
 * View toolbar controls (same anatomy as the CRM board toolbar): a ghost button that turns
 * primary-selected when its state is active, with an optional count badge, and a popover
 * variant. Used by the filter bar and each view's layout controls.
 */
import { forwardRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, Tooltip, cn } from '@/components/ui';

export interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: ReactNode;
  readonly label: string;
  /** Visible text (defaults to `label`). */
  readonly text?: ReactNode;
  readonly active?: boolean;
  readonly badge?: number;
  readonly iconOnly?: boolean;
}

export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton(
  { icon, label, text, active, badge, iconOnly, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={iconOnly ? label : undefined}
      data-active={active || undefined}
      className={cn(
        'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-transparent text-sm whitespace-nowrap outline-none select-none',
        'transition-[background-color,color,border-color] duration-[var(--duration-instant)] ease-out [&_svg]:size-4 [&_svg]:shrink-0',
        'hover:bg-hover active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:pointer-events-none disabled:opacity-[0.38] data-[state=open]:bg-selected',
        iconOnly ? 'w-8 justify-center' : 'px-2.5',
        active
          ? 'bg-primary-selected text-fg hover:bg-primary-selected-hover data-[state=open]:bg-primary-selected-hover'
          : 'text-fg',
        className,
      )}
      {...props}
    >
      {icon}
      {iconOnly ? null : <span className="max-w-48 truncate">{text ?? label}</span>}
      {badge ? (
        <span
          className={cn(
            'inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1 text-2xs leading-4 font-semibold text-fg-secondary tabular-nums',
            iconOnly && 'absolute -top-1 -right-1 ring-2 ring-[var(--surface-panel)]',
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
});

export interface ToolbarPopoverProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly text?: ReactNode;
  readonly active?: boolean;
  readonly badge?: number;
  readonly iconOnly?: boolean;
  readonly width?: number;
  readonly align?: 'start' | 'center' | 'end';
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** Shows a small clear (x) affordance next to an active control. */
  readonly onClear?: () => void;
  readonly testId?: string;
  readonly children: ReactNode;
}

export function ToolbarPopover({ icon, label, text, active, badge, iconOnly, width = 280, align = 'start', open, onOpenChange, onClear, testId, children }: ToolbarPopoverProps) {
  const trigger = (
    <PopoverTrigger asChild>
      <ToolbarButton icon={icon} label={label} text={text} active={active} badge={badge} iconOnly={iconOnly} data-testid={testId} className={cn(onClear && active && 'rounded-r-none pr-2')} />
    </PopoverTrigger>
  );
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <span className="inline-flex shrink-0 items-center">
        {iconOnly ? (
          <Tooltip content={label} side="bottom">
            {trigger}
          </Tooltip>
        ) : (
          trigger
        )}
        {onClear && active ? (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={onClear}
            className="inline-flex h-8 w-6 items-center justify-center rounded-r-sm bg-primary-selected text-fg outline-none hover:bg-primary-selected-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </span>
      <PopoverContent flush align={align} style={{ width }} className="max-w-[calc(100vw-24px)]">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Thin vertical divider between toolbar groups. */
export function ToolbarDivider({ className }: { readonly className?: string }) {
  return <span aria-hidden className={cn('mx-0.5 h-5 w-px shrink-0 bg-border-subtle', className)} />;
}
