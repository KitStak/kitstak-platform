/**
 * Shared class recipes for form controls so every input-like primitive has the same
 * density (13px type, 32px default height, 6px radius), shared with KitStak CRM, hover, focus, invalid and disabled states.
 */
import { cva, type VariantProps } from 'class-variance-authority';

export const controlVariants = cva(
  [
    'w-full rounded-md border bg-panel text-sm text-fg placeholder:text-fg-placeholder',
    'transition-[border-color,box-shadow,background-color] duration-150',
    'border-border-input hover:border-border-input-hover',
    'focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--focus-ring-soft)]',
    'focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--focus-ring-soft)]',
    'aria-[invalid=true]:border-danger aria-[invalid=true]:hover:border-danger aria-[invalid=true]:focus-visible:ring-danger/20',
    'data-[invalid=true]:border-danger data-[invalid=true]:focus-within:ring-danger/20',
    'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-faint disabled:hover:border-border-input',
    'data-[disabled=true]:cursor-not-allowed data-[disabled=true]:bg-surface-sunken data-[disabled=true]:text-faint',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'h-7 px-2 text-xs',
        md: 'h-8 px-2.5',
        lg: 'h-10 px-3',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export type ControlSize = NonNullable<VariantProps<typeof controlVariants>['size']>;

/** Floating panels (popover, menu, select content). */
export const panelClass =
  'z-50 rounded-lg border border-border-default bg-raised text-fg shadow-popover outline-none';

/** Menu / listbox rows. */
export const itemClass =
  'relative flex w-full cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg outline-none ' +
  'transition-colors data-[highlighted]:bg-hover data-[highlighted]:text-fg ' +
  'data-[disabled]:cursor-not-allowed data-[disabled]:text-faint data-[disabled]:opacity-70 data-[disabled]:hover:bg-transparent';

export const labelClass = 'text-xs font-medium text-fg-secondary';
export const helpTextClass = 'text-2xs leading-4 text-fg-muted';
export const errorTextClass = 'text-2xs leading-4 font-medium text-danger-text';
