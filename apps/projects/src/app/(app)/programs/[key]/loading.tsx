import { Skeleton } from '@/components/ui';

/** Shaped like the program frame and an overview: header, tabs, KPI row and two panels. */
export default function ProgramLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Loading program">
      <div className="shrink-0 border-b border-border-subtle bg-panel px-4 pt-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Skeleton width={32} height={32} rounded="md" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton width={220} height={22} />
            <Skeleton width={360} height={12} />
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Skeleton width={120} height={32} rounded="md" />
            <Skeleton width={110} height={32} rounded="md" />
          </div>
        </div>
        <div className="mt-4 flex gap-4 pb-3">
          {[72, 56, 64, 72, 64, 52, 56].map((width, index) => (
            <Skeleton key={index} width={width} height={14} />
          ))}
        </div>
      </div>
      <div className="mx-auto grid w-full max-w-[1240px] gap-4 p-4 sm:p-6 lg:grid-cols-[1.65fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} height={84} rounded="lg" />
            ))}
          </div>
          <Skeleton height={280} rounded="lg" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton height={160} rounded="lg" />
          <Skeleton height={200} rounded="lg" />
        </div>
      </div>
    </div>
  );
}
