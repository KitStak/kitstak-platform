"use client";

/**
 * LP Numbers (`/settings/lp-numbers`, LP tab group): grid (search defaults to Starts With),
 * header Import LP Number + Create LP Number, bulk Print Barcode (review table → Print labels
 * → LP label PDF), row ⋯ Show details · Edit · Change log · Print barcode.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, History, Pencil, Plus, Printer, Upload } from "lucide-react";
import { DataGrid, GridToolbar, LinkCell, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { ChangeLogDrawer } from "@/components/shared/change-log-drawer";
import { PrintOptionsModal } from "@/components/shared/print-options-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { DisabledReason } from "@/components/ui/tooltip";
import { useApiQuery } from "@/lib/query-client";
import { LP_NUMBER_FIELDS, LP_NUMBERS_GRID_KEY } from "@/lib/grid-defs/facility/lp-numbers";
import type { LpNumberDetail, LpNumberRow } from "@/server/repositories/lp-numbers";
import { DetailList, Muted, NO_PERMISSION, Num, StatRow, toFilterFields, useAction, usePagePerms, useWarehouseOptions, YesNo } from "@/components/facility/facility-shared";
import { useLpTypeOptions } from "@/components/facility/pickers";
import { CreateLpNumberDrawer, EditLpNumberDrawer } from "./lp-number-drawers";

const PERMS = ["view", "create", "edit", "import_file", "change_log", "print_barcode"] as const;
const hidden = { defaultVisible: false } as const;

const STATUS_TONE = { Empty: "neutral", Occupied: "info", Shipped: "success", Removed: "danger" } as const;

export function LpStatusPill({ status }: { readonly status: LpNumberRow["status"] }) {
  return <Badge tone={STATUS_TONE[status]} size="sm" shape="pill">{status}</Badge>;
}

const right = (v: number) => <div className="text-right"><Num value={v} decimals={2} /></div>;

const COLUMNS: GridColumnDef<LpNumberRow>[] = [
  { id: "number", header: "Number", size: 190, meta: { alwaysVisible: true }, cell: ({ row }) => <span className="font-mono text-[12px] font-medium text-foreground">{row.original.number}</span> },
  { id: "warehouseCode", header: "Warehouse", size: 100, cell: ({ row }) => row.original.warehouseCode },
  { id: "lpTypeCode", header: "License plate type", size: 150, cell: ({ row }) => row.original.lpTypeCode },
  { id: "locationCode", header: "Location", size: 130, cell: ({ row }) => row.original.locationCode ?? <Muted /> },
  { id: "status", header: "Status", size: 110, cell: ({ row }) => <LpStatusPill status={row.original.status} /> },
  { id: "units", header: "Units", size: 80, meta: { align: "right" }, cell: ({ row }) => <div className="text-right"><Num value={row.original.units} /></div> },
  { id: "length", header: "Length", size: 80, meta: { ...hidden, align: "right" }, cell: ({ row }) => right(row.original.length) },
  { id: "width", header: "Width", size: 80, meta: { ...hidden, align: "right" }, cell: ({ row }) => right(row.original.width) },
  { id: "height", header: "Height", size: 80, meta: { ...hidden, align: "right" }, cell: ({ row }) => right(row.original.height) },
  { id: "weight", header: "Weight", size: 80, meta: { ...hidden, align: "right" }, cell: ({ row }) => right(row.original.weight) },
  { id: "actualVolume", header: "Actual volume", size: 110, meta: { ...hidden, align: "right" }, cell: ({ row }) => right(row.original.actualVolume) },
  { id: "parentLpNumber", header: "Parent LP number", size: 150, meta: hidden, cell: ({ row }) => row.original.parentLpNumber ?? <Muted /> },
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
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-secondary">Contents</h3>
            {d.contents.length === 0 ? <EmptyState compact title="Empty" description="No stock on this LP." /> : (
              <table className="w-full overflow-hidden rounded-lg border border-border text-[13px]">
                <thead className="bg-surface-sunken text-[11px] uppercase text-secondary"><tr><th className="px-3 py-2 text-left">SKU</th><th className="px-3 py-2 text-left">Lot</th><th className="px-3 py-2 text-right">On hand</th><th className="px-3 py-2 text-right">Allocated</th></tr></thead>
                <tbody className="divide-y divide-border">{d.contents.map((c) => <tr key={c.id}><td className="px-3 py-2"><span className="font-medium">{c.sku}</span><span className="ml-1 text-faint">{c.productName}</span></td><td className="px-3 py-2">{c.lotNumber ?? "—"}</td><td className="px-3 py-2 text-right tabular-nums">{c.onHand}</td><td className="px-3 py-2 text-right tabular-nums">{c.allocated}</td></tr>)}</tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

/** Bulk Print Barcode: review table of the selected LPs, then Print labels. */
function PrintBarcodeModal({ rows, onOpenChange, onPrint, pending }: { readonly rows: readonly LpNumberRow[] | null; readonly onOpenChange: (o: boolean) => void; readonly onPrint: () => void; readonly pending: boolean }) {
  return (
    <Dialog open={rows !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title="Print barcode" description={`${rows?.length ?? 0} LP ${rows?.length === 1 ? "label" : "labels"} will be printed, one per LP.`} />
        <DialogBody>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-surface-sunken text-[11px] uppercase text-secondary"><tr><th className="px-3 py-2 text-left">Number</th><th className="px-3 py-2 text-left">LP type</th><th className="px-3 py-2 text-left">Warehouse</th><th className="px-3 py-2 text-left">Location</th><th className="px-3 py-2 text-left">Printed before</th></tr></thead>
              <tbody className="divide-y divide-border">
                {(rows ?? []).map((r) => (
                  <tr key={r.id}><td className="px-3 py-1.5 font-mono text-[12px]">{r.number}</td><td className="px-3 py-1.5">{r.lpTypeCode}</td><td className="px-3 py-1.5">{r.warehouseCode}</td><td className="px-3 py-1.5">{r.locationCode ?? "—"}</td><td className="px-3 py-1.5">{r.labelPrintedAt ? "Yes" : "No"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={onPrint} disabled={pending}><Printer className="h-4 w-4" />Print labels</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [toPrint, setToPrint] = React.useState<readonly LpNumberRow[] | null>(null);
  const [labels, setLabels] = React.useState<readonly unknown[] | null>(null);
  const action = useAction([["grid", LP_NUMBERS_GRID_KEY]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));

  const printLabels = async () => {
    const records = await action.run<unknown[]>("/api/lp-numbers/labels", "POST", { ids: (toPrint ?? []).map((r) => r.id) });
    if (records) { setToPrint(null); setLabels(records); }
  };

  const bulkActions: readonly BulkAction[] = [
    { key: "print", label: "Print barcode", icon: Printer, onSelect: (ids) => setToPrint(selected(ids)), disabledReason: perms.print_barcode ? null : NO_PERMISSION },
  ];
  const rowActions = (row: LpNumberRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => setDetailId(row.id) },
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => setEditId(row.id), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row), disabledReason: perms.change_log ? null : NO_PERMISSION },
    { key: "print", label: "Print barcode", icon: Printer, onSelect: () => setToPrint([row]), disabledReason: perms.print_barcode ? null : NO_PERMISSION },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="LP Numbers" tabs="lp" helper="Every license plate in the building: where it is, what type it is and whether its label is printed."
        actions={
          <>
            <DisabledReason reason={perms.import_file ? null : NO_PERMISSION}>
              <Button variant="secondary" disabled={!perms.import_file} onClick={() => router.push("/imports/lp-numbers")}><Upload className="h-4 w-4" aria-hidden />Import LP number</Button>
            </DisabledReason>
            <DisabledReason reason={perms.create ? null : NO_PERMISSION}>
              <Button variant="primary" disabled={!perms.create} onClick={() => setCreate(true)}><Plus className="h-4 w-4" aria-hidden />Create LP number</Button>
            </DisabledReason>
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
      {log ? <ChangeLogDrawer open onOpenChange={(o) => !o && setLog(null)} entityType="license_plate" entityId={log.id} entityCode={log.number} /> : null}
      <PrintBarcodeModal rows={toPrint} onOpenChange={(o) => !o && setToPrint(null)} onPrint={() => void printLabels()} pending={action.pending} />
      <PrintOptionsModal open={labels !== null} onOpenChange={(o) => { if (!o) { setLabels(null); g.refetch(); } }} typeKeys={["lp-label"]} records={labels ?? []} title="Print LP labels" />
    </div>
  );
}
