import { Card, Skeleton } from '@/components/ui';

/** Skeleton in the final layout of billing home, so nothing jumps when the numbers arrive. */
export default function BillingLoading() {
  return (
    <div role="status" aria-label="Loading billing" className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-9 w-48" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <Card as="div" key={card} className="flex h-[212px] flex-col gap-3 p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-auto h-10 w-full" />
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card as="div" className="flex h-[320px] flex-col gap-4 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </Card>
        <Card as="div" className="flex h-[320px] flex-col gap-4 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </Card>
      </div>
      <span className="sr-only">Loading billing</span>
    </div>
  );
}
