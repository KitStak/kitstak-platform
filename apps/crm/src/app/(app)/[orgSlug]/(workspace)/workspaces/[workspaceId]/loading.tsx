import { Skeleton } from '@/components/ui';

/** Workspace overview skeleton (same frame as the loaded page, so nothing shifts). */
export default function WorkspaceLoading() {
  return (
    <div className="h-full overflow-y-auto" aria-busy="true" aria-label="Loading workspace">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-5 sm:px-8 sm:py-6">
        <Skeleton width={220} height={14} />
        <div className="flex items-center gap-5">
          <Skeleton width={64} height={64} rounded="lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton width="40%" height={28} />
            <Skeleton width="60%" height={14} />
          </div>
        </div>
        <Skeleton height={36} width={260} />
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} height={44} rounded="md" />
        ))}
      </div>
    </div>
  );
}
