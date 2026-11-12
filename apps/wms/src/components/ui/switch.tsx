'use client';

import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export interface SwitchProps extends Omit<
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>,
  'onChange'
> {
  readonly label?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly size?: 'sm' | 'md';
}

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  ({ className, label, description, size = 'md', id, ...props }, ref) => {
    const autoId = React.useId();
    const switchId = id ?? autoId;
    const control = (
      <SwitchPrimitive.Root
        ref={ref}
        id={switchId}
        className={cn(
          'peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none',
          'bg-border-strong hover:bg-faint data-[state=checked]:bg-primary data-[state=checked]:hover:bg-primary-hover',
          'focus-visible:ring-2 focus-visible:ring-focus/35 focus-visible:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-45',
          size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'pointer-events-none block rounded-full bg-white shadow-sm transition-transform',
            size === 'sm'
              ? 'h-3 w-3 translate-x-0.5 data-[state=checked]:translate-x-3.5'
              : 'h-4 w-4 translate-x-0.5 data-[state=checked]:translate-x-[18px]',
          )}
        />
      </SwitchPrimitive.Root>
    );
    if (!label) return control;
    return (
      <div className="flex items-start gap-2.5">
        <div className="pt-px">{control}</div>
        <div className="flex flex-col">
          <label
            htmlFor={switchId}
            className="cursor-pointer text-sm font-medium text-body peer-disabled:cursor-not-allowed"
          >
            {label}
          </label>
          {description ? <span className="text-2xs leading-4 text-faint">{description}</span> : null}
        </div>
      </div>
    );
  },
);
Switch.displayName = 'Switch';
