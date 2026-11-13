import type { ReactNode } from 'react';
import { cn } from './cn';
import { Breadcrumbs, type BreadcrumbItem } from './breadcrumbs';

export interface PageHeaderProps {
  readonly breadcrumbs?: readonly BreadcrumbItem[];
  readonly title: string;
  /** Visual shown before the H1 (entity icon). */
  readonly icon?: ReactNode;
  /** One-line helper sentence under the H1. */
  readonly subtitle?: ReactNode;
  /** Primary and secondary actions, right-aligned. */
  readonly actions?: ReactNode;
  /** Tab strip rendered flush under the header (board view tabs, page sections). */
  readonly tabs?: ReactNode;
  readonly className?: string;
}

/**
 * Page chrome shared with KitStak WMS: breadcrumb, H1 (24px semibold), a one-line muted subtitle,
 * actions on the right, optional tabs underneath.
 */
export function PageHeader({ breadcrumbs, title, icon, subtitle, actions, tabs, className }: PageHeaderProps) {
  return (
    <header className={cn('pt-3', className)}>
      <div className="px-6">
        {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} className="-ml-1" /> : null}
        <div className="mt-1.5 flex min-h-8 flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-full sm:basis-0">
            <div className="flex min-w-0 items-center gap-2">
              {icon}
              <h1 className="truncate text-xl font-semibold tracking-[-0.01em] text-fg">{title}</h1>
            </div>
            {subtitle ? <p className="mt-0.5 max-w-[720px] text-sm text-fg-muted sm:truncate">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </div>
      {tabs ? <div className="mt-2 px-6">{tabs}</div> : null}
    </header>
  );
}
