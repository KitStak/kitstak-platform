'use client';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from './cn';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export interface PopoverContentProps extends ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> {
  /** Remove default padding (for menus/pickers that manage their own layout). */
  readonly flush?: boolean;
}

export const PopoverContent = forwardRef<ElementRef<typeof PopoverPrimitive.Content>, PopoverContentProps>(
  function PopoverContent({ className, align = 'start', sideOffset = 6, flush, ...props }, ref) {
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={12}
          className={cn(
            'ks-popover-surface z-[var(--z-popover)] max-h-[var(--radix-popover-content-available-height)] overflow-auto outline-none',
            'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
            flush ? 'p-0' : 'p-3',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Portal>
    );
  },
);
