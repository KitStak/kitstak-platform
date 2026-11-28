'use client';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from './cn';
import { Kbd } from './kbd';

export const TooltipProvider = TooltipPrimitive.Provider;

export const TooltipContent = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, children, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-[var(--z-tooltip)] max-w-xs rounded-sm bg-inverse px-2 py-1 text-xs font-medium text-fg-inverse shadow-sm',
          'data-[state=delayed-open]:animate-fade-in data-[state=instant-open]:animate-fade-in data-[state=closed]:animate-fade-out',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-[var(--surface-inverse)]" width={10} height={5} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});

export interface TooltipProps {
  readonly content: ReactNode;
  readonly children: ReactNode;
  /** Keyboard shortcut rendered as key caps after the text, e.g. ['⌘', 'K']. */
  readonly shortcut?: readonly string[];
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly align?: 'start' | 'center' | 'end';
  readonly delayDuration?: number;
  /** Skip rendering the tooltip (e.g. label already visible). */
  readonly disabled?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/**
 * Dark chip tooltip. The child must be a focusable element that forwards refs (Button,
 * IconButton, a, button).
 */
export function Tooltip({
  content,
  children,
  shortcut,
  side = 'bottom',
  align = 'center',
  delayDuration,
  disabled,
  open,
  onOpenChange,
}: TooltipProps) {
  if (disabled || content === null || content === undefined || content === '') return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration} open={open} onOpenChange={onOpenChange}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipContent side={side} align={align}>
        <span className="inline-flex items-center gap-2">
          <span>{content}</span>
          {shortcut && shortcut.length > 0 ? (
            <span className="inline-flex gap-0.5">
              {shortcut.map((key) => (
                <Kbd key={key} tone="inverse">
                  {key}
                </Kbd>
              ))}
            </span>
          ) : null}
        </span>
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
}
