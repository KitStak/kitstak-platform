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
        'peer relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent',
        'bg-border-strong transition-colors duration-[var(--duration-fast)] ease-out motion-reduce:transition-none',
        'data-[state=checked]:bg-primary',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:cursor-not-allowed disabled:opacity-[0.38]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-5 translate-x-0.5 rounded-full bg-panel shadow-sm',
          'transition-transform duration-[var(--duration-fast)] ease-out motion-reduce:transition-none',
          'data-[state=checked]:translate-x-[22px]',
        )}
      />
    </SwitchPrimitive.Root>
  );
});
