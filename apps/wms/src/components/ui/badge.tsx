import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap font-medium', {
  variants: {
    tone: {
      neutral: 'bg-muted text-fg-secondary',
      primary: 'bg-primary-subtle text-primary-text',
      success: 'bg-success-subtle text-success-text',
      warning: 'bg-warning-subtle text-warning-text',
      danger: 'bg-danger-subtle text-danger-text',
      info: 'bg-info-subtle text-info-text',
      solid: 'bg-primary text-primary-fg',
      outline: 'border border-border-default bg-transparent text-fg-secondary',
    },
    size: {
      sm: 'h-[18px] rounded-sm px-1.5 text-2xs',
      md: 'h-5 rounded-sm px-2 text-xs',
    },
    shape: { rounded: '', pill: 'rounded-full' },
  },
  defaultVariants: { tone: 'neutral', size: 'md', shape: 'rounded' },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  readonly icon?: React.ComponentType<{ className?: string }>;
}

/** Generic label/count badge. Statuses use `StatusPill` instead. */
export function Badge({ className, tone, size, shape, icon: Icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size, shape }), className)} {...props}>
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {children}
    </span>
  );
}
