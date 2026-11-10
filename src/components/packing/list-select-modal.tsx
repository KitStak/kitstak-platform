"use client";

/**
 * List & Select (Order mode): ready-to-pack orders of the station's warehouse with
 * filters (order code, client, job, note, expected ship date). Pick one → Start Packing.
 */
import * as React from "react";
import { PackageOpen } from "lucide-react";
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

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ListSelectModal({ open, onOpenChange, warehouseId, onStart }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly warehouseId: string; readonly onStart: (orderCode: string) => void }) {
  const fmt = useFormat();
  const me = useMe();
  const clients = me.data?.data.contextOptions.clients ?? [];
  const [f, setF] = React.useState({ q: "", clientId: null as string | null, jobCode: "", note: "", expectedShipDate: "" });
  const [selected, setSelected] = React.useState<string | null>(null);
  const df = useDebounced(f);
  const query: Record<string, string> = { warehouseId };
  if (df.q) query.q = df.q;
  if (df.clientId) query.clientId = df.clientId;
  if (df.jobCode) query.jobCode = df.jobCode;
  if (df.note) query.note = df.note;
  if (/^\d{4}-\d{2}-\d{2}$/.test(df.expectedShipDate)) query.expectedShipDate = df.expectedShipDate;
  const list = useApiQuery<readonly ReadyOrderRow[]>(["packing", "ready", query], open ? "/api/packing/orders" : null, { query, staleTime: 0 });
  const rows = list.data?.data ?? [];
  const chosen = rows.find((r) => r.id === selected) ?? null;

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
            <TextField aria-label="Expected ship date" type="date" value={f.expectedShipDate} onChange={(e) => setF({ ...f, expectedShipDate: e.target.value })} />
          </div>
          {list.isPending ? <div className="space-y-1.5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            : list.error ? <Callout variant="error" title="Could not load orders" action={<Button size="sm" onClick={() => void list.refetch()}>Retry</Button>}>{list.error.message}</Callout>
            : rows.length === 0 ? <EmptyState compact icon={PackageOpen} title="No orders ready to pack" description="Orders show here once picking is complete. Clear the filters to see all of them." />
            : (
              <div className="max-h-[420px] overflow-auto rounded-lg border border-border" role="radiogroup" aria-label="Orders ready to pack">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-surface-sunken text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">
                    <tr><th className="w-10 px-3 py-2" /><th className="px-3 py-2 text-left">Order</th><th className="px-3 py-2 text-left">Client</th><th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2 text-left">Job</th><th className="px-3 py-2 text-left">Expected ship</th><th className="px-3 py-2 text-right">Units</th><th className="px-3 py-2 text-left">Status</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} role="radio" aria-checked={selected === r.id} tabIndex={0} onClick={() => setSelected(r.id)} onDoubleClick={() => onStart(r.code)}
                        onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); setSelected(r.id); } if (e.key === "Enter") onStart(r.code); }}
                        className={cn("cursor-pointer border-b border-border last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40", selected === r.id ? "bg-primary-soft" : "hover:bg-surface-sunken")}>
                        <td className="px-3 py-2"><span className={cn("block h-4 w-4 rounded-full border-2", selected === r.id ? "border-primary bg-primary shadow-[inset_0_0_0_2px_white]" : "border-border-strong")} aria-hidden /></td>
                        <td className="px-3 py-2 font-semibold">{r.code}{r.priority === "High" ? <span className="ml-1.5 rounded bg-danger-soft px-1 text-[10px] font-semibold text-danger">High</span> : null}</td>
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
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto text-[12px] text-secondary">{rows.length} order{rows.length === 1 ? "" : "s"}</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!chosen} onClick={() => chosen && onStart(chosen.code)} title={chosen ? undefined : "Select an order"}>Start packing</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
