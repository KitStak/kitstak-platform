'use client';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from './cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  readonly label?: ReactNode;
  readonly description?: ReactNode;
}

/** Native-input checkbox styled to the KitStak tokens (no Radix dependency in the portal). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, description, id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const box = (
    <span className="relative inline-flex size-4 shrink-0">
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className={cn(
          'peer size-4 appearance-none rounded-xs border-[1.5px] border-border-strong bg-panel',
          'transition-[background-color,border-color,box-shadow] duration-[var(--duration-instant)] ease-out',
          'hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          'checked:border-primary checked:bg-primary checked:hover:bg-primary-hover',
          'disabled:cursor-not-allowed disabled:opacity-[0.38]',
          className,
        )}
        {...props}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3 text-primary-fg opacity-0 peer-checked:opacity-100"
      />
    </span>
  );
  if (!label) return box;
  // One label around the box and the words: the whole row is the tap target, 44 px tall on touch screens.
  return (
    <label htmlFor={inputId} className="flex cursor-pointer items-start gap-2 pointer-coarse:min-h-11 pointer-coarse:items-center">
      <span className="flex h-5 items-center">{box}</span>
      <span className="text-base text-fg">
        {label}
        {description ? <span className="block text-sm text-fg-muted">{description}</span> : null}
      </span>
    </label>
  );
});
