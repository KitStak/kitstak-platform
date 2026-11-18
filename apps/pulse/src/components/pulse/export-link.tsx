'use client';
import type { ReactNode } from 'react';
import { Download } from 'lucide-react';
import { buttonVariants, type ButtonSize, type ButtonVariant } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';

/**
 * "Export CSV" for a list that is one of the data streams (target pace, goals, labor rates and so
 * on). It downloads `/api/v1/export/<stream>.csv`, the same file the Export page gives, in the
 * template columns, so it can be changed in a spreadsheet and imported back.
 *
 *   <ExportStreamLink stream="target_pace" />
 */
export function ExportStreamLink({
  stream,
  children = 'Export CSV',
  variant = 'secondary',
  size = 'md',
  className,
  testId,
}: {
  readonly stream: string;
  readonly children?: ReactNode;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <a href={`/api/v1/export/${stream}.csv`} download data-testid={testId ?? `export-${stream}`} className={cn(buttonVariants({ variant, size }), 'no-underline', className)}>
      <Download aria-hidden />
      {children}
    </a>
  );
}
