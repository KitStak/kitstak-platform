import { Skeleton } from '@/components/ui';

/** Content-surface skeleton shown while a page in the org streams in (the shell stays put). */
export default function OrgLoading() {
  return (
    <div aria-busy="true" aria-label="Loading page" className="flex flex-col gap-6 p-8">
      <div className="flex items-center gap-3">
        <Skeleton width={40} height={40} rounded="lg" />
        <div className="flex flex-col gap-2">
          <Skeleton width={220} height={16} rounded="full" />
          <Skeleton width={140} height={10} rounded="full" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton width={96} height={28} rounded="md" />
        <Skeleton width={80} height={28} rounded="md" />
        <Skeleton width={88} height={28} rounded="md" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} height={36} rounded="sm" style={{ opacity: 1 - index * 0.09 }} />
        ))}
      </div>
    </div>
  );
}
