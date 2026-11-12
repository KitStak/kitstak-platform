import { Card, Skeleton } from '@/components/ui/card';

function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Card className={className}>{children}</Card>;
}

function HeaderLines() {
  return (
    <div className="px-5 pt-4 pb-3">
      <Skeleton className="h-4 w-40 rounded" />
      <Skeleton className="mt-2 h-3 w-56 rounded" />
    </div>
  );
}

function MetricRow() {
  return (
    <div className="py-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-28 rounded" />
        <Skeleton className="h-3.5 w-16 rounded" />
      </div>
      <Skeleton className="mt-2 h-1 w-full rounded-full" />
    </div>
  );
}

/** Route-level skeleton mirroring the dashboard card layout to avoid layout shift. */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Page header */}
      <div className="px-6 pt-3">
        <Skeleton className="h-3 w-32 rounded" />
        <div className="mt-2 flex items-center justify-between">
          <Skeleton className="h-6 w-36 rounded" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-16 rounded-md" />
            <Skeleton className="h-8 w-[196px] rounded-md" />
            <Skeleton className="h-8 w-[150px] rounded-md" />
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-4 px-6 pb-8 pt-4">
        {/* Progress + donut row */}
        <div className="grid gap-4 lg:grid-cols-3">
          <CardShell>
            <HeaderLines />
            <div className="mx-5 rounded-lg bg-surface-sunken p-4">
              <Skeleton className="h-3.5 w-24 rounded" />
              <Skeleton className="mt-3 h-2 w-full rounded-full" />
              <div className="mt-2 flex justify-between">
                <Skeleton className="h-3 w-12 rounded" />
                <Skeleton className="h-3 w-12 rounded" />
              </div>
            </div>
            <div className="px-5 pb-4">
              <MetricRow />
              <MetricRow />
              <MetricRow />
            </div>
          </CardShell>
          <CardShell className="lg:col-span-2">
            <HeaderLines />
            <div className="flex items-center gap-8 px-6 pb-5">
              <Skeleton className="h-44 w-44 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-3">
                <Skeleton className="h-3 w-full rounded" />
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-4 w-full rounded" />
              </div>
            </div>
          </CardShell>
        </div>
        {/* Status breakdown */}
        <CardShell>
          <HeaderLines />
          <div className="grid grid-cols-2 gap-x-10 gap-y-3 px-6 pb-5 md:grid-cols-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-3.5 w-full rounded" />
            ))}
          </div>
        </CardShell>
        {/* Rank cards */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardShell key={i}>
              <div className="flex items-start gap-3 px-5 pt-4 pb-3">
                <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-24 rounded" />
                  <Skeleton className="mt-1.5 h-3 w-full rounded" />
                </div>
              </div>
              <div className="mx-5 mb-4 space-y-3 border-t border-border pt-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-6 w-full rounded" />
                ))}
              </div>
            </CardShell>
          ))}
        </div>
        {/* Jobs card */}
        <CardShell>
          <HeaderLines />
          <div className="border-b border-border px-5 pb-2">
            <div className="flex gap-5">
              <Skeleton className="h-3 w-14 rounded" />
              <Skeleton className="h-3 w-14 rounded" />
              <Skeleton className="h-3 w-14 rounded" />
            </div>
          </div>
          <div className="space-y-2.5 px-5 py-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </div>
        </CardShell>
      </div>
    </div>
  );
}
