import { Skeleton } from "@/components/ui/skeleton";

/**
 * Editor-shaped placeholder (server-safe): the real title, the Primary Information / Rules
 * panel and the canvas frame, so the shell paints at once instead of a generic grid skeleton.
 */
export function AlgorithmEditorSkeleton({ title }: { readonly title: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label={`Loading ${title}`}>
      <div className="flex items-center justify-between gap-3 px-6 pb-3 pt-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-48" />
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        </div>
        <div className="flex gap-2"><Skeleton className="h-8 w-28" /><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-16" /></div>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 px-6 pb-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-semibold text-foreground">Primary Information</p>
          <Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-40" />
          <p className="pt-2 text-sm font-semibold text-foreground">Rules</p>
          <Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" />
        </aside>
        <div className="min-h-[420px] rounded-xl border border-dashed border-border bg-surface-sunken/40" />
      </div>
    </div>
  );
}
