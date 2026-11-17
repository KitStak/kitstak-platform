'use client';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as ScrollPrimitive from '@radix-ui/react-scroll-area';
import { cn } from './cn';

export interface ScrollAreaProps extends ComponentPropsWithoutRef<typeof ScrollPrimitive.Root> {
  readonly orientation?: 'vertical' | 'horizontal' | 'both';
  readonly viewportClassName?: string;
}

/** Overlay scrollbars that appear on hover/scroll, consistent across platforms. */
export const ScrollArea = forwardRef<ElementRef<typeof ScrollPrimitive.Viewport>, ScrollAreaProps>(function ScrollArea(
  { className, viewportClassName, orientation = 'vertical', children, type = 'hover', ...props },
  ref,
) {
  return (
    <ScrollPrimitive.Root type={type} className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollPrimitive.Viewport ref={ref} className={cn('size-full rounded-[inherit]', viewportClassName)}>
        {children}
      </ScrollPrimitive.Viewport>
      {orientation !== 'horizontal' ? <ScrollBar orientation="vertical" /> : null}
      {orientation !== 'vertical' ? <ScrollBar orientation="horizontal" /> : null}
      <ScrollPrimitive.Corner />
    </ScrollPrimitive.Root>
  );
});

function ScrollBar({ orientation }: { readonly orientation: 'vertical' | 'horizontal' }) {
  return (
    <ScrollPrimitive.Scrollbar
      orientation={orientation}
      className={cn(
        'z-[var(--z-raised)] flex touch-none p-0.5 transition-opacity duration-[var(--duration-fast)] select-none',
        'data-[state=hidden]:opacity-0 data-[state=visible]:opacity-100',
        orientation === 'vertical' ? 'h-full w-2.5' : 'h-2.5 flex-col',
      )}
    >
      <ScrollPrimitive.Thumb className="relative flex-1 rounded-full bg-border-strong hover:bg-[var(--neutral-500)]" />
    </ScrollPrimitive.Scrollbar>
  );
}
