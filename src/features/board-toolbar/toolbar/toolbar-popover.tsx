'use client';

/**
 * A toolbar control: a ghost button that turns `--primary-selected` when its state is active
 * (with a count badge), opening a popover. In the compact toolbar the control lives in the
 * "…" menu: it renders no trigger, and its popover anchors to the overflow button instead.
 */
import { forwardRef, type ReactNode } from 'react';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger, Tooltip, cn } from '@/components/ui';

export type ToolbarDisplay = 'full' | 'icon' | 'menu';

export interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: ReactNode;
  readonly label: string;
  /** Visible text (defaults to `label`). */
  readonly text?: ReactNode;
  readonly active?: boolean;
  readonly badge?: ReactNode;
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
        'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-transparent text-base whitespace-nowrap outline-none select-none',
        'transition-[background-color,color,border-color] duration-[var(--duration-instant)] ease-out [&_svg]:size-4 [&_svg]:shrink-0',
        'hover:bg-hover active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:pointer-events-none disabled:opacity-[0.38] data-[state=open]:bg-selected',
        iconOnly ? 'w-8 justify-center' : 'px-2.5',
        active
          ? 'bg-primary-selected text-primary-text hover:bg-primary-selected-hover data-[state=open]:bg-primary-selected-hover'
          : 'text-fg',
        className,
      )}
      {...props}
    >
      {icon}
      {iconOnly ? null : <span>{text ?? label}</span>}
      {badge !== undefined && badge !== null && badge !== 0 ? (
        <span
          className={cn(
            'inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs leading-4 font-semibold text-primary-fg tabular-nums',
            iconOnly && 'absolute -top-1 -right-1 ring-2 ring-[var(--surface-panel)]',
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
});

/** Tooltip for icon-only controls (wraps a Radix trigger, which forwards props and refs). */
export function MaybeTooltip({ show, label, children }: { readonly show: boolean; readonly label: string; readonly children: ReactNode }) {
  return show ? (
    <Tooltip content={label} side="bottom">
      {children}
    </Tooltip>
  ) : (
    <>{children}</>
  );
}

export interface ToolbarPopoverProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly display: ToolbarDisplay;
  readonly icon: ReactNode;
  readonly label: string;
  readonly text?: ReactNode;
  readonly active?: boolean;
  readonly badge?: ReactNode;
  readonly testId: string;
  readonly width?: number;
  readonly title: string;
  readonly children: ReactNode;
  readonly align?: 'start' | 'end';
}

export function ToolbarPopover({
  open,
  onOpenChange,
  display,
  icon,
  label,
  text,
  active,
  badge,
  testId,
  width = 360,
  title,
  children,
  align = 'start',
}: ToolbarPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {display === 'menu' ? (
        <PopoverAnchor asChild>
          <span aria-hidden className="pointer-events-none absolute right-2 bottom-0 size-0" />
        </PopoverAnchor>
      ) : (
        <MaybeTooltip show={display === 'icon'} label={label}>
          <PopoverTrigger asChild>
            <ToolbarButton
              icon={icon}
              label={label}
              text={text}
              active={active}
              badge={badge}
              iconOnly={display === 'icon'}
              data-testid={`toolbar-${testId}`}
            />
          </PopoverTrigger>
        </MaybeTooltip>
      )}
      <PopoverContent
        align={display === 'menu' ? 'end' : align}
        flush
        aria-label={title}
        data-testid={`${testId}-popover`}
        style={{ width: `min(${width}px, calc(100vw - 24px))` }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function PanelHeader({ title, aside }: { readonly title: string; readonly aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
      <h2 className="min-w-0 flex-1 truncate font-heading text-md font-semibold text-fg">{title}</h2>
      {aside}
    </div>
  );
}
