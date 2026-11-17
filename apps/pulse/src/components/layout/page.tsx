import type { ReactNode } from 'react';
import { PageHeader, type PageHeaderProps } from '@/components/ui';
import { cn } from '@/components/ui/cn';

/**
 * Standard page frame for top-level routes: PageHeader (title, subtitle, actions, tabs) and a
 * padded body. `width="full"` for views that use the whole canvas (board, table, timeline).
 */
export function Page({
  children,
  width = 'default',
  bodyClassName,
  ...header
}: PageHeaderProps & {
  readonly children: ReactNode;
  readonly width?: 'default' | 'narrow' | 'full';
  readonly bodyClassName?: string;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader {...header} className={cn(width !== 'full' && 'mx-auto w-full', width === 'default' && 'max-w-[1240px]', width === 'narrow' && 'max-w-[880px]', header.className)} />
      <div
        className={cn(
          'flex-1 px-6 py-5',
          width === 'default' && 'mx-auto w-full max-w-[1240px]',
          width === 'narrow' && 'mx-auto w-full max-w-[880px]',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Section card used on Home, Overview and Settings. */
export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  readonly title?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-border-subtle bg-panel shadow-xs', className)}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
