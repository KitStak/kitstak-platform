"use client";

/**
 * Return Orders (`/orders/returns`, M04 §6). One row per RMA line, the shared grid
 * (search mode, filters, chips, saved views, column chooser, density, page sizes,
 * async xlsx export), 5 status pills with live RMA counts, and the bulk actions
 * Change Status (legal transitions only), Tag and Create RMA.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Eye, History, Plus, ScanLine, Tag as TagIcon } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { ChangeLogDrawer, TagPopover } from "@/components/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { DisabledReason } from "@/components/ui/tooltip";
import { useApiQuery } from "@/lib/query-client";
import { RETURN_STATUSES, type ReturnStatus } from "@/lib/enums";
import { RETURN_ORDERS_GRID_KEY, RETURN_STATUS_HELP } from "@/lib/grid-defs/returns/return-orders";
import { statusTone } from "@/lib/status-colors";
import { cn } from "@/lib/utils";
import { ChangeStatusModal } from "./change-status-modal";
import { buildReturnColumns } from "./return-columns";
import { RETURN_KEYS, useInvalidateReturns, useReturnFilterFields, useHydratedCan } from "./returns-client";
import type { ReturnLineRow } from "./return-types";

export const RETURNS_HELPER = "Return orders (RMAs) track what customers send back, from the return label to receiving at the return station.";

function activeStatus(filters: readonly { field: string; op: string; values?: readonly string[] }[]): ReturnStatus | null {
  const f = filters.find((x) => x.field === "status" && x.op === "in");
  return f?.values?.length === 1 ? (f.values[0] as ReturnStatus) : null;
}

function StatusPills({ counts, active, onPick }: { readonly counts: Readonly<Record<string, number>> | undefined; readonly active: ReturnStatus | null; readonly onPick: (s: ReturnStatus | null) => void }) {
  const total = Object.values(counts ?? {}).reduce((s, n) => s + n, 0);
  return (
    <div role="toolbar" aria-label="Filter by status" className="flex flex-wrap items-center gap-1.5 px-6 pb-2">
      <button type="button" aria-pressed={active === null} onClick={() => onPick(null)}
        className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          active === null ? "border-foreground bg-foreground text-surface" : "border-border bg-surface text-body hover:bg-surface-sunken")}>
        All <span className="tabular-nums opacity-70">{counts ? total.toLocaleString() : "…"}</span>
      </button>
      {RETURN_STATUSES.map((s) => {
        const t = statusTone(s, "return");
        const tone = { background: t.bg, color: t.fg };
        const on = active === s;
        return (
          <button key={s} type="button" aria-pressed={on} title={RETURN_STATUS_HELP[s]} onClick={() => onPick(on ? null : s)}
            className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              on ? "shadow-sm ring-1 ring-current" : "border-transparent hover:brightness-95")}
            style={{ background: tone.background, color: tone.color, borderColor: on ? tone.color : "transparent" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.color }} aria-hidden />
            {s}
            <span className="tabular-nums opacity-80">{counts ? (counts[s] ?? 0).toLocaleString() : "…"}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ReturnOrdersPage() {
  const router = useRouter();
  const invalidate = useInvalidateReturns();
  const fields = useReturnFilterFields();
  const g = useGrid<ReturnLineRow>({ gridKey: RETURN_ORDERS_GRID_KEY, path: "/api/returns", fields });
  const columns = React.useMemo(() => buildReturnColumns(), []);
  const summary = useApiQuery<Record<string, number>>(RETURN_KEYS.summary, "/api/returns/summary", { staleTime: 0 });
  const can = {
    status: useHydratedCan("inventory.return_orders.change_status").allowed,
    tag: useHydratedCan("inventory.return_orders.tag").allowed,
    create: useHydratedCan("fulfillment.shipment_orders.create_rma").allowed,
    station: useHydratedCan("inventory.return_station.view").allowed,
    log: useHydratedCan("inventory.return_orders.view").allowed,
  };

  // Rows selected on earlier pages stay known so bulk actions still see them after paging.
  const [seen, setSeen] = React.useState<ReadonlyMap<string, ReturnLineRow>>(() => new Map());
  const rows = g.rows;
  React.useEffect(() => {
    if (rows.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- merges the grid's server page into the cross-page selection cache
    setSeen((prev) => (rows.every((r) => prev.get(r.id) === r) ? prev : new Map([...prev, ...rows.map((r) => [r.id, r] as const)])));
  }, [rows]);
  const selected = g.selectedIds.map((id) => seen.get(id) ?? g.rows.find((r) => r.id === id)).filter((r): r is ReturnLineRow => Boolean(r));
  const rmaIds = [...new Set(selected.map((r) => r.returnOrderId))];

  const [statusFor, setStatusFor] = React.useState<{ ids?: readonly string[]; lineIds?: readonly string[]; version?: number } | null>(null);
  const [logFor, setLogFor] = React.useState<ReturnLineRow | null>(null);

  const finish = async () => {
    g.clearSelection();
    await invalidate();
  };

  const status = activeStatus(g.grid.query.filters as never);
  const pick = (s: ReturnStatus | null) => {
    if (s) g.grid.upsertFilter({ field: "status", op: "in", values: [s] });
    else g.grid.removeFilter("status");
  };

  const rowActions = (row: ReturnLineRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, href: `/orders/returns/${row.returnOrderId}` },
    ...(can.status ? [{
      key: "status", label: "Change status", icon: ArrowRightLeft,
      disabledReason: row.status === "Completed" || row.status === "Cancelled" ? `${row.status} returns can't be changed.` : null,
      onSelect: () => setStatusFor({ ids: [row.returnOrderId], version: row.version }),
    }] : []),
    ...(can.log ? [{ key: "log", label: "Change log", icon: History, onSelect: () => setLogFor(row) }] : []),
  ];

  const none = selected.length === 0 && !g.allMatchingSelected ? "Select at least one return line" : null;
  const allTerminal = selected.length > 0 && selected.every((r) => r.status === "Completed" || r.status === "Cancelled");
  const statusReason = none ?? (g.allMatchingSelected ? "Select rows on this page to change their status" : allTerminal ? "Completed and cancelled returns can't be changed" : null);
  const tagReason = none ?? (g.allMatchingSelected ? "Select rows on this page to tag them" : null);

  const trailing = (
    <div className="flex items-center gap-2">
      {can.status ? (
        <DisabledReason reason={statusReason}>
          <Button variant="secondary" disabled={Boolean(statusReason)} onClick={() => setStatusFor({ ids: rmaIds })}>
            <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
            Change status
          </Button>
        </DisabledReason>
      ) : null}
      {can.tag ? (
        <TagPopover entityType="return_order" scope="return_order" ids={rmaIds} onApplied={() => void finish()} disabledReason={tagReason}
          trigger={<Button variant="secondary" disabled={Boolean(tagReason)}><TagIcon className="h-3.5 w-3.5" aria-hidden />Tag</Button>} />
      ) : null}
    </div>
  );

  const actions = (
    <>
      {can.station ? (
        <Link href="/return-station" className={buttonVariants({ variant: "secondary" })}>
          <ScanLine className="h-3.5 w-3.5" aria-hidden />
          Return station
        </Link>
      ) : null}
      {can.create ? (
        <Link href="/orders/returns/new" className={buttonVariants({ variant: "primary" })}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create RMA
        </Link>
      ) : null}
    </>
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Return Orders" tabs="orders" helper={RETURNS_HELPER} actions={actions} />
      <StatusPills counts={summary.data?.data} active={status} onPick={pick} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by RMA, order, tracking or SKU" bulkNoun="return line" trailing={trailing} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<ReturnLineRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          onRowClick={(row) => router.push(`/orders/returns/${row.returnOrderId}`)}
          emptyTitle={status ? `No ${status.toLowerCase()} returns` : "No return orders match this view"}
          emptyDescription="Clear the filters, or create an RMA from a shipped order."
          emptyAction={can.create ? <Link href="/orders/returns/new" className={buttonVariants({ variant: "primary" })}><Plus className="h-3.5 w-3.5" aria-hidden />Create RMA</Link> : undefined}
        />
      </div>
      <ChangeStatusModal open={statusFor !== null} onOpenChange={(o) => !o && setStatusFor(null)} selection={statusFor ?? {}} version={statusFor?.version} onDone={() => void finish()} />
      {logFor ? <ChangeLogDrawer open onOpenChange={(o) => !o && setLogFor(null)} entityType="return_order" entityId={logFor.returnOrderId} entityCode={logFor.rmaCode} /> : null}
    </div>
  );
}
