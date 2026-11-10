"use client";

/**
 * Mobile Carts (`/settings/mobile-carts`): grid (status derived from the open job holding the
 * cart), Create (2-step wizard), bulk Label (cart and/or cell labels) and Delete (Available
 * carts only), row ⋯ Show details · Edit · Duplicate · Label · Change log · Delete.
 */
import * as React from "react";
import { Copy, Eye, History, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { DataGrid, GridToolbar, LinkCell, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { PrintOptionsModal } from "@/components/shared/print-options-modal";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { RadioCards } from "@/components/ui/radio-cards";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { MOBILE_CART_FIELDS, MOBILE_CARTS_GRID_KEY } from "@/lib/grid-defs/facility/mobile-carts";
import type { MobileCartDetail, MobileCartRow } from "@/server/repositories/mobile-carts";
import { apiErrorMessage, AvailabilityPill, DetailList, EntityChangeLogDrawer, Muted, NO_PERMISSION, Num, StatRow, toastBulk, toFilterFields, useAction, useLookups, usePagePerms, useWarehouseOptions, YesNo, type BulkResponse } from "@/components/facility/facility-shared";
import { MobileCartWizardDrawer } from "./mobile-cart-wizard";

const PERMS = ["view", "create", "edit", "delete", "label", "duplicate"] as const;
const hidden = { defaultVisible: false } as const;
const right = (v: number) => <div className="text-right"><Num value={v} /></div>;
type LabelScope = "carts" | "cells" | "both";

const COLUMNS: GridColumnDef<MobileCartRow>[] = [
  { id: "code", header: "Cart code", size: 120, meta: { alwaysVisible: true }, cell: ({ row }) => <span className="font-medium text-foreground">{row.original.code}</span> },
  { id: "description", header: "Cart description", size: 200, cell: ({ row }) => row.original.description ?? <Muted /> },
  { id: "warehouseCode", header: "Warehouse", size: 100, cell: ({ row }) => row.original.warehouseCode },
  { id: "status", header: "Status", size: 120, meta: { headerTip: "Occupied while an open job holds the cart" }, cell: ({ row }) => <AvailabilityPill status={row.original.status} /> },
  { id: "cartTypeName", header: "Mobile cart type", size: 150, enableSorting: false, cell: ({ row }) => row.original.cartTypeName ?? <Muted /> },
  { id: "cellCount", header: "Num. of cells", size: 110, meta: { align: "right" }, cell: ({ row }) => right(row.original.cellCount) },
  { id: "levels", header: "Num. of levels", size: 110, meta: { align: "right" }, cell: ({ row }) => right(row.original.levels) },
  { id: "columns", header: "Num. of columns", size: 120, meta: { align: "right" }, cell: ({ row }) => right(row.original.columns) },
  { id: "taskCount", header: "Num. of tasks", size: 110, meta: { align: "right", headerTip: "Open tasks of the job holding the cart" }, cell: ({ row }) => right(row.original.taskCount) },
  { id: "jobCode", header: "Job code", size: 120, cell: ({ row }) => (row.original.jobId && row.original.jobCode ? <LinkCell href={`/jobs/${row.original.jobId}`}>{row.original.jobCode}</LinkCell> : <Muted />) },
  { id: "orderCount", header: "Num. of orders", size: 120, meta: { align: "right" }, cell: ({ row }) => right(row.original.orderCount) },
  { id: "operationType", header: "Operation type", size: 130, cell: ({ row }) => row.original.operationType },
  { id: "allowMultipleJob", header: "Allow multiple job", size: 140, cell: ({ row }) => <YesNo value={row.original.allowMultipleJob} /> },
  { id: "isDynamic", header: "Dynamic", size: 100, meta: hidden, cell: ({ row }) => <YesNo value={row.original.isDynamic} /> },
  { id: "createdAt", header: "Created date", size: 130, meta: hidden, cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString("en-US") },
];

function CartDetailDrawer({ id, onOpenChange, onEdit, canEdit }: { readonly id: string | null; readonly onOpenChange: (o: boolean) => void; readonly onEdit: (id: string) => void; readonly canEdit: boolean }) {
  const q = useApiQuery<MobileCartDetail>(["mobile-cart", id ?? ""], id ? `/api/mobile-carts/${id}` : null, { staleTime: 0 });
  const d = q.data?.data;
  const levels = d ? Array.from({ length: d.levels }, (_, i) => i + 1) : [];
  return (
    <Drawer open={id !== null} onOpenChange={onOpenChange} width={60} title={d ? `Mobile cart ${d.code}` : "Mobile cart"} description={d?.description ?? "Cart layout, cells and the job using it"}
      footer={d && canEdit ? <div className="flex justify-end"><Button variant="primary" onClick={() => onEdit(d.id)}><Pencil className="h-4 w-4" />Edit</Button></div> : undefined}>
      {q.isPending ? <Skeleton className="h-64 w-full" /> : q.isError || !d ? <EmptyState title="Couldn't load this mobile cart" description={q.error?.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} /> : (
        <div className="flex flex-col gap-5">
          <StatRow stats={[{ label: "Status", value: <AvailabilityPill status={d.status} /> }, { label: "Cells", value: d.cellCount }, { label: "Open tasks", value: d.taskCount }, { label: "Orders", value: d.orderCount }]} />
          <DetailList title="Mobile cart" items={[
            { label: "Warehouse", value: d.warehouseCode }, { label: "Mobile cart type", value: d.cartTypeName },
            { label: "Layout", value: `${d.levels} levels × ${d.columns} columns` }, { label: "Operation type", value: d.operationType },
            { label: "Allow multiple jobs", value: d.allowMultipleJob ? "Yes" : "No" }, { label: "Dynamic", value: d.isDynamic ? "Yes" : "No" },
            { label: "Job", value: d.jobId && d.jobCode ? <LinkCell href={`/jobs/${d.jobId}`}>{d.jobCode}</LinkCell> : "Not in use", wide: true },
          ]} />
          <section className="flex flex-col gap-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-secondary">Cells</h3>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface-sunken/50 p-3">
              <div className="inline-grid gap-1.5" style={{ gridTemplateColumns: `2rem repeat(${Math.max(1, d.columns)}, minmax(5.5rem, 1fr))` }}>
                <span />
                {Array.from({ length: d.columns }, (_, c) => <span key={c} className="text-center text-[11px] font-medium text-faint">{c + 1}</span>)}
                {levels.map((l) => (
                  <React.Fragment key={l}>
                    <span className="flex items-center text-[11px] font-semibold text-faint">{String.fromCharCode(64 + l)}</span>
                    {Array.from({ length: d.columns }, (_, c) => {
                      const cell = d.cells.find((x) => x.level === l && x.column === c + 1);
                      return (
                        <span key={c} className={`flex flex-col rounded-md border px-1.5 py-1 text-center shadow-xs ${cell?.orderCode ? "border-info/40 bg-info-soft" : "border-border bg-surface"}`}>
                          <span className="truncate font-mono text-[10px] text-body" title={cell?.barcode}>{cell?.barcode ?? "—"}</span>
                          <span className="truncate text-[10px] text-faint">{cell?.orderCode ?? "Empty"}</span>
                        </span>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}

function DuplicateDialog({ row, onOpenChange, onDone }: { readonly row: MobileCartRow | null; readonly onOpenChange: (o: boolean) => void; readonly onDone: () => void }) {
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const action = useAction([["grid", MOBILE_CARTS_GRID_KEY]]);
  React.useEffect(() => { if (row) { setCode(`${row.code}-COPY`); setError(null); } }, [row]);
  const submit = async () => {
    if (!code.trim()) { setError("Code is required"); return; }
    const data = await action.run<{ code: string }>(`/api/mobile-carts/${row?.id}/duplicate`, "POST", { code }, (e) => {
      const msg = isApiError(e) && e.fieldErrors?.code?.[0] ? e.fieldErrors.code[0] : apiErrorMessage(e);
      setError(msg);
    });
    if (data) { toast.success("Success", `Mobile cart ${data.code} created from ${row?.code}.`); onDone(); onOpenChange(false); }
  };
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title={`Duplicate ${row?.code ?? ""}`} description={`Copies the type, layout and ${row?.cellCount ?? 0} cells. Cell barcodes follow the new code.`} />
        <DialogBody>
          <form id="dup-cart" onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-1">
            <label htmlFor="dup-code" className="text-[12px] font-medium text-body">New cart code *</label>
            <TextField id="dup-code" autoFocus value={code} maxLength={40} invalid={Boolean(error)} aria-describedby={error ? "dup-code-err" : undefined}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }} />
            {error ? <p id="dup-code-err" role="alert" className="text-[12px] text-danger">{error}</p> : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form="dup-cart" disabled={action.pending || !code.trim()}><Copy className="h-4 w-4" />Duplicate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LabelScopeDialog({ rows, onOpenChange, onPrint, pending }: { readonly rows: readonly MobileCartRow[] | null; readonly onOpenChange: (o: boolean) => void; readonly onPrint: (scope: LabelScope) => void; readonly pending: boolean }) {
  const [scope, setScope] = React.useState<LabelScope>("both");
  const carts = rows?.length ?? 0;
  const cells = (rows ?? []).reduce((n, r) => n + r.cellCount, 0);
  const count = scope === "carts" ? carts : scope === "cells" ? cells : carts + cells;
  return (
    <Dialog open={rows !== null} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Print mobile cart labels" description={`${carts} ${carts === 1 ? "cart" : "carts"} selected.`} />
        <DialogBody>
          <RadioCards<LabelScope> ariaLabel="Labels to print" value={scope} onChange={setScope} options={[
            { value: "both", title: "Cart and cell labels", description: `${carts + cells} labels: the cart plate, then every cell` },
            { value: "carts", title: "Cart labels only", description: `${carts} ${carts === 1 ? "label" : "labels"}` },
            { value: "cells", title: "Cell labels only", description: `${cells} labels, level by level` },
          ]} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={pending || count === 0} onClick={() => onPrint(scope)}><Tag className="h-4 w-4" />Continue with {count} labels</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MobileCartsPage() {
  const perms = usePagePerms("settings.mobile_carts", PERMS);
  const warehouses = useWarehouseOptions();
  const cartTypes = useLookups("mobile_cart_type");
  const fields = React.useMemo(() => toFilterFields(MOBILE_CART_FIELDS, { warehouseId: warehouses.short, cartTypeId: cartTypes.options }), [warehouses.short, cartTypes.options]);
  const g = useGrid<MobileCartRow>({ gridKey: MOBILE_CARTS_GRID_KEY, path: "/api/mobile-carts", fields });
  const [wizard, setWizard] = React.useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [log, setLog] = React.useState<MobileCartRow | null>(null);
  const [dup, setDup] = React.useState<MobileCartRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly MobileCartRow[] | null>(null);
  const [toLabel, setToLabel] = React.useState<readonly MobileCartRow[] | null>(null);
  const [labels, setLabels] = React.useState<readonly unknown[] | null>(null);
  const action = useAction([["grid", MOBILE_CARTS_GRID_KEY]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const deleteReason = (row: MobileCartRow) => (!perms.delete ? NO_PERMISSION : row.status === "Occupied" ? `In use by job ${row.jobCode ?? ""}; only Available carts can be deleted` : null);

  const printLabels = async (scope: LabelScope) => {
    const records = await action.run<unknown[]>("/api/mobile-carts/labels", "POST", { ids: (toLabel ?? []).map((r) => r.id), include: scope });
    if (records) { setToLabel(null); setLabels(records); }
  };

  const bulkActions: readonly BulkAction[] = [
    { key: "label", label: "Label", icon: Tag, onSelect: (ids) => setToLabel(selected(ids)), disabledReason: perms.label ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setToDelete(selected(ids)), disabledReason: perms.delete ? null : NO_PERMISSION,
      eligibility: (ids) => { const rows = selected(ids); return rows.length && rows.every((r) => r.status === "Occupied") ? "Only Available carts can be deleted" : null; } },
  ];
  const rowActions = (row: MobileCartRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => setDetailId(row.id) },
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => setWizard({ open: true, editId: row.id }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "duplicate", label: "Duplicate", icon: Copy, onSelect: () => setDup(row), disabledReason: perms.duplicate ? null : NO_PERMISSION },
    { key: "label", label: "Label", icon: Tag, onSelect: () => setToLabel([row]), disabledReason: perms.label ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToDelete([row]), disabledReason: deleteReason(row) },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const create = () => setWizard({ open: true, editId: null });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Mobile Carts" helper="Pick carts and their cells: layout, barcodes, and which job is using each cart right now."
        actions={<DisabledReason reason={perms.create ? null : NO_PERMISSION}><Button variant="primary" disabled={!perms.create} onClick={create}><Plus className="h-4 w-4" aria-hidden />Create mobile cart</Button></DisabledReason>} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search cart code" bulkActions={bulkActions} bulkNoun="mobile cart" />
      <DataGrid<MobileCartRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={(r) => setDetailId(r.id)}
        emptyTitle={filtered ? "No mobile carts match these filters" : "No mobile carts yet"}
        emptyDescription={filtered ? "Clear a filter or search for another code." : "Create a cart so pickers can sort several orders into its cells in one walk."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={create}><Plus className="h-4 w-4" />Create mobile cart</Button> : undefined}
      />
      <MobileCartWizardDrawer open={wizard.open} editId={wizard.editId} defaultWarehouseId={warehouses.defaultId} onOpenChange={(o) => setWizard((w) => ({ ...w, open: o }))} onSaved={() => g.refetch()} />
      <CartDetailDrawer id={detailId} onOpenChange={(o) => !o && setDetailId(null)} canEdit={perms.edit} onEdit={(id) => { setDetailId(null); setWizard({ open: true, editId: id }); }} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/mobile-carts/${log.id}/change-log` : null} title={`Change log · ${log?.code ?? ""}`} />
      <DuplicateDialog row={dup} onOpenChange={(o) => !o && setDup(null)} onDone={() => g.refetch()} />
      <LabelScopeDialog rows={toLabel} onOpenChange={(o) => !o && setToLabel(null)} onPrint={(s) => void printLabels(s)} pending={action.pending} />
      <PrintOptionsModal open={labels !== null} onOpenChange={(o) => !o && setLabels(null)} typeKeys={["mobile-cart-label"]} records={labels ?? []} title="Print mobile cart labels" />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title={`Delete ${toDelete?.length === 1 ? `mobile cart ${toDelete[0]?.code}` : `${toDelete?.length ?? 0} mobile carts`}?`}
        description="The carts and their cells are removed. Occupied carts are skipped."
        confirmLabel="Yes, delete"
        cancelLabel="No"
        records={{ columns: [{ key: "code", label: "Cart" }, { key: "warehouse", label: "Warehouse" }, { key: "status", label: "Status" }, { key: "cells", label: "Cells" }], rows: (toDelete ?? []).map((r) => ({ code: r.code, warehouse: r.warehouseCode, status: r.status, cells: r.cellCount })) }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>("/api/mobile-carts/bulk-delete", "POST", { ids: (toDelete ?? []).map((r) => r.id) });
          if (result) { toastBulk(result, "mobile cart", "deleted"); g.clearSelection(); }
          setToDelete(null);
        }}
      />
    </div>
  );
}
