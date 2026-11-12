import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import { StaticSlowNotice } from './static-slow-notice';

/** Streaming fallback for the authenticated shell (header bar + page skeleton). */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-screen flex-col" aria-busy="true" aria-label="Loading">
      <div className="flex h-14 items-center justify-end gap-2 border-b border-border-subtle bg-panel px-4">
        <span className="hidden h-8 w-44 animate-pulse rounded-full bg-skeleton xl:block" />
        <span className="h-6 w-6 animate-pulse rounded-full bg-skeleton" />
      </div>
      <PageSkeleton />
    </div>
  );
}

/** Generic page skeleton: breadcrumb, title, toolbar, grid. */
export function PageSkeleton() {
  return (
    <div className="space-y-4 px-6 pt-4" aria-busy="true" aria-label="Loading">
      <StaticSlowNotice />
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-8 w-full max-w-[720px]" />
      <SkeletonTable rows={8} columns={6} />
    </div>
  );
}

/**
 * Heavy record routes (order / PO / product detail): mirrors the real page chrome so the
 * route never paints blank while the server component or client query loads — breadcrumb,
 * title + helper + action buttons, a tab / step strip, then the wide main column with the
 * sticky right rail. Token-styled (`bg-skeleton`), so it follows both themes.
 */
export function RecordDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 pt-4 sm:px-6" aria-busy="true" aria-label="Loading record">
      <StaticSlowNotice />
      <Skeleton className="h-3 w-48" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>
      <div className="flex items-center gap-6 border-b border-border-subtle pb-2.5 pt-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-56 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** Record detail skeleton: breadcrumb, title + actions, then a two-column card layout. */
export function DetailPageSkeleton() {
  return (
    <div className="space-y-4 px-6 pt-4" aria-busy="true" aria-label="Loading record">
      <StaticSlowNotice />
      <Skeleton className="h-3 w-48" />
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-6 w-56" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
