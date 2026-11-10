"use client";

/**
 * Streaming fallback for the M02 list pages: the real page header (breadcrumb, title, helper,
 * tabs) renders in the static shell, so the page reads as loaded while the URL-driven grid
 * (useSearchParams) hydrates behind it. Only the toolbar and rows are skeletons. A page that opens
 * on a default filter (Carrier shipment details: "Label create date: Last 30 days") shows that chip
 * in the first paint, so the shell never misrepresents the scope.
 */
import type { PageTabGroupKey } from "@/config/page-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

export interface FallbackChip {
  readonly label: string;
  readonly value: string;
}

export function ShipListFallback({ title, helper, tabs, chips = [] }: { readonly title: string; readonly helper?: string; readonly tabs?: PageTabGroupKey; readonly chips?: readonly FallbackChip[] }) {
  return (
    <div className="flex flex-col" aria-busy="true">
      <PageHeader title={title} helper={helper} tabs={tabs} />
      <div className="space-y-3 px-6 pt-4" aria-label={`Loading ${title}`}>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-8 w-24" />
          {chips.map((c) => (
            <span key={c.label} className="inline-flex h-9 shrink-0 flex-col items-start justify-center rounded-lg border border-primary/30 bg-primary-soft py-0.5 pl-2.5 pr-3 leading-tight" title={`${c.label}: ${c.value}`}>
              <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.04em] text-primary/80">{c.label}</span>
              <span className="whitespace-nowrap text-[12px] font-medium text-foreground">{c.value}</span>
            </span>
          ))}
          <Skeleton className="ml-auto h-8 w-40" />
        </div>
        <SkeletonTable rows={10} columns={8} />
        <div className="flex items-center gap-3 text-[12px] text-secondary">
          <Skeleton className="h-7 w-24" />
          <span className="inline-flex h-7 w-[128px] items-center rounded-md border border-border px-2 text-[11px] font-medium">Show 100 items</span>
          <span>Total: <span className="font-semibold text-foreground">—</span></span>
        </div>
      </div>
    </div>
  );
}
