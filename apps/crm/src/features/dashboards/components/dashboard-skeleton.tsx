/** First-paint skeleton matching the dashboard layout (header, toolbar, KPI row, charts). */
import { Skeleton } from '@/components/ui';

const BLOCKS = [
  { col: 'col-span-12 sm:col-span-6 xl:col-span-3', h: 208 },
  { col: 'col-span-12 sm:col-span-6 xl:col-span-3', h: 208 },
  { col: 'col-span-12 sm:col-span-6 xl:col-span-3', h: 208 },
  { col: 'col-span-12 sm:col-span-6 xl:col-span-3', h: 208 },
  { col: 'col-span-12 xl:col-span-8', h: 488 },
  { col: 'col-span-12 xl:col-span-4', h: 488 },
];

export function DashboardSkeleton() {
  return (
    <div className="h-full overflow-hidden bg-sunken" data-skeleton aria-busy="true" aria-label="Loading dashboard">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex items-start gap-4">
          <Skeleton width={40} height={40} rounded="lg" className="hidden sm:block" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton width={280} height={32} rounded="md" />
            <Skeleton width={420} height={16} />
          </div>
          <Skeleton width={96} height={32} rounded="sm" />
        </div>
        <div className="flex gap-2 py-2">
          {[132, 150, 176, 96, 120].map((width, index) => (
            <Skeleton key={index} width={width} height={32} rounded="sm" />
          ))}
        </div>
        <div className="grid grid-cols-12 gap-4">
          {BLOCKS.map((block, index) => (
            <div key={index} className={`${block.col} flex flex-col gap-3 rounded-lg border border-border-subtle bg-panel p-4`} style={{ height: block.h }}>
              <Skeleton width="45%" height={18} />
              <Skeleton height="100%" rounded="md" className="flex-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
