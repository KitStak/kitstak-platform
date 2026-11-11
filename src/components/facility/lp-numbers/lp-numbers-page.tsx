"use client";

/**
 * LP Numbers (`/settings/lp-numbers`, LP tab group): grid (search defaults to Starts With),
 * header Import LP Number + Create LP Number, bulk Print barcode (one print modal) and Delete,
 * row ⋯ Show details · Edit · Change log · Print barcode · Delete.
 *
 * Delete (critic R5): never-used Empty LPs are deleted, Empty LPs with history are voided
 * (status Removed, kept for the audit trail), and LPs holding stock, nested on a parent, with
 * child LPs or shipped are refused. The confirm dialog previews the outcome per LP.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, History, Pencil, Plus, Printer, Trash2, Upload } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { DataGrid, GridToolbar, LinkCell, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { PrintOptionsModal } from "@/components/shared/print-options-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/lib/query-client";
import { LP_NUMBER_FIELDS, LP_NUMBERS_GRID_KEY } from "@/lib/grid-defs/facility/lp-numbers";
import type { LpNumberDetail, LpNumberRow, LpRemovalPreview } from "@/server/repositories/lp-numbers";
import { lpLabelTitle, lpRowRemovalBlocker } from "@/lib/grid-defs/facility/lp-numbers";
import { CodeCell, DetailList, EntityChangeLogDrawer, Muted, NO_PERMISSION, Num, StatRow, toFilterFields, useAction, usePagePerms, useWarehouseOptions, YesNo, type BulkResponse } from "@/components/facility/facility-shared";
import { useLpTypeOptions } from "@/components/facility/pickers";
import { CreateLpNumberDrawer, EditLpNumberDrawer } from "./lp-number-drawers";

const PERMS = ["view", "create", "edit", "delete", "import_file", "print_barcode"] as const;
const hidden = { defaultVisible: false } as const;

const STATUS_TONE = { Empty: "success", Occupied: "warning", Shipped: "info", Removed: "danger" } as const;

export function LpStatusPill({ status }: { readonly status: LpNumberRow["status"] }) {
  return <Badge tone={STATUS_TONE[status]} size="sm" shape="pill">{status}</Badge>;
}

const right = (v: number) => <div className="text-right"><Num value={v} decimals={2} /></div>;

const COLUMNS: GridColumnDef<LpNumberRow>[] = [
  { id: "number", header: "Number", size: 190, meta: { alwaysVisible: true }, cell: ({ row }) => <CodeCell mono label={`LP ${row.original.number}`}>{row.original.number}</CodeCell> },
  { id: "warehouseCode", header: "Warehouse", size: 100, cell: ({ row }) => row.original.warehouseCode },
  { id: "lpTypeCode", header: "License plate type", size: 150, cell: ({ row }) => row.original.lpTypeCode },
  { id: "locationCode", header: "Location", size: 130, cell: ({ row }) => row.original.locationCode ?? <Muted /> },
  { id: "status", header: "Status", size: 110, cell: ({ row }) => <LpStatusPill status={row.original.status} /> },
  { id: "units", header: "Units", size: 80, meta: { align: "right" }, cell: ({ row }) => <div className="text-right"><Num value={row.original.units} /></div> },
  { id: "length", header: "Length", size: 80, meta: { align: "right" }, cell: ({ row }) => right(row.original.length) },
  { id: "width", header: "Width", size: 80, meta: { align: "right" }, cell: ({ row }) => right(row.original.width) },
  { id: "height", header: "Height", size: 80, meta: { align: "right" }, cell: ({ row }) => right(row.original.height) },
  { id: "weight", header: "Weight", size: 80, meta: { align: "right" }, cell: ({ row }) => right(row.original.weight) },
  { id: "actualVolume", header: "Actual volume", size: 136, meta: { align: "right" }, cell: ({ row }) => right(row.original.actualVolume) },
  { id: "parentLpTypeCode", header: "Parent LP type", size: 144, cell: ({ row }) => row.original.parentLpTypeCode ?? <Muted /> },
  { id: "parentLpNumber", header: "Parent LP number", size: 150, cell: ({ row }) => row.original.parentLpNumber ?? <Muted /> },
  { id: "originalNumber", header: "Original LP number", size: 150, meta: hidden, cell: ({ row }) => row.original.originalNumber ?? <Muted /> },
  { id: "alternateBarcode", header: "Alternate barcode", size: 150, meta: hidden, cell: ({ row }) => row.original.alternateBarcode ?? <Muted /> },
  { id: "isSscc18", header: "SSCC18", size: 90, cell: ({ row }) => <YesNo value={row.original.isSscc18} /> },
  { id: "clientCode", header: "Client", size: 100, meta: hidden, cell: ({ row }) => row.original.clientCode ?? <Muted /> },
  { id: "labelPrinted", header: "Label printed", size: 120, meta: hidden, cell: ({ row }) => <YesNo value={Boolean(row.original.labelPrintedAt)} /> },
  { id: "createdAt", header: "Created date", size: 160, cell: ({ row }) => new Date(row.original.createdAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) },
];

function LpDetailDrawer({ id, onOpenChange }: { readonly id: string | null; readonly onOpenChange: (o: boolean) => void }) {
  const q = useApiQuery<LpNumberDetail>(["lp-number", id ?? ""], id ? `/api/lp-numbers/${id}` : null, { staleTime: 0 });
  const d = q.data?.data;
  return (
    <Drawer open={id !== null} onOpenChange={onOpenChange} width={45} title={d ? `LP ${d.number}` : "LP number"} description="License plate details and current contents.">
      {q.isPending ? <Skeleton className="h-64 w-full" /> : q.isError || !d ? <EmptyState title="Couldn't load this LP" description={q.error?.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} /> : (
        <div className="flex flex-col gap-5">
          <StatRow stats={[{ label: "Status", value: <LpStatusPill status={d.status} /> }, { label: "Units", value: d.units.toLocaleString("en-US") }, { label: "SKUs", value: d.contents.length }, { label: "Child LPs", value: d.children.length }]} />
          <DetailList title="License plate" items={[
            { label: "Warehouse", value: d.warehouseCode }, { label: "LP type", value: d.lpTypeCode },
            { label: "Location", value: d.locationId && d.locationCode ? <LinkCell href={`/locations/${d.locationId}`}>{d.locationCode}</LinkCell> : null }, { label: "Client", value: d.clientCode },
            { label: "Parent LP", value: d.parentLpNumber }, { label: "Original number", value: d.originalNumber },
            { label: "Alternate barcode", value: d.alternateBarcode }, { label: "SSCC18", value: d.isSscc18 ? "Yes" : "No" },
            { label: "Dimensions", value: `${d.length} × ${d.width} × ${d.height}` }, { label: "Weight", value: d.weight },
            { label: "Label printed", value: d.labelPrintedAt ? new Date(d.labelPrintedAt).toLocaleString("en-US") : "Not yet", wide: true },
          ]} />
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-secondary">Contents</h3>
            {d.contents.length === 0 ? <EmptyState compact title="Empty" description="No stock on this LP." /> : (
              <table className="w-full overflow-hidden rounded-lg border border-border text-sm">
                <thead className="bg-surface-sunken text-2xs text-secondary"><tr><th className="px-3 py-2 text-left">SKU</th><th className="px-3 py-2 text-left">Lot</th><th className="px-3 py-2 text-right">On hand</th><th className="px-3 py-2 text-right">Allocated</th></tr></thead>
                <tbody className="divide-y divide-border">{d.contents.map((c) => <tr key={c.id}><td className="px-3 py-2"><span className="font-medium">{c.sku}</span><span className="ml-1 text-faint">{c.productName}</span></td><td className="px-3 py-2">{c.lotNumber ?? "—"}</td><td className="px-3 py-2 text-right tabular-nums">{c.onHand}</td><td className="px-3 py-2 text-right tabular-nums">{c.allocated}</td></tr>)}</tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

const OUTCOME = {
  delete: <Badge tone="danger" size="sm">Delete</Badge>,
  void: <Badge tone="warning" size="sm">Void</Badge>,
  blocked: <Badge tone="neutral" size="sm">Skipped</Badge>,
} as const;

type RemoveResult = BulkResponse & { readonly deleted: readonly string[]; readonly voided: readonly string[] };

/** Delete / void confirm: previews, per LP, whether it is deleted, voided (kept for history) or skipped and why. */
function RemoveLpDialog({ rows, onOpenChange, onDone }: { readonly rows: readonly LpNumberRow[] | null; readonly onOpenChange: (o: boolean) => void; readonly onDone: (r: RemoveResult) => void }) {
  const ids = (rows ?? []).map((r) => r.id);
  const preview = useQuery({
    queryKey: ["lp-removal-preview", ids],
    queryFn: async () => (await apiRequest<LpRemovalPreview>("/api/lp-numbers/removal-preview", { method: "POST", body: { ids } })).data,
    enabled: ids.length > 0,
    staleTime: 0,
    gcTime: 0,
  });
  const action = useAction([["grid", LP_NUMBERS_GRID_KEY], ["grid", "lp-types"]]);
  const plan = preview.data ?? [];
  const actionable = plan.filter((p) => p.mode !== "blocked");
  const voids = plan.filter((p) => p.mode === "void").length;
  const skipped = plan.length - actionable.length;
  const n = rows?.length ?? 0;
  const description = preview.isPending
    ? "Checking each LP for stock and history…"
    : preview.isError
      ? "Couldn't check these LPs. Close and try again."
      : actionable.length === 0
        ? "None of these LPs can be removed. The reasons are listed below."
        : [
            "Never-used LPs are deleted.",
            voids > 0 ? `${voids} with stock history ${voids === 1 ? "is" : "are"} voided instead: status Removed, kept so that history still resolves.` : null,
            skipped > 0 ? `${skipped} skipped.` : null,
            "Each change is written to the LP's change log.",
          ].filter(Boolean).join(" ");
  return (
    <ConfirmDialog
      open={rows !== null}
      onOpenChange={onOpenChange}
      variant="danger"
      title={n === 1 ? `Delete LP ${rows?.[0]?.number ?? ""}?` : `Delete ${n} LP numbers?`}
      description={description}
      confirmLabel={actionable.length === 0 ? "Close" : voids === actionable.length ? "Yes, void" : "Yes, delete"}
      cancelLabel="No"
      records={{
        columns: [{ key: "number", label: "LP number" }, { key: "status", label: "Status" }, { key: "outcome", label: "Outcome" }, { key: "why", label: "Detail" }],
        rows: (rows ?? []).map((r) => {
          const p = plan.find((x) => x.id === r.id);
          return {
            number: <span className="font-mono text-xs">{r.number}</span>,
            status: <LpStatusPill status={r.status} />,
            outcome: p ? OUTCOME[p.mode] : <Muted>…</Muted>,
            why: !p ? "" : p.mode === "blocked" ? `It ${p.reason}` : p.mode === "void" ? `Kept because ${p.because}` : "Never used",
          };
        }),
      }}
      onConfirm={async () => {
        if (preview.isPending || actionable.length === 0) { onOpenChange(false); return; }
        const result = await action.run<RemoveResult>("/api/lp-numbers/bulk-delete", "POST", { ids: actionable.map((p) => p.id) });
        if (result) onDone(result);
        onOpenChange(false);
      }}
    />
  );
}

export function LpNumbersPage() {
  const router = useRouter();
  const perms = usePagePerms("settings.lp_numbers", PERMS);
  const warehouses = useWarehouseOptions();
  const types = useLpTypeOptions(null);
  const fields = React.useMemo(() => toFilterFields(LP_NUMBER_FIELDS, { warehouseId: warehouses.short, lpTypeId: types.options }), [warehouses.short, types.options]);
  const g = useGrid<LpNumberRow>({ gridKey: LP_NUMBERS_GRID_KEY, path: "/api/lp-numbers", fields });
  const [create, setCreate] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [log, setLog] = React.useState<LpNumberRow | null>(null);
  const [labels, setLabels] = React.useState<{ readonly records: readonly unknown[]; readonly title: string } | null>(null);
  const [toRemove, setToRemove] = React.useState<readonly LpNumberRow[] | null>(null);
  const action = useAction([["grid", LP_NUMBERS_GRID_KEY]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));

  /** One print modal (critic R5): fetch the label records, then open Print LP labels with the LPs summarized in its title. */
  const printLabels = async (rows: readonly LpNumberRow[]) => {
    const records = await action.run<unknown[]>("/api/lp-numbers/labels", "POST", { ids: rows.map((r) => r.id) });
    if (records) setLabels({ records, title: lpLabelTitle(rows.map((r) => r.number)) });
  };
  const removeReason = (row: LpNumberRow) => (!perms.delete ? NO_PERMISSION : lpRowRemovalBlocker(row));

  const bulkActions: readonly BulkAction[] = [
    { key: "print", label: "Print barcode", icon: Printer, onSelect: (ids) => void printLabels(selected(ids)), disabledReason: perms.print_barcode ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, onSelect: (ids) => setToRemove(selected(ids)), disabledReason: perms.delete ? null : NO_PERMISSION,
      eligibility: (ids) => { const rows = selected(ids); return rows.length > 0 && rows.every((r) => lpRowRemovalBlocker(r)) ? "Only Empty LPs that are not on a parent LP can be deleted" : null; } },
  ];
  const rowActions = (row: LpNumberRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => setDetailId(row.id) },
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => setEditId(row.id), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row) },
    { key: "print", label: "Print barcode", icon: Printer, onSelect: () => void printLabels([row]), disabledReason: perms.print_barcode ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToRemove([row]), disabledReason: removeReason(row) },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="LP Numbers" helpHref="/locations/help#lp-numbers" tabs="lp" helper="Every license plate in the building: where it is, what type it is and whether its label is printed."
        actions={
          <>
            {perms.import_file ? <Button variant="secondary" onClick={() => router.push("/imports/lp-numbers")}><Upload className="h-4 w-4" aria-hidden />Import LP number</Button> : null}
            {perms.create ? <Button variant="primary" onClick={() => setCreate(true)}><Plus className="h-4 w-4" aria-hidden />Create LP number</Button> : null}
          </>
        } />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search LP number or alternate barcode" bulkActions={bulkActions} bulkNoun="LP number" />
      <DataGrid<LpNumberRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={(r) => setDetailId(r.id)}
        emptyTitle={filtered ? "No LP numbers match these filters" : "No LP numbers yet"}
        emptyDescription={filtered ? "Clear a filter or search with Starts With." : "Create numbers from an LP type's sequence or import them from Excel."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={() => setCreate(true)}><Plus className="h-4 w-4" />Create LP number</Button> : undefined}
      />
      <CreateLpNumberDrawer open={create} onOpenChange={setCreate} defaultWarehouseId={warehouses.defaultId} onCreated={() => g.refetch()} />
      <EditLpNumberDrawer id={editId} onOpenChange={(o) => !o && setEditId(null)} onSaved={() => g.refetch()} />
      <LpDetailDrawer id={detailId} onOpenChange={(o) => !o && setDetailId(null)} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/lp-numbers/${log.id}/change-log` : null} title={`Change log · ${log?.number ?? ""}`} />
      <PrintOptionsModal open={labels !== null} onOpenChange={(o) => { if (!o) { setLabels(null); g.refetch(); } }} typeKeys={["lp-label"]} records={labels?.records ?? []} title={labels?.title ?? "Print LP labels"} />
      <RemoveLpDialog rows={toRemove} onOpenChange={(o) => !o && setToRemove(null)} onDone={(r) => {
        const parts = [r.deleted.length ? `${r.deleted.length} deleted` : null, r.voided.length ? `${r.voided.length} voided` : null].filter(Boolean).join(", ");
        if (r.failed.length === 0) toast.success("Success", `LP numbers: ${parts}`);
        else (r.succeeded.length ? toast.warning : toast.error)(r.succeeded.length ? "Partly done" : "Nothing changed", [parts, r.failed.slice(0, 3).map((f) => f.message).join(" · ")].filter(Boolean).join(". "));
        g.clearSelection();
      }} />
    </div>
  );
}
