import * as React from 'react';
import { cn } from '@/lib/utils';

const COLUMNS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4',
} as const;

/** Responsive field grid: 1 column under 768px, `columns` from there up. */
export function FormGrid({
  columns = 2,
  className,
  children,
}: {
  readonly columns?: keyof typeof COLUMNS;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return <div className={cn('grid gap-x-4 gap-y-3.5', COLUMNS[columns], className)}>{children}</div>;
}

/** Spans the full width of a FormGrid row. */
export function FormGridFull({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return <div className={cn('col-span-full', className)}>{children}</div>;
}
