import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';
import type { ReactNode } from 'react';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold uppercase tracking-[0.06em]',
  {
    variants: {
      tone: {
        neutral: 'border-border-default bg-sunken text-fg-secondary',
        success: 'border-success/25 bg-success-subtle text-success-text',
        warning: 'border-warning/25 bg-warning-subtle text-warning-text',
        danger: 'border-danger/25 bg-danger-subtle text-danger-text',
        info: 'border-info/25 bg-info-subtle text-info-text',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  readonly children: ReactNode;
  readonly className?: string;
  /** Native tooltip, e.g. to explain a read-only state. */
  readonly title?: string;
}

export function Badge({ tone, children, className, title }: BadgeProps) {
  return (
    <span title={title} className={cn(badgeVariants({ tone }), className)}>
      {children}
    </span>
  );
}
