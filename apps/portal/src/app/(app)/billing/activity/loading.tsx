import { Card, Skeleton } from '@/components/ui';

/** Skeleton in the final layout of the activity list, so nothing jumps when the rows arrive. */
export default function ActivityLoading() {
  return (
    <div role="status" aria-label="Loading billing activity" className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-9 w-56" />
        <Skeleton className="mt-3 h-5 w-full max-w-xl" />
      </div>
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((tab) => (
          <Skeleton key={tab} className="h-11 w-28 rounded-full" />
        ))}
      </div>
      <div>
        <Skeleton className="mb-2 h-3 w-16" />
        <Card as="div" className="divide-y divide-border-subtle">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="flex items-start gap-4 px-5 py-3.5">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="mt-2 h-4 w-40" />
              </div>
            </div>
          ))}
        </Card>
      </div>
      <span className="sr-only">Loading billing activity</span>
    </div>
  );
}
