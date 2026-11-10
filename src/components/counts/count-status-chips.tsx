"use client";

/**
 * Status chips above a count grid: one chip per status with its live total. Clicking a
 * chip filters the grid to that status (`f.status=in:<status>`); clicking it again clears
 * the filter. KitStaks addition: Logiwa only offers the status filter in the popover.
 */
import { Lock } from "lucide-react";
import { KpiChip, type KpiTone } from "@/components/ui/kpi-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/lib/query-client";
import type { GridUrlState } from "@/lib/use-url-state";

interface Summary {
  readonly total: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly locked: number;
}

const TONE: Readonly<Record<string, KpiTone>> = {
  Pending: "neutral",
  "Ready To Count": "primary",
  "Count Started": "primary",
  "Count Completed": "success",
  "Inventory Updated": "success",
  "Recount Created": "success",
  Cancelled: "danger",
};

export function CountStatusChips({ kind, statuses, grid }: { readonly kind: "plans" | "locations" | "skus"; readonly statuses: readonly string[]; readonly grid: GridUrlState }) {
  const summary = useApiQuery<Summary>(["count-summary", kind], `/api/counts/summary`, { query: { kind } });
  const current = grid.query.filters.find((f) => f.field === "status");
  const activeValues = current && current.op === "in" ? current.values : [];
  const only = activeValues.length === 1 ? activeValues[0] : null;
  const data = summary.data?.data;

  const toggle = (status: string) => {
    if (only === status) grid.removeFilter("status");
    else grid.upsertFilter({ field: "status", op: "in", values: [status] });
  };

  if (summary.isPending) {
    return (
      <div className="flex flex-wrap items-center gap-2 px-6 pt-3" aria-hidden>
        {statuses.map((s) => <Skeleton key={s} className="h-7 w-28 rounded-full" />)}
      </div>
    );
  }
  if (!data) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 pt-3" role="group" aria-label="Filter by status">
      <KpiChip label="All" value={data.total.toLocaleString()} active={!current} onClick={() => grid.removeFilter("status")} />
      {statuses.map((s) => (
        <KpiChip key={s} label={s} value={(data.byStatus[s] ?? 0).toLocaleString()} tone={TONE[s] ?? "neutral"} active={only === s} onClick={() => toggle(s)} />
      ))}
      {data.locked > 0 ? (
        <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-secondary">
          <Lock className="h-3.5 w-3.5 text-warning" aria-hidden />
          <strong className="font-semibold tabular-nums text-foreground">{data.locked}</strong> {kind === "plans" ? (data.locked === 1 ? "plan is" : "plans are") : (data.locked === 1 ? "line is" : "lines are")} locking locations
        </span>
      ) : null}
    </div>
  );
}
