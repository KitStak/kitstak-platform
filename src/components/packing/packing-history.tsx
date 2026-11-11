"use client";

/**
 * Packing dashboard "My packing today" card with Logiwa's two utilities:
 * **Clear completed** (hides the orders packed so far from this list; the KPIs are not
 * touched) and **Excel export history** (downloads the listed orders as .xlsx).
 */
import * as React from "react";
import Link from "next/link";
import { Eraser, FileSpreadsheet, History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";

export interface PackHistoryRow {
  readonly orderId: string;
  readonly orderCode: string;
  readonly status: string;
  readonly clientName: string;
  readonly customerName: string | null;
  readonly units: number;
  readonly packages: number;
  readonly trackingNumber: string | null;
  readonly stationCode: string | null;
  readonly packedAt: string;
}

const clearKey = (warehouseId: string) => `ks.packing.clearedAt.${warehouseId}`;

function readCleared(warehouseId: string): string | null {
  try {
    const v = window.localStorage.getItem(clearKey(warehouseId));
    if (!v) return null;
    // A mark from an earlier day no longer matters (the list is today only).
    return new Date(v).toDateString() === new Date().toDateString() ? v : null;
  } catch {
    return null;
  }
}

function writeCleared(warehouseId: string, v: string | null): void {
  try {
    if (v) window.localStorage.setItem(clearKey(warehouseId), v);
    else window.localStorage.removeItem(clearKey(warehouseId));
  } catch { /* storage unavailable: the clear lasts for this visit only */ }
}

/** Sheet rows for the export (PURE, unit tested). */
export function historySheetRows(rows: readonly PackHistoryRow[]): readonly (string | number | Date | null)[][] {
  return rows.map((r) => [r.orderCode, r.status, r.clientName, r.customerName, r.units, r.packages, r.trackingNumber, r.stationCode, new Date(r.packedAt)]);
}

export const HISTORY_HEADERS = ["Shipment Order Code", "Status", "Client", "Customer", "Packed Quantity", "Packages", "Tracking Number", "Packing Station", "Packed At"] as const;

async function exportXlsx(rows: readonly PackHistoryRow[], warehouseCode: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Packing history");
  ws.columns = HISTORY_HEADERS.map((h) => ({ header: h, width: Math.max(14, h.length + 4) }));
  for (const r of historySheetRows(rows)) ws.addRow(r);
  ws.getRow(1).font = { bold: true };
  ws.getColumn(HISTORY_HEADERS.length).numFmt = "m/d/yyyy h:mm AM/PM";
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `packing-history-${warehouseCode.toLowerCase() || "warehouse"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PackingHistoryCard({ warehouseId, warehouseCode }: { readonly warehouseId: string | null; readonly warehouseCode: string }) {
  const fmt = useFormat();
  const [cleared, setCleared] = React.useState<string | null>(null);
  React.useEffect(() => { setCleared(warehouseId ? readCleared(warehouseId) : null); }, [warehouseId]);
  const q = useApiQuery<readonly PackHistoryRow[]>(["packing", "history", warehouseId ?? "", cleared ?? ""], warehouseId ? "/api/packing/history" : null,
    { query: warehouseId ? { warehouseId, ...(cleared ? { since: cleared } : {}) } : undefined, refetchInterval: 30_000, staleTime: 0 });
  const rows = q.data?.data ?? [];
  const [exporting, setExporting] = React.useState(false);

  const clear = () => {
    if (!warehouseId) return;
    const now = new Date().toISOString();
    writeCleared(warehouseId, now);
    setCleared(now);
    toast.success("Completed orders cleared", "Orders packed from now on will show here. Your KPIs are unchanged.");
  };
  const restore = () => {
    if (!warehouseId) return;
    writeCleared(warehouseId, null);
    setCleared(null);
  };
  const doExport = async () => {
    setExporting(true);
    try {
      await exportXlsx(rows, warehouseCode);
    } catch {
      toast.error("Export failed", "The Excel file could not be created.");
    } finally {
      setExporting(false);
    }
  };
  const empty = rows.length === 0;

  return (
    <Card className="flex flex-col gap-3 p-4" aria-labelledby="pack-history-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pack-history-title" className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-secondary" aria-hidden />My packing today</h2>
        <div className="flex gap-1.5">
          <DisabledReason reason={!warehouseId ? "Choose a warehouse first" : empty ? "No completed orders to clear" : null}>
            <Button size="sm" variant="ghost" disabled={!warehouseId || empty} onClick={clear}><Eraser className="h-3.5 w-3.5" aria-hidden />Clear completed</Button>
          </DisabledReason>
          <DisabledReason reason={!warehouseId ? "Choose a warehouse first" : empty ? "Nothing to export yet" : exporting ? "Preparing the file…" : null}>
            <Button size="sm" variant="secondary" disabled={!warehouseId || empty || exporting} onClick={() => void doExport()}><FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />Excel export history</Button>
          </DisabledReason>
        </div>
      </div>
      {q.isPending && warehouseId ? (
        <div className="space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
      ) : q.error ? (
        <p role="alert" className="text-xs text-danger">Could not load your packing history. <button type="button" className="font-medium underline" onClick={() => void q.refetch()}>Retry</button></p>
      ) : empty ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-secondary">
          {cleared ? <>Cleared at {fmt.time(cleared)}. Orders you pack next show here. <button type="button" className="inline-flex items-center gap-1 font-medium text-primary hover:underline" onClick={restore}><RotateCcw className="h-3 w-3" aria-hidden />Show all of today</button></> : "Orders you finish packing today show here."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[520px] text-xs">
            <thead className="bg-surface-sunken/60 text-2xs font-semibold text-secondary">
              <tr><th className="px-3 py-1.5 text-left">Order</th><th className="px-3 py-1.5 text-left">Status</th><th className="px-3 py-1.5 text-right">Units</th><th className="px-3 py-1.5 text-left">Tracking</th><th className="px-3 py-1.5 text-right">Packed</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.orderId} className="border-t border-border">
                  <td className="px-3 py-1.5"><Link href={`/orders/${r.orderId}`} className="font-medium text-primary hover:underline">{r.orderCode}</Link><span className="block truncate text-2xs text-secondary">{r.clientName}</span></td>
                  <td className="px-3 py-1.5"><StatusPill status={r.status} domain="shipmentOrder" size="sm" /></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.units}</td>
                  <td className="max-w-[160px] truncate px-3 py-1.5 font-mono text-2xs" title={r.trackingNumber ?? undefined}>{r.trackingNumber ?? <span className="font-sans text-secondary">No label</span>}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-secondary">{fmt.time(r.packedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cleared && !empty ? <p className="text-2xs text-secondary">Showing orders packed since {fmt.time(cleared)}. <button type="button" className="font-medium text-primary hover:underline" onClick={restore}>Show all of today</button></p> : null}
    </Card>
  );
}
