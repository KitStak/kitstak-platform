"use client";

/**
 * Purchase Orders list (`/receiving`). Shared grid (search mode, filters, chips, saved
 * views, column chooser, density, page sizes, async xlsx export) plus the Logiwa bulk
 * actions: Tag, Label ▾, Cancel Order, Receive PO, Delete ▾. Every destructive bulk
 * action runs through ConfirmDialog with a mini table; results come back per id.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, ChevronDown, Eye, FileText, History, PackageCheck, Pencil, Plus, Printer, Tag as TagIcon, Trash2, Upload } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { ChangeLogDrawer, PrintOptionsModal, TagPopover } from "@/components/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { PO_GRID_FIELDS, PURCHASE_ORDERS_GRID_KEY } from "@/lib/grid-defs/receiving/purchase-orders";
import { buildPoColumns } from "./po-columns";
import { bulkToast, errorMessage, openFile, postBulk, useFilterFields, useInvalidateReceiving, type PoRow, useCan } from "./receiving-shared";

const P = "inventory.purchase_orders.";
export const SERIAL_PREADVICE_REASON = "Serial number pre-advice isn't set up for purchase orders yet.";
export const PO_HELPER = "A purchase order is a document issued by a buyer (you), specifying the products to be delivered by a vendor in the future.";

type Dialog = { kind: "cancel" | "receive" | "delete"; rows: readonly PoRow[] } | null;

const OPEN = new Set(["Pending", "Started"]);
export function cancelReason(rows: readonly PoRow[]): string | null {
  const bad = rows.find((r) => !OPEN.has(r.status));
  if (bad) return `Only Pending or Started orders can be cancelled (${bad.code} is ${bad.status}).`;
  const received = rows.find((r) => r.activeReceipts > 0);
  return received ? `${received.code} has received lines. Cancel its receipts first.` : null;
}
export function receiveReason(rows: readonly PoRow[]): string | null {
  const bad = rows.find((r) => !OPEN.has(r.status));
  return bad ? `Only Pending or Started orders can be received (${bad.code} is ${bad.status}).` : null;
}
export function deleteReason(rows: readonly PoRow[]): string | null {
  const bad = rows.find((r) => r.status !== "Pending" || r.activeReceipts > 0 || r.receivedQuantity > 0);
  return bad ? `Only Pending purchase orders without receipts can be deleted (${bad.code}).` : null;
}

function HeaderActions({ canCreate, canImport, canImportSerials }: { readonly canCreate: boolean; readonly canImport: boolean; readonly canImportSerials: boolean }) {
  return (
    <>
      {canImport || canImportSerials ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Import
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuItem href="/imports/purchase-orders" icon={FileText} disabledReason={canImport ? null : "You don't have permission to import purchase orders"} description="Purchase orders and vendors from Excel">
              Purchase orders
            </DropdownMenuItem>
            <DropdownMenuItem href="/imports/po-serials" icon={FileText} disabledReason={canImportSerials ? null : "You don't have permission to import serial numbers"} description="Serial numbers per PO line">
              Serial numbers
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canCreate ? (
        <Link href="/receiving/new" className={buttonVariants({ variant: "primary" })}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create purchase order
        </Link>
      ) : null}
    </>
  );
}

export function PoListPage() {
  const router = useRouter();
  const fmt = useFormat();
  const invalidate = useInvalidateReceiving();
  const fields = useFilterFields(PO_GRID_FIELDS, { customFieldEntity: "purchase_order", tagScope: "purchase_order" });
  const g = useGrid<PoRow>({ gridKey: PURCHASE_ORDERS_GRID_KEY, path: "/api/purchase-orders", fields });
  const columns = React.useMemo(() => buildPoColumns(), []);
  const can = {
    create: useCan(`${P}create`).allowed, edit: useCan(`${P}edit`).allowed, del: useCan(`${P}delete`).allowed, cancel: useCan(`${P}cancel_order`).allowed,
    receive: useCan(`${P}receive_po`).allowed, tag: useCan(`${P}tag`).allowed, productLabel: useCan(`${P}product_label`).allowed,
    poLabel: useCan(`${P}purchase_order_label`).allowed, log: useCan(`${P}change_log`).allowed, imp: useCan(`${P}import_file`).allowed,
    impSerials: useCan(`${P}import_serial_numbers`).allowed, removeSerials: useCan(`${P}remove_serial_number`).allowed,
  };

  // Remember every row seen so selections across pages keep their status for guards.
  const [seen, setSeen] = React.useState<ReadonlyMap<string, PoRow>>(new Map());
  React.useEffect(() => {
    // g.rows may be a fresh array every render (empty fallback), so only commit real changes.
    setSeen((prev) => (g.rows.some((r) => prev.get(r.id) !== r) ? new Map([...prev, ...g.rows.map((r) => [r.id, r] as const)]) : prev));
  }, [g.rows]);
  const selected = g.selectedIds.map((id) => g.rows.find((r) => r.id === id) ?? seen.get(id)).filter((r): r is PoRow => Boolean(r));
  const codeOf = (id: string) => seen.get(id)?.code ?? g.rows.find((r) => r.id === id)?.code ?? "selected order";

  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [labels, setLabels] = React.useState<readonly unknown[] | null>(null);
  const [logFor, setLogFor] = React.useState<PoRow | null>(null);

  const finish = async () => {
    g.clearSelection();
    await invalidate();
  };

  const runBulk = async (kind: "cancel" | "receive" | "delete", rows: readonly PoRow[]) => {
    try {
      const result = await postBulk(`/api/purchase-orders/bulk/${kind}`, rows.map((r) => r.id));
      const verbs = {
        cancel: { done: "cancelled", noun: "order", successMessage: rows.length === 1 ? "You have successfully cancelled an order." : undefined },
        receive: { done: "received", noun: "order", successMessage: "You have successfully received orders." },
        delete: { done: "deleted", noun: "purchase order" },
      }[kind];
      bulkToast(result, codeOf, verbs);
    } catch (error) {
      toast.error("Error", errorMessage(error));
    } finally {
      await finish();
    }
  };

  const printProductLabels = async (ids: readonly string[]) => {
    try {
      const { data } = await apiRequest<unknown[]>("/api/purchase-orders/labels", { query: { ids: ids.join(",") } });
      if (data.length === 0) {
        toast.info("Nothing to print", "The selected purchase orders have no lines.");
        return;
      }
      setLabels(data);
    } catch (error) {
      toast.error("Error", errorMessage(error));
    }
  };

  const rowActions = (row: PoRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, href: `/receiving/${row.id}` },
    ...(can.edit ? [{ key: "edit", label: "Edit", icon: Pencil, href: `/receiving/${row.id}?step=details` }] : []),
    ...(can.log ? [{ key: "log", label: "Change log", icon: History, onSelect: () => setLogFor(row) }] : []),
    ...(can.del ? [{ key: "delete", label: "Delete", icon: Trash2, destructive: true, disabledReason: deleteReason([row]), onSelect: () => setDialog({ kind: "delete", rows: [row] }) }] : []),
  ];

  const none = selected.length === 0 ? "Select at least one purchase order" : null;
  const reasonCancel = none ?? cancelReason(selected);
  const reasonReceive = none ?? receiveReason(selected);
  const reasonDelete = none ?? deleteReason(selected);
  const targets = [...new Set((dialog?.rows ?? []).map((r) => r.receivingLocationCode ?? "the default receiving location"))];

  const trailing = (
    <div className="flex items-center gap-2">
      {can.tag ? (
        <TagPopover entityType="purchase_order" scope="purchase_order" ids={g.selectedIds} appliedTagIds={selected.length === 1 ? selected[0]?.tags.map((t) => t.id) : []}
          onApplied={() => void finish()} disabledReason={none}
          trigger={<Button variant="secondary" aria-label="Tag" disabled={Boolean(none)}><TagIcon className="h-3.5 w-3.5" aria-hidden /><span className="hidden xl:inline">Tag</span></Button>} />
      ) : null}
      {can.productLabel || can.poLabel ? (
        <DropdownMenu>
          <DisabledReason reason={none}>
            <DropdownMenuTrigger asChild disabled={Boolean(none)}>
              <Button variant="secondary" aria-label="Label" disabled={Boolean(none)}>
                <Printer className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden xl:inline">Label</span>
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </DisabledReason>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuItem icon={TagIcon} disabledReason={can.productLabel ? null : "You don't have permission to print product labels"} description="One label per ordered unit" onSelect={() => void printProductLabels(g.selectedIds)}>
              Product label
            </DropdownMenuItem>
            <DropdownMenuItem icon={FileText} disabledReason={can.poLabel ? null : "You don't have permission to print purchase orders"} description="The purchase order document (PDF)" onSelect={() => openFile(`/api/purchase-orders/documents?ids=${encodeURIComponent(g.selectedIds.join(","))}`)}>
              Purchase order
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {can.cancel ? (
        <DisabledReason reason={reasonCancel}>
          <Button variant="secondary" aria-label="Cancel order" disabled={Boolean(reasonCancel)} onClick={() => setDialog({ kind: "cancel", rows: selected })}>
            <Ban className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden xl:inline">Cancel order</span>
          </Button>
        </DisabledReason>
      ) : null}
      {can.receive ? (
        <DisabledReason reason={reasonReceive}>
          <Button variant="secondary" aria-label="Receive PO" disabled={Boolean(reasonReceive)} onClick={() => setDialog({ kind: "receive", rows: selected })}>
            <PackageCheck className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden xl:inline">Receive PO</span>
          </Button>
        </DisabledReason>
      ) : null}
      {can.del || can.removeSerials ? (
        <DropdownMenu>
          <DisabledReason reason={none}>
            <DropdownMenuTrigger asChild disabled={Boolean(none)}>
              <Button variant="secondary" aria-label="Delete" disabled={Boolean(none)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden xl:inline">Delete</span>
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </DisabledReason>
          <DropdownMenuContent align="end" className="min-w-[240px]">
            <DropdownMenuItem icon={Trash2} destructive disabledReason={can.del ? reasonDelete : "You don't have permission to delete purchase orders"} onSelect={() => setDialog({ kind: "delete", rows: selected })}>
              Delete purchase order
            </DropdownMenuItem>
            <DropdownMenuItem icon={Trash2} disabledReason={SERIAL_PREADVICE_REASON}>
              Remove serial number
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  const confirmRecords = dialog
    ? {
        columns: [{ key: "code", label: "PO number" }, { key: "status", label: "Status" }, { key: "date", label: "PO date" }, { key: "qty", label: "Open qty" }],
        rows: dialog.rows.map((r) => ({
          code: r.code, status: <StatusPill status={r.status} domain="purchaseOrder" size="sm" />, date: fmt.date(r.poDate),
          qty: Math.max(0, r.totalQuantity - r.receivedQuantity).toLocaleString(),
        })),
      }
    : undefined;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Purchase Order" tabs="receiving" helper={PO_HELPER} actions={<HeaderActions canCreate={can.create} canImport={can.imp} canImportSerials={can.impSerials} />} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by code or reference" bulkNoun="purchase order" trailing={trailing} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<PoRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          onRowClick={(row) => router.push(`/receiving/${row.id}`)}
          emptyTitle="No purchase orders match this view"
          emptyDescription="Clear the filters or create a purchase order to start receiving."
          emptyAction={can.create ? <Link href="/receiving/new" className={buttonVariants({ variant: "primary" })}><Plus className="h-3.5 w-3.5" aria-hidden />Create purchase order</Link> : undefined}
        />
      </div>

      <ConfirmDialog
        open={dialog?.kind === "cancel"}
        onOpenChange={(open) => !open && setDialog(null)}
        variant="danger"
        icon={Ban}
        title="Are you sure you want to cancel selected order(s)?"
        description="Cancelled purchase orders can't be received or changed."
        records={confirmRecords}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => runBulk("cancel", dialog?.rows ?? [])}
      />
      <ConfirmDialog
        open={dialog?.kind === "receive"}
        onOpenChange={(open) => !open && setDialog(null)}
        variant="info"
        icon={PackageCheck}
        title={`Receive ${dialog?.rows.length ?? 0} purchase order${dialog?.rows.length === 1 ? "" : "s"} in full?`}
        description={`Every open line is received into ${targets.join(", ")}. Lot, expiry and serial-tracked lines need Receive items on the order instead.`}
        records={confirmRecords}
        confirmLabel="Receive"
        cancelLabel="No"
        onConfirm={() => runBulk("receive", dialog?.rows ?? [])}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        variant="danger"
        title={`Delete ${dialog?.rows.length ?? 0} purchase order${dialog?.rows.length === 1 ? "" : "s"}?`}
        description="This action cannot be undone."
        records={confirmRecords}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => runBulk("delete", dialog?.rows ?? [])}
      />
      <PrintOptionsModal open={labels !== null} onOpenChange={(open) => !open && setLabels(null)} typeKeys={["product-label"]} records={labels ?? []} title="Print product labels" />
      {logFor ? <ChangeLogDrawer open onOpenChange={(open) => !open && setLogFor(null)} entityType="purchase_order" entityId={logFor.id} entityCode={logFor.code} /> : null}
    </div>
  );
}
