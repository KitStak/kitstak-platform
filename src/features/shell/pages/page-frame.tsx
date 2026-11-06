/**
 * Shared chrome for top-level shell destinations (Inbox, My work, workspace overview, admin…):
 * an icon tile, title, description, optional actions and a content area with consistent rhythm.
 */
import type { ReactNode } from 'react';
import { cn, type BreadcrumbItem } from '@/components/ui';
import { PageCrumbs } from './page-crumbs';

export interface PageFrameProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  /** Tile tint (CSS color); defaults to the primary subtle surface. */
  readonly iconColor?: string;
  /** `solid` = primary tile with primary-fg icon (feature hubs such as Automations). */
  readonly iconTone?: 'subtle' | 'solid';
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly width?: 'default' | 'wide';
  /** Custom breadcrumb trail; defaults to Home › title. Pass `false` to hide it. */
  readonly breadcrumbs?: readonly BreadcrumbItem[] | false;
}

export function PageFrame({
  title,
  description,
  icon,
  iconColor,
  iconTone = 'subtle',
  actions,
  children,
  width = 'default',
  breadcrumbs,
}: PageFrameProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div
        className={cn(
          'mx-auto flex flex-col gap-8 px-4 py-6 sm:px-8 sm:py-8',
          width === 'wide' ? 'max-w-[1440px]' : 'max-w-[1120px]',
        )}
      >
        {breadcrumbs === false ? null : (
          <div className="-mb-4">
            <PageCrumbs title={title} items={breadcrumbs} />
          </div>
        )}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className={cn('flex min-w-0 gap-3', iconTone === 'solid' ? 'items-start' : 'items-center')}>
            {icon ? (
              <span
                aria-hidden
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5',
                  iconTone === 'solid'
                    ? 'bg-primary text-primary-fg shadow-sm'
                    : 'bg-primary-subtle text-primary-text',
                )}
                style={iconColor ? { background: iconColor, color: 'var(--text-inverse)' } : undefined}
              >
                {icon}
              </span>
            ) : null}
            <div className="min-w-0">
              <h1 className="truncate font-heading text-2xl font-semibold tracking-[-0.01em] text-fg">{title}</h1>
              {description ? <p className="mt-0.5 text-base text-fg-secondary">{description}</p> : null}
            </div>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
        {children}
      </div>
    </div>
  );
}

/** Bordered surface used to group a page section. */
export function PageSection({
  title,
  aside,
  children,
  className,
}: {
  readonly title?: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-border-subtle bg-panel shadow-xs', className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
          <h2 className="font-heading text-md font-semibold text-fg">{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}
