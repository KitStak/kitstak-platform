"use client";

/**
 * Return Station "Expected returns": the warehouse's outstanding RMAs (Started first, then In
 * Transit, then Pending; oldest expected date first) with a one-click Receive, so the operator
 * sees what is due at the station without leaving it. "View all" opens Return Orders filtered.
 */
import * as React from "react";
import Link from "next/link";
import { ClipboardList, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { DisabledReason } from "@/components/ui/tooltip";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { DARK_SAFE_PILL } from "./returns-client";

interface OpenRma {
  readonly id: string; readonly rmaCode: string; readonly status: string; readonly orderCode: string | null; readonly customerName: string | null;
  readonly clientName: string; readonly expectedReturnDate: string | null; readonly requestedQty: number; readonly returnedQty: number;
}

export function ExpectedReturns({ warehouseId, disabledReason, onReceive }: { readonly warehouseId: string; readonly disabledReason: string | null; readonly onReceive: (rmaCode: string) => void }) {
  const fmt = useFormat();
  const q = useApiQuery<{ readonly rows: readonly OpenRma[]; readonly total: number }>(["returns", "open", warehouseId], "/api/returns/open", { query: { warehouseId, limit: "8" }, refetchInterval: 60_000 });
  const data = q.data?.data;
  return (
    <Card className="overflow-hidden p-0" data-testid="expected-returns">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><ClipboardList className="h-4 w-4 text-secondary" aria-hidden />Expected returns{data ? <span className="text-secondary tabular-nums">({data.total})</span> : null}</h3>
        <Link href="/orders/returns?f.status=in%3APending%2CIn%20Transit%2CStarted" className="text-xs font-medium text-primary hover:underline">View all</Link>
      </div>
      {q.isPending ? <div className="space-y-1.5 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
        : q.error ? <div className="p-3"><Callout variant="error" title="Could not load open RMAs" action={<Button size="sm" onClick={() => void q.refetch()}>Retry</Button>}>{q.error.message}</Callout></div>
        : !data || data.rows.length === 0 ? <p className="px-4 py-4 text-sm text-secondary">No open RMAs in this warehouse. Customer returns without an RMA can be received manually.</p>
        : (
          <ul className="divide-y divide-border">
            {data.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <Link href={`/orders/returns/${r.id}`} className="font-semibold text-primary hover:underline">{r.rmaCode}</Link>
                <StatusPill status={r.status} domain="return" size="sm" className={DARK_SAFE_PILL} />
                <span className="min-w-0 flex-1 truncate text-secondary" title={[r.customerName, r.orderCode, r.clientName].filter(Boolean).join(" · ")}>
                  {[r.customerName, r.orderCode, r.clientName].filter(Boolean).join(" · ")}
                </span>
                <span className="text-xs text-secondary tabular-nums">{r.returnedQty}/{r.requestedQty}{r.expectedReturnDate ? ` · due ${fmt.date(r.expectedReturnDate)}` : ""}</span>
                <DisabledReason reason={disabledReason}>
                  <Button size="sm" variant="secondary" disabled={Boolean(disabledReason)} onClick={() => onReceive(r.rmaCode)} aria-label={`Receive ${r.rmaCode}`}><ScanLine className="h-3.5 w-3.5" aria-hidden />Receive</Button>
                </DisabledReason>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}
