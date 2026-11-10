"use client";

/**
 * Work Orders list (`/work-orders`, Logiwa 02 §8). Shared grid (Equal/Starts With search,
 * 22 filters, chips, saved views, column chooser, density, page sizes, async xlsx export)
 * plus status pills with live counts, and the Logiwa toolbar: Tag, Disassemble Kit,
 * Create Kit, Warehouse Ops ▾ (Print Picking List, Batch Picking List, Picking/Job
 * Operations, Cancel Picking). Row ⋯: Show details / Edit / Change log / Cancel / Delete.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, Boxes, ChevronDown, ClipboardList, Eye, FileStack, History, ListChecks, PackageOpen, Pencil, Plus, Printer, Tag as TagIcon, Trash2, Undo2, Upload, Warehouse } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { ChangeLogDrawer, PrintOptionsModal, TagPopover } from "@/components/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { KpiChip, type KpiTone } from "@/components/ui/kpi-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import { useCan } from "@/lib/permissions-client";
import { useApiQuery } from "@/lib/query-client";
import type { GridUrlState } from "@/lib/use-url-state";
import { WORK_ORDER_STATUSES } from "@/lib/enums";
import { WORK_ORDER_GRID_FIELDS, WORK_ORDERS_GRID_KEY } from "@/lib/grid-defs/work-orders/work-orders";
import {
  cancelPickingReason, cancelReason, createKitReason, deleteReason, disassembleReason, editReason, pickingReason, printReason, selectionReason,
} from "@/lib/grid-defs/work-orders/work-order-model";
import { CreateKitDialog } from "./create-kit-dialog";
import { DisassembleDialog } from "./disassemble-dialog";
import { PickingDialog } from "./picking-dialog";
import { buildWoColumns } from "./wo-columns";
import { bulkToast, errorMessage, postBulk, useInvalidateWorkOrders, useWoFilterFields, WO_ENTITY, WO_P, type WorkOrderRow } from "./wo-client";
import { WorkOrderWizard } from "./wizard/work-order-wizard";

export const WO_HELPER = "Create and list work orders for kitting process of kit to stock products";
export const WO_TABS = [{ href: "/work-orders", label: "Work Orders", exact: true }] as const;

const STATUS_TONE: Readonly<Record<string, KpiTone>> = { Open: "success", "In Process": "primary", Completed: "success", Shortage: "warning", Cancelled: "danger" };

export function WoStatusPills({ grid }: { readonly grid: GridUrlState }) {
  const filters = grid.query.filters.filter((f) => f.field !== "status");
  const qs = new URLSearchParams(grid.queryString);
  for (const key of [...qs.keys()]) if (key === "f.status" || key === "page" || key === "ps" || key === "sort") qs.delete(key);
  const counts = useApiQuery<Readonly<Record<string, number>>>(["wo-status-counts", qs.toString()], `/api/work-orders/status-counts${qs.toString() ? `?${qs.toString()}` : ""}`);
  const current = grid.query.filters.find((f) => f.field === "status");
  const values = current && current.op === "in" ? current.values : [];
  const only = values.length === 1 ? values[0] : null;
  const data = counts.data?.data;
  if (counts.isPending) {
    return <div className="flex flex-wrap items-center gap-2 px-6 pt-3" aria-hidden>{["All", ...WORK_ORDER_STATUSES].map((s) => <Skeleton key={s} className="h-7 w-28 rounded-full" />)}</div>;
  }
  if (!data) return null;
  const total = Object.values(data).reduce((s, n) => s + n, 0);
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 pt-3" role="group" aria-label="Filter by status" data-filters={filters.length}>
      <KpiChip label="All" value={total.toLocaleString()} active={!current} onClick={() => grid.removeFilter("status")} />
      {WORK_ORDER_STATUSES.map((s) => (
        <KpiChip key={s} label={s} value={(data[s] ?? 0).toLocaleString()} tone={STATUS_TONE[s] ?? "neutral"} active={only === s}
          onClick={() => (only === s ? grid.removeFilter("status") : grid.upsertFilter({ field: "status", op: "in", values: [s] }))} />
      ))}
    </div>
  );
}

type Confirm = { kind: "delete" | "cancel" | "cancelPicking"; rows: readonly WorkOrderRow[] } | null;
type Wizard = { mode: "create" | "edit"; id?: string } | null;

function HeaderActions({ canCreate, canImport, onCreate }: { readonly canCreate: boolean; readonly canImport: boolean; readonly onCreate: () => void }) {
  return (
    <>
      {canImport ? (
        <Link href="/imports/work-orders" className={buttonVariants({ variant: "secondary" })}>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Import
        </Link>
      ) : null}
      {canCreate ? (
        <Button variant="primary" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create work order
        </Button>
      ) : null}
    </>
  );
}

export function WorkOrdersPage() {
  const router = useRouter();
  const search = useSearchParams();
  const invalidate = useInvalidateWorkOrders();
  const fields = useWoFilterFields(WORK_ORDER_GRID_FIELDS, WO_ENTITY);
  const g = useGrid<WorkOrderRow>({ gridKey: WORK_ORDERS_GRID_KEY, path: "/api/work-orders", fields });
  const columns = React.useMemo(() => buildWoColumns(), []);
  const can = {
    create: useCan(WO_P.create).allowed, edit: useCan(WO_P.edit).allowed, del: useCan(WO_P.del).allowed, createKit: useCan(WO_P.createKit).allowed,
    disassemble: useCan(WO_P.disassemble).allowed, tag: useCan(WO_P.tag).allowed, picking: useCan(WO_P.picking).allowed,
    cancelPicking: useCan(WO_P.cancelPicking).allowed, imp: useCan(WO_P.importFile).allowed,
  };

  // Remember every row seen so selections across pages keep their status for the guards.
  const [seen, setSeen] = React.useState<ReadonlyMap<string, WorkOrderRow>>(new Map());
  const rowsKey = g.rows.map((r) => `${r.id}:${r.version}:${r.status}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on row identity, not array identity
  React.useEffect(() => { setSeen((prev) => new Map([...prev, ...g.rows.map((r) => [r.id, r] as const)])); }, [rowsKey]);
  const selected = g.selectedIds.map((id) => g.rows.find((r) => r.id === id) ?? seen.get(id)).filter((r): r is WorkOrderRow => Boolean(r));
  const codeOf = (id: string) => seen.get(id)?.code ?? "work order";

  // Deep link: /work-orders?create=1 opens the wizard.
  const [wizard, setWizard] = React.useState<Wizard>(() => (search.get("create") === "1" ? { mode: "create" } : null));
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [kitFor, setKitFor] = React.useState<string | null>(null);
  const [disFor, setDisFor] = React.useState<string | null>(null);
  const [picking, setPicking] = React.useState<readonly string[] | null>(null);
  const [print, setPrint] = React.useState<{ records: readonly unknown[]; consolidated: boolean } | null>(null);
  const [logFor, setLogFor] = React.useState<WorkOrderRow | null>(null);

  const finish = async () => {
    g.clearSelection();
    await invalidate();
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const path = { delete: null, cancel: "/api/work-orders/cancel", cancelPicking: "/api/work-orders/cancel-picking" }[confirm.kind];
    try {
      if (path) {
        const res = await postBulk(path, confirm.rows.map((r) => r.id));
        bulkToast(res, codeOf, { done: confirm.kind === "cancel" ? "cancelled" : "reset to Open; picking cancelled" });
      } else {
        const results = await Promise.allSettled(confirm.rows.map((r) => apiFetch(`/api/work-orders/${encodeURIComponent(r.id)}`, { method: "DELETE" })));
        bulkToast({
          succeeded: confirm.rows.filter((_, i) => results[i]?.status === "fulfilled").map((r) => r.id),
          failed: confirm.rows.flatMap((r, i) => { const x = results[i]; return x?.status === "rejected" ? [{ id: r.id, message: errorMessage(x.reason) }] : []; }),
        }, codeOf, { done: "deleted" });
      }
    } catch (error) {
      toast.error("Error", errorMessage(error));
    } finally {
      await finish();
    }
  };

  const printLists = async (consolidated: boolean) => {
    try {
      const records = await apiFetch<readonly unknown[]>("/api/work-orders/pick-list", { method: "POST", body: { ids: g.selectedIds, consolidated } });
      if (records.length === 0) { toast.info("Nothing to print", "The selected work orders have nothing left to pick."); return; }
      setPrint({ records, consolidated });
    } catch (error) {
      toast.error("Error", errorMessage(error));
    }
  };

  const rowActions = (row: WorkOrderRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, href: `/work-orders/${row.id}` },
    ...(can.edit ? [{ key: "edit", label: "Edit", icon: Pencil, disabledReason: editReason(row), onSelect: () => setWizard({ mode: "edit", id: row.id }) }] : []),
    { key: "log", label: "Change log", icon: History, onSelect: () => setLogFor(row) },
    ...(can.edit ? [{ key: "cancel", label: "Cancel work order", icon: Ban, destructive: true, disabledReason: cancelReason(row), onSelect: () => setConfirm({ kind: "cancel", rows: [row] }) }] : []),
    ...(can.del ? [{ key: "delete", label: "Delete", icon: Trash2, destructive: true, disabledReason: deleteReason(row), onSelect: () => setConfirm({ kind: "delete", rows: [row] }) }] : []),
  ];

  const single = { single: true } as const;
  const rKit = selectionReason(selected, createKitReason, single);
  const rDis = selectionReason(selected, disassembleReason, single);
  const rPrint = selectionReason(selected, printReason);
  const rPick = selectionReason(selected, pickingReason);
  const rCancelPick = selectionReason(selected, cancelPickingReason);
  const none = selected.length === 0 ? "Select at least one work order" : null;
  const opsReason = none;

  const trailing = (
    <div className="flex items-center gap-2">
      {can.tag ? (
        <TagPopover entityType={WO_ENTITY} scope={WO_ENTITY} ids={g.selectedIds} appliedTagIds={selected.length === 1 ? selected[0]?.tags.map((t) => t.id) : []}
          onApplied={() => void finish()} disabledReason={none}
          trigger={<Button variant="secondary" disabled={Boolean(none)}><TagIcon className="h-3.5 w-3.5" aria-hidden />Tag</Button>} />
      ) : null}
      {can.disassemble ? (
        <DisabledReason reason={rDis}>
          <Button variant="secondary" disabled={Boolean(rDis)} onClick={() => setDisFor(selected[0]?.id ?? null)}><PackageOpen className="h-3.5 w-3.5" aria-hidden />Disassemble kit</Button>
        </DisabledReason>
      ) : null}
      {can.createKit ? (
        <DisabledReason reason={rKit}>
          <Button variant="secondary" disabled={Boolean(rKit)} onClick={() => setKitFor(selected[0]?.id ?? null)}><Boxes className="h-3.5 w-3.5" aria-hidden />Create kit</Button>
        </DisabledReason>
      ) : null}
      <DropdownMenu>
        <DisabledReason reason={opsReason}>
          <DropdownMenuTrigger asChild disabled={Boolean(opsReason)}>
            <Button variant="secondary" disabled={Boolean(opsReason)}><Warehouse className="h-3.5 w-3.5" aria-hidden />Warehouse ops<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button>
          </DropdownMenuTrigger>
        </DisabledReason>
        <DropdownMenuContent align="end" className="min-w-[260px]">
          <DropdownMenuItem icon={Printer} disabledReason={rPrint} description="One picking list per work order" onSelect={() => void printLists(false)}>Print picking list</DropdownMenuItem>
          <DropdownMenuItem icon={FileStack} disabledReason={rPrint} description="All selected work orders on one list" onSelect={() => void printLists(true)}>Batch picking list</DropdownMenuItem>
          <DropdownMenuItem icon={ListChecks} disabledReason={can.picking ? rPick : "You don't have permission to run picking/job operations"} description="Allocate components and create picking jobs" onSelect={() => setPicking(selected.map((r) => r.id))}>Picking/job operations</DropdownMenuItem>
          <DropdownMenuItem icon={Undo2} destructive disabledReason={can.cancelPicking ? rCancelPick : "You don't have permission to cancel picking"} description="Release allocations and cancel the picking job" onSelect={() => setConfirm({ kind: "cancelPicking", rows: selected })}>Cancel picking</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const confirmRecords = confirm ? {
    columns: [{ key: "code", label: "Work order" }, { key: "status", label: "Status" }, { key: "kit", label: "Kit SKU" }, { key: "qty", label: "Built / requested" }],
    rows: confirm.rows.map((r) => ({ code: r.code, status: <StatusPill status={r.status} domain="workOrder" size="sm" />, kit: r.kitSku, qty: `${r.processedQty} / ${r.requestedQty}` })),
  } : undefined;
  const n = confirm?.rows.length ?? 0;
  const plural = n === 1 ? "work order" : `${n} work orders`;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Work Orders" crumbLabel="Work Order" tabs={WO_TABS} helper={WO_HELPER} actions={<HeaderActions canCreate={can.create} canImport={can.imp} onCreate={() => setWizard({ mode: "create" })} />} />
      <WoStatusPills grid={g.grid} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by code" bulkNoun="work order" trailing={trailing} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<WorkOrderRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          onRowClick={(row) => router.push(`/work-orders/${row.id}`)}
          emptyTitle="No work orders match this view"
          emptyDescription="Clear the filters, or create a work order to start kitting."
          emptyAction={can.create ? <Button variant="primary" onClick={() => setWizard({ mode: "create" })}><Plus className="h-3.5 w-3.5" aria-hidden />Create work order</Button> : undefined}
        />
      </div>

      <WorkOrderWizard open={wizard !== null} onOpenChange={(o) => { if (!o) setWizard(null); }} mode={wizard?.mode ?? "create"} workOrderId={wizard?.id ?? null}
        onSaved={(row) => { if (wizard?.mode === "create") router.push(`/work-orders/${row.id}`); }} />
      <CreateKitDialog open={kitFor !== null} onOpenChange={(o) => { if (!o) setKitFor(null); }} workOrderId={kitFor} onDone={() => g.clearSelection()} />
      <DisassembleDialog open={disFor !== null} onOpenChange={(o) => { if (!o) setDisFor(null); }} workOrderId={disFor} onDone={() => g.clearSelection()} />
      <PickingDialog open={picking !== null} onOpenChange={(o) => { if (!o) setPicking(null); }} ids={picking ?? []} onDone={() => g.clearSelection()} />
      <PrintOptionsModal open={print !== null} onOpenChange={(o) => { if (!o) setPrint(null); }} typeKeys={[print?.consolidated ? "work-order-consolidated-picking-list" : "work-order-picking-list"]}
        records={print?.records ?? []} title={print?.consolidated ? "Batch picking list" : "Print picking list"} clientId={selected.length === 1 ? selected[0]?.clientId : null} />
      {logFor ? <ChangeLogDrawer open onOpenChange={(o) => { if (!o) setLogFor(null); }} entityType={WO_ENTITY} entityId={logFor.id} entityCode={logFor.code} /> : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        variant="danger"
        icon={confirm?.kind === "delete" ? Trash2 : confirm?.kind === "cancel" ? Ban : ClipboardList}
        title={confirm?.kind === "delete" ? `Delete ${plural}?` : confirm?.kind === "cancel" ? `Cancel ${plural}?` : `Cancel picking for ${plural}?`}
        description={confirm?.kind === "delete" ? "This action cannot be undone."
          : confirm?.kind === "cancel" ? "Allocated components go back to free stock and open picking tasks and jobs are cancelled. Cancelled work orders can't be reopened."
            : "Component allocations are released, pending picking tasks and the job are cancelled, and the work order returns to Open."}
        records={confirmRecords}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={runConfirm}
      />
    </div>
  );
}
