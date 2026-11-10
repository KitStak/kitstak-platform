"use client";

/**
 * Receiving transactions (`/receiving/transactions`). The full inventory ledger (every
 * Transaction History column: source / target location, LP, lot, expiry, damage, signed
 * quantities, on-hand before / after, user, algorithm…) scoped to receiving: it opens with
 * the receiving transaction types as a filter chip, and the receipt drawer, PO detail and
 * Receiving History link here with the PO, SKU and user as real, removable filters.
 * Export As Excel and saved views come from the shared report grid.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, PackageCheck, Undo2 } from "lucide-react";
import { ReportGridPage } from "@/components/reports/report-grid-page";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { TRANSACTION_HISTORY_DEF } from "@/lib/grid-defs/reports/logs";
import { RECEIVING_LEDGER_DEFAULT_QUERY, RECEIVING_TXN_TYPES, receivingLedgerHref } from "@/lib/grid-defs/receiving/receiving-ledger";
import { useCan } from "./receiving-shared";

export const RECEIVING_LEDGER_HELPER =
  "Every ledger transaction written by receiving: receipts, cancelled receipts, return receipts and kit builds. Filter by purchase order, SKU, user or transaction type; every column of the Transaction History is available.";

const DEF = { ...TRANSACTION_HISTORY_DEF, title: "Receiving transactions", helper: RECEIVING_LEDGER_HELPER };

function Presets() {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]" role="group" aria-label="Transaction type presets">
      <span className="text-secondary">Show:</span>
      <Button size="sm" variant="secondary" onClick={() => router.push(receivingLedgerHref())}><PackageCheck className="h-3.5 w-3.5" aria-hidden />All receiving types</Button>
      <Button size="sm" variant="secondary" onClick={() => router.push(receivingLedgerHref({ types: ["Cancel Receiving"] }))}><Ban className="h-3.5 w-3.5" aria-hidden />Cancel receiving</Button>
      <Button size="sm" variant="secondary" onClick={() => router.push(receivingLedgerHref({ types: ["Return Receiving"] }))}><Undo2 className="h-3.5 w-3.5" aria-hidden />Return receiving</Button>
      <span className="text-faint">Types in scope: {RECEIVING_TXN_TYPES.join(", ")}.</span>
    </div>
  );
}

export function ReceivingLedgerPage() {
  const can = useCan(TRANSACTION_HISTORY_DEF.permission);
  if (can.isLoading) {
    return (
      <div className="flex flex-col gap-3 px-6 pt-5" aria-busy>
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-[360px] w-full" />
      </div>
    );
  }
  if (!can.allowed) {
    return (
      <div className="px-6 pt-5">
        <h1 className="mb-3 text-[20px] font-semibold text-foreground">Receiving transactions</h1>
        <Callout variant="attention" title="You don't have access to the transaction ledger">
          Ask an administrator for the Transaction History permission. Receipts are still listed in <Link className="text-primary hover:underline" href="/receiving/history">Receiving History</Link>.
        </Callout>
      </div>
    );
  }
  return (
    <ReportGridPage
      def={DEF}
      tabs="receiving"
      crumbLabel="Receiving transactions"
      defaultQuery={RECEIVING_LEDGER_DEFAULT_QUERY}
      banner={<Presets />}
      emptyTitle="No receiving transactions match these filters"
      emptyDescription="Receipts, cancelled receipts and return receipts appear here as they are posted. Clear a filter to widen the search."
    />
  );
}
