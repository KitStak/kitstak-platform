"use client";

/**
 * Location detail > Ledger history (critic R5): paged (25 per page, no silent 100-row cap),
 * Movements / Reservations / All filter (allocations are reservations, not stock movements),
 * direction and quantity from the signed quantity (an adjustment of −2 reads Out 2), and links
 * to Transaction History pre-filtered to this location (In = To location, Out = From location).
 */
import * as React from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, History, Link2, RefreshCw } from "lucide-react";
import { filteredListHref } from "@/components/grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Muted } from "@/components/facility/facility-shared";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { ledgerEmptyCopy, type LedgerKind } from "@/lib/grid-defs/facility/location-ledger";
import type { LocationLedgerRow } from "@/server/repositories/locations";

const PAGE_SIZE = 25;

function Direction({ row }: { readonly row: LocationLedgerRow }) {
  if (row.reservation) return <span className="inline-flex items-center gap-1 text-info"><Link2 className="h-3.5 w-3.5" aria-hidden />Reserved</span>;
  if (row.direction === "In") return <span className="inline-flex items-center gap-1 text-success"><ArrowDownLeft className="h-3.5 w-3.5" aria-hidden />In</span>;
  if (row.direction === "Out") return <span className="inline-flex items-center gap-1 text-danger"><ArrowUpRight className="h-3.5 w-3.5" aria-hidden />Out</span>;
  return <span className="inline-flex items-center gap-1 text-secondary"><RefreshCw className="h-3.5 w-3.5" aria-hidden />Within</span>;
}

export function LocationLedgerTab({ id, code, warehouseId }: { readonly id: string; readonly code: string; readonly warehouseId: string }) {
  const fmt = useFormat();
  const [kind, setKind] = React.useState<LedgerKind>("movements");
  const [page, setPage] = React.useState(1);
  const q = useApiQuery<LocationLedgerRow[]>(["location-ledger", id, kind, page], `/api/locations/${id}/ledger`, { query: { page, ps: PAGE_SIZE, kind }, placeholderData: (p) => p, staleTime: 0 });
  const rows = q.data?.data ?? [];
  const total = q.data?.meta?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const history = (direction: "in" | "out") => filteredListHref("/reports/transaction-history", [
    { field: "warehouseId", op: "in", values: [warehouseId] },
    { field: direction === "in" ? "targetLocation" : "sourceLocation", op: "eq", value: code },
  ]);
  const empty = ledgerEmptyCopy(kind);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl<LedgerKind> size="sm" ariaLabel="Ledger filter" value={kind} onChange={(v) => { setKind(v); setPage(1); }}
          options={[{ value: "movements", label: "Stock movements" }, { value: "reservations", label: "Reservations" }, { value: "all", label: "All" }]} />
        <nav aria-label="Open in Transaction History" className="flex items-center gap-3 text-xs">
          <span className="text-faint">Transaction History:</span>
          <Link href={history("in")} className="text-primary hover:underline">Into {code}</Link>
          <Link href={history("out")} className="text-primary hover:underline">Out of {code}</Link>
        </nav>
      </div>
      {q.isPending ? <Skeleton className="h-40 w-full" /> : q.isError ? (
        <EmptyState compact title="Couldn't load the ledger" description={q.error.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={History} title={empty.title} description={empty.description} />
      ) : (
        <div className={q.isPlaceholderData ? "opacity-60 transition-opacity" : undefined} aria-busy={q.isFetching}>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-sunken text-2xs text-secondary">
                <tr>
                  {["Date", "Type", "SKU", "Lot", "Direction"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{h}</th>)}
                  <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-sunken/60">
                    <td className="whitespace-nowrap px-3 py-2">{fmt.dateTime(t.at)}</td>
                    <td className="px-3 py-2">{t.type}{t.reservation ? <Badge tone="info" size="sm" className="ml-1.5">Reservation</Badge> : null}</td>
                    <td className="px-3 py-2 font-medium"><Link href={`/products/${t.productId}`} className="text-primary underline-offset-2 hover:underline">{t.sku}</Link></td>
                    <td className="px-3 py-2">{t.lotNumber ?? <Muted />}</td>
                    <td className="px-3 py-2"><Direction row={t} /></td>
                    <td className="px-3 py-2 text-right tabular-nums" title={t.reservation ? "Units reserved, not moved" : t.delta !== 0 ? `On-hand change ${t.delta > 0 ? "+" : "−"}${t.qty}` : "No on-hand change"}>{t.qty.toLocaleString("en-US")}</td>
                    <td className="px-3 py-2 text-secondary">{t.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-secondary">
            <span>{total.toLocaleString("en-US")} {kind === "reservations" ? (total === 1 ? "reservation" : "reservations") : total === 1 ? "entry" : "entries"} · newest first</span>
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="tabular-nums">{page} / {pages}</span>
              <Button size="icon-sm" variant="ghost" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
