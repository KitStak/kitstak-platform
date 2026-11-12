"use client";

/**
 * Create label for order(s) (Logiwa puts Create Label beside Void and Reprint). Lists the orders that can
 * get a shipping label (search by order code, customer or store order; or a plan's orders), with the
 * carrier service the label will use ("Rate shop" when the order names none). Labels are bought through
 * `POST /api/orders/bulk/labels` (`create`), the same path as Shipment Orders → Label → Create label, and
 * the result lists every order with its tracking number or the carrier's error.
 */
import * as React from "react";
import Link from "next/link";
import { ExternalLink, ScanBarcode, Search } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import type { LabelCandidate } from "@/server/repositories/shipping-label-candidates";
import { errorMessage, fileUrl, postJson } from "./shipping-client";

interface LabelOutcome {
  readonly id: string;
  readonly code: string;
  readonly ok: boolean;
  readonly message: string;
  readonly trackingNumber?: string;
  readonly fileIds?: readonly string[];
}
interface LabelBulkResult {
  readonly outcomes: readonly LabelOutcome[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
  readonly fileIds: readonly string[];
}

export interface CreateLabelDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Limits the list to a shipment plan's orders (plan detail Orders tab). */
  readonly planId?: string;
  /** Orders to pre-select (for example the plan rows the user picked). */
  readonly preselect?: readonly string[];
  readonly title?: string;
  readonly onDone: () => void;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Outcome rows for the result table (PURE): failures keep the carrier's message. */
export function labelOutcomeRows(result: LabelBulkResult, codes: ReadonlyMap<string, string>): readonly { id: string; code: string; ok: boolean; text: string; fileId: string | null }[] {
  const seen = new Set<string>();
  const rows = result.outcomes.map((o) => {
    seen.add(o.id);
    return { id: o.id, code: o.code, ok: o.ok, text: o.ok ? o.trackingNumber ?? o.message : o.message, fileId: o.fileIds?.[0] ?? null };
  });
  for (const f of result.failed) if (!seen.has(f.id)) rows.push({ id: f.id, code: codes.get(f.id) ?? f.code, ok: false, text: f.message, fileId: null });
  return rows;
}

export function CreateLabelDialog({ open, onOpenChange, planId, preselect, title, onDone }: CreateLabelDialogProps) {
  const [q, setQ] = React.useState("");
  const query = useDebounced(q, 250);
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<LabelBulkResult | null>(null);
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (planId) params.set("planId", planId);
  const list = useApiQuery<readonly LabelCandidate[]>(["label-candidates", planId ?? "", query], open ? `/api/shipments/label-candidates?${params.toString()}` : null, { staleTime: 0 });
  const rows = list.data?.data ?? [];

  React.useEffect(() => {
    if (!open) return;
    setQ("");
    setResult(null);
    setPicked(new Set(preselect ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const eligible = rows.filter((r) => !r.blockedReason);
  // A plan's dialog starts with every order that can take a label selected.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (!open) { seeded.current = false; return; }
    if (seeded.current || !planId || preselect || !list.data) return;
    seeded.current = true;
    setPicked(new Set((list.data.data ?? []).filter((r) => !r.blockedReason).map((r) => r.id)));
  }, [open, planId, preselect, list.data]);
  const chosen = [...picked].filter((id) => rows.some((r) => r.id === id && !r.blockedReason));
  const toggle = (id: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  const submit = async () => {
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    try {
      const res = await postJson<LabelBulkResult>("/api/orders/bulk/labels", { action: "create", ids: chosen });
      setResult(res);
      const ok = res.outcomes.filter((o) => o.ok).length;
      if (ok > 0) toast.success("Labels created", `${ok} of ${chosen.length} ${chosen.length === 1 ? "order" : "orders"} labeled.`);
      else toast.error("No labels were created", res.failed[0]?.message ?? res.outcomes[0]?.message ?? "The carrier rejected every request.");
      onDone();
    } catch (error) {
      toast.error("Couldn't create labels", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const codes = new Map(rows.map((r) => [r.id, r.code]));
  const outcomeRows = result ? labelOutcomeRows(result, codes) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col" data-testid="create-label-dialog">
        <DialogHeader title={title ?? "Create label for order(s)"} description="Buys a carrier label per order with the order's carrier service, or the best rate when it names none. Labels join today's End Of The Day manifest." />
        <DialogBody className="flex flex-col gap-3">
          {result ? (
            <table className="w-full text-xs" aria-label="Label results">
              <thead className="text-left text-2xs text-faint"><tr><th className="py-1">Order</th><th>Result</th><th>Tracking / carrier response</th><th className="w-24"><span className="sr-only">Label</span></th></tr></thead>
              <tbody>
                {outcomeRows.map((o) => (
                  <tr key={o.id} className="border-t border-border align-top">
                    <td className="py-1.5 font-semibold"><Link className="text-primary hover:underline" href={`/orders/${encodeURIComponent(o.code)}`}>{o.code}</Link></td>
                    <td className={o.ok ? "py-1.5 text-success" : "py-1.5 text-danger"}>{o.ok ? "Created" : "Error"}</td>
                    <td className="break-words py-1.5 font-mono text-2xs">{o.text}</td>
                    <td className="py-1.5 text-right">{o.fileId ? <a className="inline-flex items-center gap-1 text-primary hover:underline" href={fileUrl(o.fileId)} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3" aria-hidden />Open label</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <label className="relative block">
                <span className="sr-only">Search orders</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order code, customer or store order number" className="pl-8" autoFocus />
              </label>
              {list.isError ? <p className="text-xs text-danger">Couldn&apos;t load orders. {list.error.message}</p> : !list.data ? (
                <div className="flex flex-col gap-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
              ) : rows.length === 0 ? (
                <p className="py-6 text-center text-xs text-secondary">{query ? "No order matches this search." : planId ? "This plan has no orders." : "No order is waiting for a label."}</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-2xs text-faint">
                    <tr>
                      <th className="w-8 py-1"><Checkbox aria-label="Select all orders that can get a label" checked={eligible.length > 0 && eligible.every((r) => picked.has(r.id)) ? true : eligible.some((r) => picked.has(r.id)) ? "indeterminate" : false} onCheckedChange={(c) => setPicked(c === true ? new Set(eligible.map((r) => r.id)) : new Set())} disabled={eligible.length === 0} /></th>
                      <th>Order</th><th>Status</th><th>Customer</th><th>Carrier service</th><th className="text-right">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-border align-top" title={r.blockedReason ?? undefined}>
                        <td className="py-1.5"><Checkbox aria-label={`Select ${r.code}`} checked={picked.has(r.id) && !r.blockedReason} disabled={Boolean(r.blockedReason)} onCheckedChange={(c) => toggle(r.id, c === true)} /></td>
                        <td className="py-1.5 font-semibold">{r.code}<div className="font-normal text-faint">{r.warehouseCode}{r.clientName ? ` · ${r.clientName}` : ""}</div></td>
                        <td className="py-1.5"><StatusPill status={r.status} domain="shipmentOrder" size="sm" />{r.blockedReason ? <div className="mt-0.5 max-w-[180px] text-2xs text-warning">{r.blockedReason}</div> : null}</td>
                        <td className="max-w-[160px] truncate py-1.5" title={r.customerName}>{r.customerName}</td>
                        <td className="py-1.5">{r.carrierService ?? <span className="text-secondary" title="The order names no carrier service, so the label uses the best rate">Rate shop</span>}</td>
                        <td className="py-1.5 text-right tabular-nums">{(r.weightOz / 16).toFixed(2)} lb</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={chosen.length === 0 || busy} onClick={() => void submit()}><ScanBarcode className="h-3.5 w-3.5" aria-hidden />{busy ? "Creating…" : chosen.length > 1 ? `Create ${chosen.length} labels` : "Create label"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
