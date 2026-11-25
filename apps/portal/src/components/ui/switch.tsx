'use client';
/** A real switch (role="switch") on Radix Switch, styled to the KitStak tokens. */
import { Switch as SwitchPrimitive } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from './cn';

export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        // Off: the track is `--control-outline`, 3 to 1 or more against the card around it and against the
        // knob, in light and dark (WCAG 1.4.11). On: brand red.
        // The button is the touch target; the track is drawn inside it (`before`). With a mouse the
        // two are the same size. On touch screens the button is 44 px tall and the track stays 24 px.
        'peer group/switch relative inline-flex h-6 w-11 shrink-0 items-center rounded-full pointer-coarse:h-11',
        'before:absolute before:inset-x-0 before:top-1/2 before:h-6 before:-translate-y-1/2 before:rounded-full before:bg-control',
        'before:transition-colors before:duration-[var(--duration-fast)] before:ease-out motion-reduce:before:transition-none',
        'data-[state=checked]:before:bg-primary',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:cursor-not-allowed disabled:opacity-[0.38]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none relative block size-5 translate-x-0.5 rounded-full bg-panel shadow-sm',
          'transition-transform duration-[var(--duration-fast)] ease-out motion-reduce:transition-none',
          'data-[state=checked]:translate-x-[22px]',
        )}
      />
    </SwitchPrimitive.Root>
  );
});
