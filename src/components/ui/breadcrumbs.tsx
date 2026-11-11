import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from './cn';

export interface BreadcrumbItem {
  readonly label: string;
  readonly href?: string;
  readonly icon?: ReactNode;
}

export interface BreadcrumbsProps {
  readonly items: readonly BreadcrumbItem[];
  readonly className?: string;
}

/** Compact trail; the last item is the current page (aria-current). */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-xs text-fg-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          const content = (
            <>
              {item.icon}
              <span className="truncate">{item.label}</span>
            </>
          );
          return (
            <li key={`${item.label}-${index}`} className={cn('flex min-w-0 items-center gap-1', last && 'shrink')}>
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="inline-flex min-w-0 items-center gap-1 rounded-xs px-1 py-0.5 transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-3.5"
                >
                  {content}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={cn('inline-flex min-w-0 items-center gap-1 px-1 [&_svg]:size-3.5', last && 'font-medium text-fg')}
                >
                  {content}
                </span>
              )}
              {last ? null : <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-muted" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
