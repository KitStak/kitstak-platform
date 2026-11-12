'use client';
import { cn } from '@/components/ui';

export interface SwitchProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/** 40×24 toggle (32×18 small): knob slides 120ms; focus-visible ring; 0.38 opacity when disabled. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  size = 'md',
  className,
  ...rest
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-state={checked ? 'checked' : 'unchecked'}
      data-testid={rest['data-testid']}
      onClick={(event) => {
        event.stopPropagation();
        onCheckedChange(!checked);
      }}
      className={cn(
        'group relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:cursor-not-allowed disabled:opacity-[0.38]',
        size === 'md' ? 'h-6 w-10' : 'h-[18px] w-8',
        checked
          ? 'bg-primary hover:bg-primary-hover active:bg-primary-active'
          : 'bg-icon hover:bg-icon-strong active:bg-icon-strong',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none block rounded-full bg-primary-fg shadow-xs transition-transform duration-[var(--duration-fast)] ease-[var(--ease-standard)] group-active:scale-95',
          size === 'md' ? 'size-4 translate-x-[3px]' : 'size-3 translate-x-[2px]',
          checked && (size === 'md' ? 'translate-x-[19px]' : 'translate-x-[15px]'),
        )}
      />
    </button>
  );
}
