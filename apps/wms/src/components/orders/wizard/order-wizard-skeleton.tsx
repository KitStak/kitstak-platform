import { Skeleton } from '@/components/ui/skeleton';

const STEPS = 6;

/** Loading state shaped like the Create Shipment Order wizard: stepper, step form, side rail. */
export function OrderWizardSkeleton() {
  return (
    <div
      className="space-y-4 px-6 pt-4"
      aria-busy="true"
      aria-label="Loading order form"
      data-testid="order-wizard-skeleton"
    >
      <Skeleton className="h-3 w-48" />
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-6 w-60" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex items-center gap-3 overflow-hidden rounded-lg border border-border bg-surface px-4 py-3">
        {Array.from({ length: STEPS }, (_, i) => (
          <div key={i} className="flex min-w-0 flex-1 items-center gap-2">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <Skeleton className="h-3 w-full max-w-24" />
          </div>
        ))}
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <Skeleton className="h-4 w-40" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
