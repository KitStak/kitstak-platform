/** Route-level loading skeletons for the catalog pages (server-safe, no hooks). */
import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

export function ListPageSkeleton({ title }: { readonly title: string }) {
  return (
    <div className="flex flex-col gap-4 px-6 pt-4" aria-busy="true" aria-label={`Loading ${title}`}>
      <Skeleton className="h-3 w-40" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-48" />
        <div className="flex gap-2"><Skeleton className="h-8 w-40" /><Skeleton className="h-8 w-40" /></div>
      </div>
      <Skeleton className="h-8 w-full" />
      <SkeletonTable rows={10} columns={8} />
    </div>
  );
}
