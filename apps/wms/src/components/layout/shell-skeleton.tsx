import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";
import { StaticSlowNotice } from "./static-slow-notice";

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
