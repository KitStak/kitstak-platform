"use client";

/**
 * Billing Report (`/billing/reports`): bills grid, bulk Approve / Cancel, row ⋯ View ·
 * Edit info · Change log · Delete (Draft only). Failed calculations show their error.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, Eye, History, Pencil, Trash2 } from "lucide-react";
import { DataGrid, GridToolbar, LinkCell, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { BILLING_REPORT_FIELDS, BILLING_REPORTS_GRID_KEY } from "@/lib/grid-defs/organization/billing-reports";
import type { ReportRow } from "@/server/repositories/billing-reports";
import { EntityChangeLogDrawer, NO_PERMISSION, toastBulk, toFilterFields, useAction, useClientOptions, usePagePerms, useWarehouseOptions, type BulkResponse } from "@/components/facility/facility-shared";
import { BillInfoDialog, type BillInfoTarget } from "./bill-info-dialog";
import { BillingPill, FREQUENCY_LABELS, moneyGrid } from "./billing-shared";

const PERMS = ["view", "delete", "approve", "cancel"] as const;
const day = (v: string) => v.slice(0, 10);
const dt = (v: string) => new Date(v).toLocaleString("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

const COLUMNS: GridColumnDef<ReportRow>[] = [
  { id: "contractName", header: "Name", size: 250, cell: ({ row }) => <LinkCell href={`/billing/${row.original.contractId}`}>{row.original.contractName}</LinkCell> },
  { id: "billNumber", header: "Billing number", size: 140, meta: { alwaysVisible: true }, cell: ({ row }) => <LinkCell href={`/billing/reports/${row.original.id}`}><span className="font-mono">{row.original.billNumber}</span></LinkCell> },
  { id: "calcStatus", header: "Calculation status", size: 150, cell: ({ row }) => (row.original.calcStatus === "Failed" ? <Tooltip content={row.original.errorMessage ?? "Calculation failed"}><span><BillingPill status="Failed" /></span></Tooltip> : <BillingPill status="Successful" />) },
  { id: "clientName", header: "Client", size: 160, cell: ({ row }) => row.original.clientName },
  { id: "warehouseCode", header: "Warehouse", size: 100, cell: ({ row }) => row.original.warehouseCode },
  { id: "calculatedAt", header: "Calculation date", size: 180, cell: ({ row }) => <span className="tabular-nums">{dt(row.original.calculatedAt)}</span> },
  { id: "createdByName", header: "Created by", size: 140, cell: ({ row }) => row.original.createdByName ?? <span className="text-faint">Scheduler</span> },
  { id: "periodStart", header: "Period start", size: 120, cell: ({ row }) => <span className="tabular-nums">{day(row.original.periodStart)}</span> },
  { id: "periodEnd", header: "Period end", size: 120, cell: ({ row }) => <span className="tabular-nums">{day(row.original.periodEnd)}</span> },
  { id: "frequency", header: "Billing frequency", size: 140, enableSorting: false, meta: { defaultVisible: false }, cell: ({ row }) => FREQUENCY_LABELS[row.original.frequency] ?? row.original.frequency },
  { id: "billStatus", header: "Bill status", size: 120, cell: ({ row }) => <BillingPill status={row.original.billStatus} /> },
  { id: "totalPrice", header: "Price", size: 140, meta: { align: "right" }, cell: ({ row }) => <div className="text-right font-semibold tabular-nums">{moneyGrid(row.original.totalPrice, row.original.currency)}</div> },
  { id: "exportedToIntegration", header: "Exported", size: 100, enableSorting: false, meta: { defaultVisible: false }, cell: ({ row }) => (row.original.exportedToIntegration ? "Yes" : "No") },
];

type Pending = { readonly kind: "approve" | "cancel" | "delete"; readonly rows: readonly ReportRow[] } | null;

export function BillingReportsPage() {
  const router = useRouter();
  const perms = usePagePerms("settings.billing_report", PERMS);
  const warehouses = useWarehouseOptions();
  const clients = useClientOptions();
  const fields = React.useMemo(() => toFilterFields(BILLING_REPORT_FIELDS, { warehouseId: warehouses.short, clientId: clients }), [warehouses.short, clients]);
  const g = useGrid<ReportRow>({ gridKey: BILLING_REPORTS_GRID_KEY, path: "/api/billing-reports", fields });
  const [pending, setPending] = React.useState<Pending>(null);
  const [info, setInfo] = React.useState<BillInfoTarget | null>(null);
  const [log, setLog] = React.useState<ReportRow | null>(null);
  const action = useAction([["grid", BILLING_REPORTS_GRID_KEY]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const bulkActions: readonly BulkAction[] = [
    { key: "approve", label: "Approve", icon: CheckCircle2, onSelect: (ids) => setPending({ kind: "approve", rows: selected(ids) }), disabledReason: perms.approve ? null : NO_PERMISSION,
      eligibility: (ids) => (selected(ids).every((r) => r.billStatus !== "Draft" || r.calcStatus === "Failed") ? "Only successful draft bills can be approved" : null) },
    { key: "cancel", label: "Cancel", icon: Ban, onSelect: (ids) => setPending({ kind: "cancel", rows: selected(ids) }), disabledReason: perms.cancel ? null : NO_PERMISSION,
      eligibility: (ids) => (selected(ids).every((r) => r.billStatus === "Canceled") ? "Every selected bill is already canceled" : null) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setPending({ kind: "delete", rows: selected(ids) }), disabledReason: perms.delete ? null : NO_PERMISSION,
      eligibility: (ids) => (selected(ids).every((r) => r.billStatus !== "Draft") ? "Only draft bills can be deleted" : null) },
  ];
  const rowActions = (row: ReportRow): readonly RowAction[] => [
    { key: "view", label: "View", icon: Eye, href: `/billing/reports/${row.id}` },
    { key: "edit", label: "Edit info", icon: Pencil, onSelect: () => setInfo(row), disabledReason: !perms.approve ? NO_PERMISSION : row.billStatus === "Canceled" ? "Canceled bills are final" : null },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setPending({ kind: "delete", rows: [row] }), disabledReason: !perms.delete ? NO_PERMISSION : row.billStatus !== "Draft" ? `${row.billStatus} bills can't be deleted` : null },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const META = {
    approve: { title: "Approve", verb: "approved", path: "/api/billing-reports/approve", variant: "info" as const, description: "Approved bills can't be deleted and lock their period's VAS operations." },
    cancel: { title: "Cancel", verb: "canceled", path: "/api/billing-reports/cancel", variant: "attention" as const, description: "Canceled bills are final; calculate the period again to replace them." },
    delete: { title: "Delete", verb: "deleted", path: "/api/billing-reports/bulk-delete", variant: "danger" as const, description: "Only draft bills are deleted; approved and canceled bills are skipped." },
  };
  const meta = pending ? META[pending.kind] : null;
  const count = pending?.rows.length ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Billing Report" tabs="billing" helper="Every calculated bill with its period, status and total. Approve bills to lock them for invoicing." />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search billing name or number" bulkActions={bulkActions} bulkNoun="bill" />
      <DataGrid<ReportRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} rowActions={rowActions} onRowClick={(r) => router.push(`/billing/reports/${r.id}`)}
        emptyTitle={filtered ? "No bills match these filters" : "No bills yet"}
        emptyDescription={filtered ? "Clear a filter or search for another number." : "Calculate a billing form in 3PL Billing to create the first bill."} />
      <BillInfoDialog bill={info} onOpenChange={(o) => !o && setInfo(null)} onSaved={() => g.refetch()} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/billing-reports/${log.id}/change-log` : null} title={`Change log · ${log?.billNumber ?? ""}`} />
      <ConfirmDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)} variant={meta?.variant ?? "info"}
        title={`${meta?.title ?? ""} ${count === 1 ? `bill ${pending?.rows[0]?.billNumber}` : `${count} bills`}?`} description={meta?.description} confirmLabel="Yes" cancelLabel="No"
        records={{ columns: [{ key: "n", label: "Bill" }, { key: "c", label: "Client" }, { key: "s", label: "Status" }, { key: "t", label: "Total" }], rows: (pending?.rows ?? []).map((r) => ({ n: r.billNumber, c: r.clientName, s: r.billStatus, t: moneyGrid(r.totalPrice, r.currency) })) }}
        onConfirm={async () => {
          if (!pending || !meta) return;
          const result = await action.run<BulkResponse>(meta.path, "POST", { ids: pending.rows.map((r) => r.id) });
          if (result) { toastBulk(result, "bill", meta.verb); g.clearSelection(); }
          setPending(null);
        }} />
    </div>
  );
}
