'use client';
import { forwardRef, useId, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Check, Minus } from 'lucide-react';
import { cn } from './cn';

export interface CheckboxProps extends ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  readonly label?: ReactNode;
  readonly description?: ReactNode;
  readonly size?: 'sm' | 'md';
}

export const Checkbox = forwardRef<ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(function Checkbox(
  { className, label, description, size = 'md', id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const box = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={inputId}
      className={cn(
        'peer inline-flex shrink-0 items-center justify-center rounded-xs border-[1.5px] border-border-strong bg-panel text-primary-fg',
        'transition-[background-color,border-color,box-shadow] duration-[var(--duration-instant)] ease-out',
        'hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        'data-[state=checked]:hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-[0.38]',
        size === 'sm' ? 'size-3.5' : 'size-4',
        // A touch screen gets a 24px box (and a 44px hit area from globals.css), a mouse keeps the small one.
        'pointer-coarse:size-6 pointer-coarse:[&_svg]:size-4',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="inline-flex data-[state=checked]:animate-pop-in">
        {props.checked === 'indeterminate' ? (
          <Minus aria-hidden strokeWidth={3} className="size-3" />
        ) : (
          <Check aria-hidden strokeWidth={3} className="size-3" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <div className="flex items-start gap-2">
      <span className="flex h-5 items-center pointer-coarse:h-6">{box}</span>
      <label htmlFor={inputId} className="cursor-pointer text-base text-fg peer-disabled:cursor-not-allowed peer-disabled:opacity-60">
        {label}
        {description ? <span className="block text-sm text-fg-muted">{description}</span> : null}
      </label>
    </div>
  );
});

export interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  readonly label?: ReactNode;
  readonly description?: ReactNode;
  readonly size?: 'sm' | 'md';
}

export const Switch = forwardRef<ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(function Switch(
  { className, label, description, size = 'md', id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const control = (
    <SwitchPrimitive.Root
      ref={ref}
      id={inputId}
      className={cn(
        'peer inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors duration-[var(--duration-fast)] ease-out',
        'bg-border-strong hover:bg-[var(--neutral-500)] data-[state=checked]:bg-primary data-[state=checked]:hover:bg-primary-hover',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-[0.38]',
        size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
        // On a touch screen every switch is 28 by 48px, with a 44px tall hit area (globals.css).
        'pointer-coarse:h-7 pointer-coarse:w-12',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block rounded-full bg-white shadow-sm transition-transform duration-[var(--duration-normal)] ease-[var(--ease-emphasized)]',
          size === 'sm' ? 'size-3 data-[state=checked]:translate-x-3' : 'size-4 data-[state=checked]:translate-x-4',
          'pointer-coarse:size-6 pointer-coarse:data-[state=checked]:translate-x-5',
        )}
      />
    </SwitchPrimitive.Root>
  );
  if (!label) return control;
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={inputId} className="cursor-pointer text-base text-fg">
        {label}
        {description ? <span className="block text-sm text-fg-muted">{description}</span> : null}
      </label>
      <span className="flex h-5 items-center pointer-coarse:h-7">{control}</span>
    </div>
  );
});
