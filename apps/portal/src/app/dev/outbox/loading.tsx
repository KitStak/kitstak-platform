import { Card, Skeleton } from '@/components/ui';

/** Skeleton in the final layout of the outbox, so nothing jumps when the emails arrive. */
export default function OutboxLoading() {
  return (
    <div role="status" aria-label="Loading emails" className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-2 h-8 w-48" />
        <Skeleton className="mt-3 h-5 w-full max-w-xl" />
      </div>
      <Skeleton className="h-11 w-full max-w-md" />
      <div className="grid items-start gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
        <Card as="div" className="flex flex-col gap-4 p-4">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row}>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-2 h-4 w-1/2" />
            </div>
          ))}
        </Card>
        <Card as="div" className="flex h-[520px] flex-col gap-4 p-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-2 h-full w-full" />
        </Card>
      </div>
      <span className="sr-only">Loading emails</span>
    </div>
  );
}
