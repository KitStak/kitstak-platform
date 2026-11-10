"use client";

/**
 * Receiving History (`/receiving/history`): every receipt (PO, return, kitting, add
 * inventory…). 34 columns, 25 filters, no bulk actions (Logiwa parity). Master ID opens the
 * receipt drawer; row menu Cancel reverses the receipt (blocked on Completed POs).
 */
import * as React from "react";
import { Ban, Eye, History } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { RECEIPT_GRID_FIELDS, RECEIVING_HISTORY_GRID_KEY } from "@/lib/grid-defs/receiving/receiving-history";
import { buildReceiptColumns, type ReceiptRow } from "./receipt-columns";
import { ReceiptDrawer } from "./receipt-drawer";
import { errorMessage, useFilterFields, useInvalidateReceiving, useCan } from "./receiving-shared";

export const HISTORY_HELPER = "The Receiving History Report lists all past purchase order receiving actions and inventory adding actions.";
export const CANCEL_RECEIPT_TITLE = "Are you sure you want to cancel the receiving?";

/** Cancels one receipt with the shared confirm; used by the history grid and the PO detail page. */
export function useCancelReceipt(onDone?: () => void) {
  const fmt = useFormat();
  const invalidate = useInvalidateReceiving();
  const [target, setTarget] = React.useState<ReceiptRow | null>(null);
  const run = async (row: ReceiptRow) => {
    try {
      await apiRequest(`/api/receipts/${row.id}/cancel`, { method: "POST", body: {} });
      toast.success("Success", `Receipt ${row.masterId} cancelled. ${row.quantity.toLocaleString()} ${row.packType} of ${row.sku} were reversed from ${row.locationCode}.`);
      onDone?.();
    } catch (error) {
      toast.error("Error", errorMessage(error));
    } finally {
      await invalidate();
    }
  };
  const dialog = (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && setTarget(null)}
      variant="danger"
      icon={Ban}
      title={CANCEL_RECEIPT_TITLE}
      description="This action cannot be undone."
      records={target ? {
        columns: [{ key: "id", label: "Master ID" }, { key: "po", label: "PO number" }, { key: "sku", label: "SKU" }, { key: "qty", label: "Quantity" }, { key: "loc", label: "Location" }, { key: "at", label: "Received" }],
        rows: [{ id: String(target.masterId), po: target.poCode ?? "—", sku: target.sku, qty: target.quantity.toLocaleString(), loc: target.locationCode, at: fmt.dateTime(target.receivedAt) }],
      } : undefined}
      confirmLabel="Yes"
      cancelLabel="No"
      onConfirm={() => (target ? run(target) : undefined)}
    />
  );
  return { ask: setTarget, dialog };
}

export function ReceivingHistoryPage() {
  const fields = useFilterFields(RECEIPT_GRID_FIELDS);
  const g = useGrid<ReceiptRow>({ gridKey: RECEIVING_HISTORY_GRID_KEY, path: "/api/receipts", fields });
  const canCancel = useCan("inventory.receiving_history.cancel").allowed;
  const [openId, setOpenId] = React.useState<string | null>(null);
  const cancel = useCancelReceipt();
  const columns = React.useMemo(() => buildReceiptColumns((row) => setOpenId(row.id)), []);

  const rowActions = (row: ReceiptRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => setOpenId(row.id) },
    ...(row.purchaseOrderId ? [{ key: "po", label: "Open purchase order", icon: History, href: `/receiving/${row.purchaseOrderId}` }] : []),
    ...(canCancel ? [{ key: "cancel", label: "Cancel", icon: Ban, destructive: true, disabledReason: row.cancelBlockedReason, onSelect: () => cancel.ask(row) }] : []),
  ];

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Purchase Order" tabs="receiving" helper={HISTORY_HELPER} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by PO number, SKU or master ID" bulkNoun="receipt" />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<ReceiptRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          selectable={false}
          onRowClick={(row) => setOpenId(row.id)}
          emptyTitle="No receipts match this view"
          emptyDescription="Receipts appear here when purchase orders, returns or kits are received."
        />
      </div>
      <ReceiptDrawer receiptId={openId} onOpenChange={(open) => !open && setOpenId(null)} canCancel={canCancel} onCancel={(row) => cancel.ask(row)} onOpenReceipt={setOpenId} />
      {cancel.dialog}
    </div>
  );
}
