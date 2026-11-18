import type { ReactNode } from 'react';
import { PageHeader, type PageHeaderProps } from '@/components/ui';
import { cn } from '@/components/ui/cn';

/** The one frame every page sits in. Wide screens center it; the title never moves between routes. */
export const PAGE_FRAME_MAX = 'max-w-[1680px]';

/**
 * Standard page frame for top-level routes: PageHeader (title, subtitle, actions, tabs) and a
 * padded body. Every route shares one frame, so the title sits in the same place on every page.
 * `width` only limits how wide the body may grow under the title: `narrow` for forms and short
 * reading pages (left aligned under the title, never centered), `default` and `full` use the frame.
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
    <div className={cn('mx-auto flex min-h-full w-full flex-col', PAGE_FRAME_MAX)} data-page-width={width}>
      <PageHeader {...header} />
      <div className={cn('w-full min-w-0 flex-1 px-6 py-5', width === 'narrow' && 'max-w-[880px]', bodyClassName)}>{children}</div>
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
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-subtle px-4 py-3">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
