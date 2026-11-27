'use client';
/** Building blocks shared by every admin / profile / trash surface. */
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, CircleAlert, RotateCw } from 'lucide-react';
import { Badge, Button, cn, Skeleton } from '@/components/ui';
import type { OrgRole } from '@/server/rbac/permissions';
import { ROLE_LABEL, sortRows, type SortDirection, type SortState } from './format';

/** Page header inside the admin content column. */
export function SectionHeader({
  title,
  description,
  actions,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
      <div className="min-w-0 md:flex-1">
        <h2 className="text-xl font-semibold tracking-[-0.01em] text-fg">{title}</h2>
        {description ? <p className="mt-1 max-w-2xl text-base text-fg-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap">{actions}</div> : null}
    </header>
  );
}

/** Bordered settings card with an optional footer (Save bar). */
export function SettingsCard({
  title,
  description,
  aside,
  footer,
  children,
  className,
  padded = true,
  testId,
}: {
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly aside?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly padded?: boolean;
  readonly testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={cn('overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xs', className)}
    >
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-md font-semibold text-fg">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
          </div>
          {aside}
        </div>
      ) : null}
      <div className={padded ? 'px-5 py-5' : undefined}>{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle bg-sunken/60 px-5 py-3">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/** Label + description on the left, control on the right (stacks on mobile). */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  className,
}: {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly htmlFor?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-2 border-b border-border-subtle py-4 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] sm:items-center sm:gap-8',
        className,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-base font-medium text-fg">
            {label}
          </label>
        ) : (
          <p className="text-base font-medium text-fg">{label}</p>
        )}
        {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A role is an identity, not a state: one neutral pill for every role (UI-CLEANUP.md, "Pills"). */
export function RoleBadge({ role }: { readonly role: OrgRole }) {
  return <Badge>{ROLE_LABEL[role]}</Badge>;
}

/** Inline error panel with retry (never raw JSON). */
export function ErrorPanel({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  readonly title?: string;
  readonly message?: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-danger-subtle text-danger-text">
        <CircleAlert aria-hidden className="size-5" />
      </span>
      <div>
        <p className="text-md font-semibold text-fg">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-fg-muted">{message ?? 'Check your connection and try again.'}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" leadingIcon={<RotateCw aria-hidden />} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Skeleton for a settings card body (matches SettingRow rhythm, no layout shift). */
export function SettingsSkeleton({ rows = 3 }: { readonly rows?: number }) {
  return (
    <div data-skeleton aria-busy="true" aria-label="Loading" className="flex flex-col">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="grid gap-2 border-b border-border-subtle py-4 first:pt-0 last:border-b-0 sm:grid-cols-[1fr_1.25fr] sm:gap-8">
          <div className="flex flex-col gap-2">
            <Skeleton width="40%" height={12} rounded="full" />
            <Skeleton width="70%" height={10} rounded="full" />
          </div>
          <Skeleton height={32} rounded="sm" />
        </div>
      ))}
    </div>
  );
}

/** Table skeleton with fixed 52px rows. */
export function TableSkeleton({ rows = 6, columns = 4 }: { readonly rows?: number; readonly columns?: number }) {
  return (
    <div data-skeleton aria-busy="true" aria-label="Loading" className="divide-y divide-border-subtle">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex h-[52px] items-center gap-4 px-5" style={{ opacity: 1 - row * 0.1 }}>
          <Skeleton width={28} height={28} rounded="full" />
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} height={10} rounded="full" className="flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Small "demo / not available in this build" label. */
export function DemoBadge({ children = 'Demo' }: { readonly children?: ReactNode }) {
  return <Badge tone="warning">{children}</Badge>;
}

export const TABLE_HEAD =
  'h-9 px-4 text-left text-xs font-semibold whitespace-nowrap text-fg-muted first:pl-5 last:pr-5';
export const TABLE_CELL = 'px-4 py-2.5 align-middle first:pl-5 last:pr-5';
export const TABLE_ROW = 'border-b border-border-subtle transition-colors duration-[var(--duration-instant)] last:border-b-0 hover:bg-hover';

/**
 * Top-of-page title shared by Admin, Profile and Trash so H1 size, icon and rhythm match. The icon
 * sits in a plain outlined square in the muted icon color: no tint, never crimson (UI-CLEANUP.md).
 */
export function PageTitle({
  title,
  description,
  icon,
  actions,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-panel text-icon [&_svg]:size-5">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">{title}</h1>
          {description ? <p className="mt-0.5 text-base text-fg-secondary">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 md:shrink-0">{actions}</div> : null}
    </header>
  );
}

/** Client-side sort state for a table (`useTableSort(rows, accessors, initial)`). */
export function useTableSort<T, K extends string>(
  rows: readonly T[],
  accessors: Readonly<Record<K, (row: T) => string | number | null>>,
  initial: SortState<NoInfer<K>>,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const sorted = useMemo(() => sortRows(rows, accessors[sort.key], sort.direction), [rows, accessors, sort]);
  const toggle = (key: K) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: initial.key === key ? initial.direction : 'asc' },
    );
  return { sorted, sort, toggle, setSort };
}

/** Sortable `<th>`: a real button (keyboard operable) and `aria-sort` on the header cell. */
export function SortableHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  className,
  align = 'left',
}: {
  readonly label: string;
  readonly sortKey: K;
  readonly sort: { readonly key: K; readonly direction: SortDirection };
  readonly onSort: (key: K) => void;
  readonly className?: string;
  readonly align?: 'left' | 'right';
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(TABLE_HEAD, className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        data-testid={`sort-${sortKey}`}
        className={cn(
          'group -mx-1.5 inline-flex h-7 items-center gap-1 rounded-sm px-1.5 transition-colors duration-[var(--duration-instant)]',
          'hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed',
          active ? 'text-fg' : 'text-fg-muted',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {label}
        <Icon aria-hidden className={cn('size-3.5 shrink-0', active ? 'text-icon-strong' : 'text-icon opacity-60 group-hover:opacity-100')} />
      </button>
    </th>
  );
}
