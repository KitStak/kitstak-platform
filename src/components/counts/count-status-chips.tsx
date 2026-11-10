"use client";

/**
 * Status chips above a count grid: one chip per status with its live total. Clicking a
 * chip filters the grid to that status (`f.status=in:<status>`); clicking it again clears
 * the filter. KitStaks addition: Logiwa only offers the status filter in the popover.
 */
import * as React from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { KpiChip } from "@/components/ui/kpi-chip";
import { statusLabel } from "@/lib/status-colors";
import { countToneOf } from "./count-status-pill";
import { cn } from "@/lib/utils";
import { useApiQuery } from "@/lib/query-client";
import { COUNT_QUERY_TIMEOUT_MS } from "./counts-client";
import type { GridUrlState } from "@/lib/use-url-state";

interface Summary {
  readonly total: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly locked: number;
}

/**
 * One status chip. Label casing (statusLabel) and dot colour (statusTone, count domain)
 * come from the same source as the grid StatusPill and the detail badge, so a chip and
 * the pills it filters always match.
 */
function StatusChip({ status, value, active, onClick }: { readonly status: string; readonly value: string; readonly active: boolean; readonly onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        active ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-body")}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: countToneOf(status, "count").fg }} aria-hidden />
      <span className="text-secondary">{statusLabel(status)}</span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </button>
  );
}

export function CountStatusChips({ kind, statuses, grid, gridFetching }: { readonly kind: "plans" | "locations" | "skus"; readonly statuses: readonly string[]; readonly grid: GridUrlState; readonly gridFetching?: boolean }) {
  const summary = useApiQuery<Summary>(["count-summary", kind], `/api/counts/summary`, { query: { kind }, timeoutMs: COUNT_QUERY_TIMEOUT_MS });
  /* Refetch the totals each time the grid finishes a (re)fetch so the "All" chip and the grid Total never drift apart. */
  const wasFetching = React.useRef(false);
  const { refetch } = summary;
  React.useEffect(() => {
    if (wasFetching.current && !gridFetching) void refetch();
    wasFetching.current = Boolean(gridFetching);
  }, [gridFetching, refetch]);
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
      <div className="flex h-10 items-center gap-2 px-6 pt-3 text-[12px] text-secondary" role="status" aria-live="polite">
        <Spinner className="h-3.5 w-3.5" />Loading status totals…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-10 items-center gap-2 px-6 pt-3 text-[12px] text-secondary" role="alert">
        <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden />Status totals could not be loaded.
        <Button size="sm" variant="ghost" onClick={() => void summary.refetch()}>Retry</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 pt-3" role="group" aria-label="Filter by status">
      <KpiChip label="All" value={data.total.toLocaleString()} active={!current} onClick={() => grid.removeFilter("status")} />
      {statuses.map((s) => (
        <StatusChip key={s} status={s} value={(data.byStatus[s] ?? 0).toLocaleString()} active={only === s} onClick={() => toggle(s)} />
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
