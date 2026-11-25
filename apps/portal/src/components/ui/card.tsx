import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly as?: 'section' | 'div' | 'article';
}

/** The portal's panel surface: one border, one radius, one shadow. */
export function Card({ as: Tag = 'section', className, ...props }: CardProps) {
  return <Tag className={cn('rounded-xl border border-border-default bg-panel shadow-xs', className)} {...props} />;
}

/** Small caps label used above card values and section lists. */
export function Eyebrow({
  children,
  className,
  id,
  as: Tag = 'h2',
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly id?: string;
  readonly as?: 'h2' | 'h3' | 'p' | 'span';
}) {
  return (
    <Tag id={id} className={cn('text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase', className)}>
      {children}
    </Tag>
  );
}
