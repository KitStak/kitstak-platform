import type { ReactNode } from 'react';
import { cn } from './cn';

export interface CardProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/** Flat panel: 8px radius and a 1px border. Depth comes from the surface step, not a shadow. */
export function Card({ children, className }: CardProps) {
  return <div className={cn('rounded-lg border border-border-subtle bg-panel', className)}>{children}</div>;
}

export interface CardHeaderProps {
  readonly title: string;
  readonly description?: ReactNode;
  /** Right-aligned control (button, menu, filter). */
  readonly action?: ReactNode;
  readonly className?: string;
}

export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-4 pb-3', className)}>
      <div className="min-w-0">
        <h3 className="text-md font-semibold text-fg">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
