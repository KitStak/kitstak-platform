"use client";

/**
 * List & Select (Order mode): ready-to-pack orders of the station's warehouse with
 * filters (order code, client, job, note, expected ship date). Pick one → Start Packing.
 */
import * as React from "react";
import { Lock, PackageOpen } from "lucide-react";
import { DisabledReason } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { TextField } from "@/components/ui/text-field";
import { useFormat } from "@/lib/format";
import { useMe } from "@/lib/permissions-client";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import type { ReadyOrderRow } from "./pack-types";
import { DatePicker } from "@/components/ui/date-picker";

/** YYYY-MM-DD (local) ⇄ Date for the shared DatePicker. */
function dayToDate(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function dateToDay(d: Date | null): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ListSelectModal({ open, onOpenChange, warehouseId, stationId, onStart }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly warehouseId: string; readonly stationId?: string; readonly onStart: (orderCode: string) => void }) {
  const fmt = useFormat();
  const me = useMe();
  const clients = me.data?.data.contextOptions.clients ?? [];
  const [f, setF] = React.useState({ q: "", clientId: null as string | null, jobCode: "", note: "", expectedShipDate: "" });
  const [selected, setSelected] = React.useState<string | null>(null);
  const df = useDebounced(f);
  const query: Record<string, string> = { warehouseId };
  if (stationId) query.stationId = stationId;
  if (df.q) query.q = df.q;
  if (df.clientId) query.clientId = df.clientId;
  if (df.jobCode) query.jobCode = df.jobCode;
  if (df.note) query.note = df.note;
  if (/^\d{4}-\d{2}-\d{2}$/.test(df.expectedShipDate)) query.expectedShipDate = df.expectedShipDate;
  const list = useApiQuery<readonly ReadyOrderRow[]>(["packing", "ready", query], open ? "/api/packing/orders" : null, { query, staleTime: 0 });
  const rows = list.data?.data ?? [];
  const chosen = rows.find((r) => r.id === selected) ?? null;
  const lockedCount = rows.filter((r) => r.countLock).length;
  const startReason = !chosen ? "Select an order" : chosen.countLock ? chosen.countLock.reason : null;
  const start = (r: ReadyOrderRow) => { if (!r.countLock) onStart(r.code); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader title="List and select order" description="Orders that are picked and ready to pack at this warehouse." />
        <DialogBody className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-5">
            <TextField aria-label="Order code" placeholder="Order code starts with" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
            <Select aria-label="Client" value={f.clientId} clearable options={clients.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => setF({ ...f, clientId: v })} placeholder="All clients" />
            <TextField aria-label="Job code" placeholder="Job code" value={f.jobCode} onChange={(e) => setF({ ...f, jobCode: e.target.value })} />
            <TextField aria-label="Note" placeholder="Note contains" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            <DatePicker aria-label="Expected ship date" clearable placeholder="Expected ship date" value={dayToDate(f.expectedShipDate)} onChange={(d) => setF({ ...f, expectedShipDate: dateToDay(d) })} />
          </div>
          {list.isPending ? <div className="space-y-1.5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            : list.error ? <Callout variant="error" title="Could not load orders" action={<Button size="sm" onClick={() => void list.refetch()}>Retry</Button>}>{list.error.message}</Callout>
            : rows.length === 0 ? <EmptyState compact icon={PackageOpen} title="No orders ready to pack" description="Orders show here once picking is complete. Clear the filters to see all of them." />
            : (
              <div className="max-h-[420px] overflow-auto rounded-lg border border-border" role="radiogroup" aria-label="Orders ready to pack">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-sunken text-2xs font-semibold text-secondary">
                    <tr><th className="w-10 px-3 py-2" /><th className="px-3 py-2 text-left">Order</th><th className="px-3 py-2 text-left">Client</th><th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2 text-left">Job</th><th className="px-3 py-2 text-left">Expected ship</th><th className="px-3 py-2 text-right">Units</th><th className="px-3 py-2 text-left">Status</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} role="radio" aria-checked={selected === r.id} tabIndex={0} onClick={() => setSelected(r.id)} onDoubleClick={() => start(r)}
                        onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); setSelected(r.id); } if (e.key === "Enter") start(r); }}
                        className={cn("cursor-pointer border-b border-border last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40", selected === r.id ? "bg-primary-soft" : "hover:bg-surface-sunken")}>
                        <td className="px-3 py-2"><span className={cn("block h-4 w-4 rounded-full border-2", selected === r.id ? "border-primary bg-primary shadow-[inset_0_0_0_2px_white]" : "border-border-strong")} aria-hidden /></td>
                        <td className="px-3 py-2 font-semibold">{r.code}{r.priority === "High" ? <span className="ml-1.5 rounded bg-danger-soft px-1 text-2xs font-semibold text-danger">High</span> : null}
                          {r.countLock ? <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-danger-soft px-1.5 py-0.5 text-2xs font-semibold text-danger" title={r.countLock.reason} data-testid="list-lock-pill"><Lock className="h-3 w-3" aria-hidden />Locked by {r.countLock.planCode}</span> : null}</td>
                        <td className="px-3 py-2">{r.clientName}</td>
                        <td className="px-3 py-2">{r.customerName}</td>
                        <td className="px-3 py-2">{r.jobCode ?? "—"}</td>
                        <td className="px-3 py-2">{r.expectedShipDate ? fmt.date(r.expectedShipDate) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.unitsToPack}</td>
                        <td className="px-3 py-2"><StatusPill status={r.status} domain="shipmentOrder" size="sm" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          {chosen?.countLock ? <Callout variant="error" title={`Locked by count plan ${chosen.countLock.planCode}`}>{chosen.countLock.reason}</Callout> : null}
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto text-xs text-secondary" aria-live="polite">{list.isPending ? "Loading orders…" : list.error ? "Not loaded" : `${rows.length} order${rows.length === 1 ? "" : "s"}${lockedCount ? ` · ${lockedCount} count-locked` : ""}${list.isFetching ? " · updating…" : ""}`}</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <DisabledReason reason={startReason}>
            <Button variant="primary" disabled={Boolean(startReason)} data-testid="list-start" onClick={() => chosen && start(chosen)}>Start packing</Button>
          </DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
