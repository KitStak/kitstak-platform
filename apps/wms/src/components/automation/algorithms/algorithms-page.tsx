"use client";

/**
 * Algorithms list (`/automation/algorithms/putaway|allocation`, spec 06 §2): route tabs, grid with
 * Name link · Type · Warehouse · Active pill · Rule quantity, bulk Delete + Test Algorithm (putaway),
 * row ⋯ Edit · Test / Dry run · Change log · Delete (system and in-use algorithms explain why not).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlaskConical, History, Pencil, Plus, Repeat2, Trash2 } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { DisabledReason, Tooltip } from "@/components/ui/tooltip";
import { ALGORITHM_FIELDS, ALGORITHMS_GRID_KEY, type AlgorithmSlug } from "@/lib/grid-defs/integrations/algorithms";
import type { AlgorithmRow } from "@/server/repositories/algorithms";
import { DateTimeText, EntityChangeLogDrawer, NO_PERMISSION, toastBulk, toFilterFields, useAction, usePagePerms, useWarehouseOptions, type BulkResponse } from "@/components/integrations/shared/shared";
import { PutawayTestDialog, type PutawayTestTarget } from "./putaway-test-dialog";
import { DryRunDialog, type DryRunTarget } from "./dry-run-dialog";

const PERMS = ["view", "create", "edit", "delete", "change_log", "test"] as const;

export function AlgorithmsPage({ slug }: { readonly slug: AlgorithmSlug }) {
  const router = useRouter();
  const isPutaway = slug === "putaway";
  const perms = usePagePerms("automation.algorithms", PERMS);
  const warehouses = useWarehouseOptions();
  const fields = React.useMemo(() => toFilterFields(ALGORITHM_FIELDS.filter((f) => isPutaway || f.field !== "isDynamicReplenishment"), { warehouseId: warehouses.short }), [warehouses.short, isPutaway]);
  const extraQuery = React.useMemo(() => ({ kind: slug }), [slug]);
  const g = useGrid<AlgorithmRow>({ gridKey: `${ALGORITHMS_GRID_KEY}-${slug}`, path: "/api/algorithms", fields, extraQuery });
  const [toDelete, setToDelete] = React.useState<readonly AlgorithmRow[] | null>(null);
  const [log, setLog] = React.useState<AlgorithmRow | null>(null);
  const [test, setTest] = React.useState<PutawayTestTarget | null>(null);
  const [dry, setDry] = React.useState<DryRunTarget | null>(null);
  const action = useAction([["grid", `${ALGORITHMS_GRID_KEY}-${slug}`]]);
  const editHref = (id: string) => `/automation/algorithms/${slug}/${id}`;
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));

  const COLUMNS: GridColumnDef<AlgorithmRow>[] = [
    { id: "name", header: "Name", size: 300, meta: { alwaysVisible: true }, cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-2">
        <Link href={editHref(row.original.id)} className="truncate font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.name}</Link>
        {row.original.isSystem ? <Badge size="sm" tone="neutral">System</Badge> : null}
        {row.original.isDynamicReplenishment ? <Tooltip content="Used for dynamic replenishment; never for putaway"><span><Badge size="sm" tone="info" icon={Repeat2}>Replenishment</Badge></span></Tooltip> : null}
      </span>
    ) },
    { id: "kind", header: "Type", size: 110, enableSorting: false, cell: ({ row }) => row.original.kind },
    { id: "warehouseCode", header: "Warehouse", size: 110, cell: ({ row }) => row.original.warehouseCode },
    { id: "status", header: "Active", size: 100, cell: ({ row }) => <StatusPill status={row.original.status} domain="active" /> },
    { id: "ruleCount", header: "Rule quantity", size: 120, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.ruleCount}</div> },
    { id: "updatedAt", header: "Last updated", size: 170, meta: { defaultVisible: false }, cell: ({ row }) => <DateTimeText value={row.original.updatedAt} /> },
  ];

  const bulkActions: readonly BulkAction[] = [
    ...(isPutaway ? [{
      key: "test", label: "Test Algorithm", icon: FlaskConical, onSelect: (ids: readonly string[]) => {
        const row = selected(ids)[0];
        if (row) setTest({ algorithmId: row.id, name: row.name, warehouseId: row.warehouseId });
      },
      disabledReason: perms.test ? null : NO_PERMISSION, eligibility: (ids: readonly string[]) => (ids.length === 1 ? null : "Select exactly one algorithm to test"),
    } satisfies BulkAction] : []),
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setToDelete(selected(ids)), disabledReason: perms.delete ? null : NO_PERMISSION },
  ];

  const rowActions = (row: AlgorithmRow): readonly RowAction[] => [
    { key: "edit", label: perms.edit ? "Edit" : "Open", icon: Pencil, onSelect: () => router.push(editHref(row.id)) },
    isPutaway
      ? { key: "test", label: "Test algorithm", icon: FlaskConical, onSelect: () => setTest({ algorithmId: row.id, name: row.name, warehouseId: row.warehouseId }), disabledReason: perms.test ? null : NO_PERMISSION }
      : { key: "dry", label: "Dry run for order", icon: FlaskConical, onSelect: () => setDry({ algorithmId: row.id, name: row.name, warehouseId: row.warehouseId }), disabledReason: perms.test ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row), disabledReason: perms.change_log ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToDelete([row]), disabledReason: !perms.delete ? NO_PERMISSION : row.inUse },
  ];

  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const createHref = `/automation/algorithms/${slug}/new`;
  const kindLabel = isPutaway ? "putaway" : "allocation";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Algorithms" tabs="algorithms" helper="You can view a list of your algorithms and create new ones here."
        actions={perms.create ? <Button variant="primary" onClick={() => router.push(createHref)}><Plus className="h-4 w-4" aria-hidden />Create {isPutaway ? "Putaway" : "Allocation"} Algorithm</Button> : undefined} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by name" bulkActions={bulkActions} bulkNoun="algorithm" />
      <DataGrid<AlgorithmRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={(r) => router.push(editHref(r.id))}
        emptyTitle={filtered ? `No ${kindLabel} algorithms match these filters` : `No ${kindLabel} algorithms yet`}
        emptyDescription={filtered ? "Clear a filter or search for another name." : `Create a ${kindLabel} algorithm to control ${isPutaway ? "where stock is put away" : "which stock orders reserve"}.`}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={() => router.push(createHref)}><Plus className="h-4 w-4" />Create {kindLabel} algorithm</Button> : undefined}
      />
      <PutawayTestDialog target={test} onOpenChange={(o) => !o && setTest(null)} />
      <DryRunDialog target={dry} onOpenChange={(o) => !o && setDry(null)} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/algorithms/${log.id}/change-log` : null} title={`Change log · ${log?.name ?? ""}`} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title={`Delete ${toDelete?.length === 1 ? `algorithm ${toDelete[0]?.name}` : `${toDelete?.length ?? 0} algorithms`}?`}
        description="System algorithms, the last active replenishment algorithm and algorithms used by job types are skipped and listed in the result."
        confirmLabel="Yes, delete"
        cancelLabel="No"
        records={{ columns: [{ key: "name", label: "Algorithm" }, { key: "warehouse", label: "Warehouse" }, { key: "note", label: "Note" }], rows: (toDelete ?? []).map((r) => ({ name: r.name, warehouse: r.warehouseCode, note: r.inUse ?? "Will be deleted" })) }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>("/api/algorithms/bulk-delete", "POST", { ids: (toDelete ?? []).map((r) => r.id) });
          if (result) { toastBulk(result, "algorithm", "deleted"); g.clearSelection(); }
          setToDelete(null);
        }}
      />
    </div>
  );
}
