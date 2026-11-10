"use client";

/**
 * Receiving History (`/receiving/history`): every receipt (PO, return, kitting, add
 * inventory…). 34 columns, 25 filters, no bulk actions (Logiwa parity). Master ID opens the
 * receipt drawer; row menu Cancel reverses the receipt (blocked on Completed POs).
 */
import * as React from "react";
import Link from "next/link";
import { Ban, Eye, History, ScrollText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { receivingLedgerHref } from "@/lib/grid-defs/receiving/receiving-ledger";
import { DataGrid, GridToolbar, useGrid, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { RECEIPT_GRID_FIELDS, RECEIVING_HISTORY_GRID_KEY } from "@/lib/grid-defs/receiving/receiving-history";
import { buildReceiptColumns, type ReceiptRow } from "./receipt-columns";
import { ReceiptDrawer } from "./receipt-drawer";
import { useCancelReceipt } from "./receipt-cancel";

export { CANCEL_RECEIPT_TITLE, markReceiptCancelled, useCancelReceipt } from "./receipt-cancel";

import { ReceivingReportLinks, slowLoadError, useCan, useFilterFields, useSlowLoad } from "./receiving-shared";

export const HISTORY_HELPER = "The Receiving History Report lists all past purchase order receiving actions and inventory adding actions.";
export function ReceivingHistoryPage() {
  const fields = useFilterFields(RECEIPT_GRID_FIELDS);
  const g = useGrid<ReceiptRow>({ gridKey: RECEIVING_HISTORY_GRID_KEY, path: "/api/receipts", fields });
  const slow = useSlowLoad(g.isLoading);
  const canCancel = useCan("inventory.receiving_history.cancel").allowed;
  const canCreatePo = useCan("inventory.purchase_orders.create").allowed;
  const [openId, setOpenId] = React.useState<string | null>(null);
  const cancel = useCancelReceipt();
  const columns = React.useMemo(() => buildReceiptColumns((row) => setOpenId(row.id)), []);

  const rowActions = (row: ReceiptRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => setOpenId(row.id) },
    ...(row.purchaseOrderId ? [{ key: "po", label: "Open purchase order", icon: History, href: `/receiving/${row.purchaseOrderId}` }] : []),
    { key: "ledger", label: "Ledger transactions", icon: ScrollText, href: receivingLedgerHref({ poCode: row.poCode, sku: row.sku }) },
    ...(canCancel ? [{ key: "cancel", label: "Cancel receiving", icon: Ban, destructive: true, disabledReason: row.cancelBlockedReason, onSelect: () => cancel.ask(row) }] : []),
  ];

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Receiving History" tabs="receiving" helper={HISTORY_HELPER} actions={<><Link href={receivingLedgerHref()} className={buttonVariants({ variant: "secondary" })}><ScrollText className="h-3.5 w-3.5" aria-hidden />Transactions</Link><ReceivingReportLinks /></>} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by PO number, SKU or master ID" bulkNoun="receipt" />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<ReceiptRow>
          {...g.gridProps}
          loading={g.gridProps.loading && !slow}
          error={slowLoadError(g.gridProps.error, slow)}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          selectable={false}
          onRowClick={(row) => setOpenId(row.id)}
          emptyTitle="There is no receiving history."
          emptyDescription="Receipts appear here when purchase orders, returns or kits are received. Clear the filters to see every receipt."
          emptyAction={canCreatePo ? <Link href="/receiving/new" className="text-[13px] font-medium text-primary hover:underline">You can create purchase orders here.</Link> : undefined}
        />
      </div>
      <ReceiptDrawer receiptId={openId} seed={openId ? g.rows.find((row) => row.id === openId) ?? null : null} onOpenChange={(open) => !open && setOpenId(null)} canCancel={canCancel} onCancel={(row) => cancel.ask(row)} onOpenReceipt={setOpenId} />
      {cancel.dialog}
    </div>
  );
}
