/**
 * Route-level skeleton for the analytics dashboards: page header, filter bar, KPI tile row
 * and 2-column chart cards — the same layout the data lands in, so nothing jumps.
 * Server-safe (no hooks).
 */
import { Skeleton } from '@/components/ui/card';

export function AnalyticsSkeleton() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col pb-10"
      aria-busy="true"
      aria-label="Loading dashboard"
      data-testid="analytics-skeleton"
    >
      <div className="px-6 pt-3">
        <Skeleton className="h-3 w-40 rounded" />
        <Skeleton className="mt-2 h-6 w-56 rounded" />
        <Skeleton className="mt-2 h-3 w-[min(520px,80%)] rounded" />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
        <Skeleton className="h-8 w-[150px] rounded-md" />
        <Skeleton className="h-8 w-[140px] rounded-md" />
        <Skeleton className="h-8 w-[140px] rounded-md" />
        <Skeleton className="h-8 w-[130px] rounded-md" />
        <Skeleton className="h-8 w-[120px] rounded-md" />
        <Skeleton className="ml-auto h-8 w-8 rounded-md" />
      </div>
      <div className="space-y-4 px-6 pt-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-surface px-4 py-3 shadow-xs">
              <Skeleton className="h-3 w-24 rounded" />
              <Skeleton className="mt-2 h-6 w-20 rounded" />
              <Skeleton className="mt-1.5 h-2.5 w-32 rounded" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-5 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Skeleton className="h-4 w-44 rounded" />
                  <Skeleton className="mt-1.5 h-3 w-64 rounded" />
                </div>
                <Skeleton className="h-7 w-7 rounded-md" />
              </div>
              <div className="mt-5 flex h-[240px] items-end gap-2">
                {[44, 70, 56, 88, 62, 36, 74, 50].map((h, j) => (
                  <div key={j} className="flex-1" style={{ height: `${h}%` }}>
                    <Skeleton className="h-full w-full rounded-t" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
