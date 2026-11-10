"use client";

/**
 * "Import from Loop Returns" (returns-platform channel, Logiwa's Loop integration): enter a return
 * as the platform sends it (its return id, the order, SKU lines) and it becomes a Pending RMA with
 * Source "Loop Returns" through `POST /api/returns/import` — the same endpoint an integration
 * calls. Re-importing the same return id opens the existing RMA instead of creating a duplicate.
 */
import * as React from "react";
import Link from "next/link";
import { apiRequest, isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

export interface ImportLine { readonly sku: string; readonly quantity: number; readonly reason: string | null }

/** Pure: "SKU, qty[, reason]" per row (comma, tab or semicolon). Returns lines or the first row error. */
export function parseImportLines(text: string): { readonly lines: ImportLine[]; readonly error: string | null } {
  const lines: ImportLine[] = [];
  const rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (rows.length === 0) return { lines, error: "Add at least one line: SKU, quantity" };
  for (const [i, row] of rows.entries()) {
    const [sku, qty, ...rest] = row.split(/[,\t;]/).map((c) => c.trim());
    const n = Number(qty ?? "1");
    if (!sku) return { lines, error: `Row ${i + 1}: enter a SKU` };
    if (!Number.isInteger(n) || n < 1) return { lines, error: `Row ${i + 1}: quantity must be a whole number of at least 1` };
    lines.push({ sku, quantity: n, reason: rest.join(", ").trim() || null });
  }
  return { lines, error: null };
}

interface ImportResult { readonly results: readonly { readonly externalId: string; readonly ok: boolean; readonly duplicate?: boolean; readonly id?: string; readonly rmaCode?: string; readonly orderCode?: string; readonly message?: string }[] }

/** Mount with `key` tied to `open` so each opening starts empty. */
export function ImportReturnsDialog({ open, onOpenChange, onDone }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly onDone: () => void }) {
  const [externalId, setExternalId] = React.useState("");
  const [order, setOrder] = React.useState("");
  const [linesText, setLinesText] = React.useState("");
  const [tracking, setTracking] = React.useState("");
  const [carrier, setCarrier] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [outcome, setOutcome] = React.useState<ImportResult["results"][number] | null>(null);


  const submit = async () => {
    const parsed = parseImportLines(linesText);
    const e: Record<string, string> = {};
    if (!externalId.trim()) e.externalId = "Enter the Loop return id";
    if (!order.trim()) e.order = "Enter the order code or store order #";
    if (parsed.error) e.lines = parsed.error;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const { data } = await apiRequest<ImportResult>("/api/returns/import", {
        method: "POST",
        body: { platform: "Loop Returns", returns: [{ externalId: externalId.trim(), order: order.trim(), lines: parsed.lines, trackingNumber: tracking.trim() || null, carrierCode: carrier.trim() || null }] },
      });
      const r = data.results[0] ?? null;
      setOutcome(r);
      if (r?.ok) {
        toast.success(r.duplicate ? "Already imported" : "Return imported", r.duplicate ? `${r.rmaCode} already holds Loop return #${r.externalId}.` : `${r.rmaCode} created for ${r.orderCode} (Source: Loop Returns).`);
        onDone();
      }
    } catch (err) {
      setOutcome({ externalId, ok: false, message: isApiError(err) ? err.message : "Import failed" });
    } finally {
      setBusy(false);
    }
  };

  const field = "flex flex-col gap-1";
  const lbl = "text-[12px] font-semibold text-body";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Import return from Loop Returns" description="Returns created in Loop arrive here as Pending RMAs (Source: Loop Returns). Integrations post the same payload to /api/returns/import." />
        <DialogBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={field}>
              <label htmlFor="imp-ext" className={lbl}>Loop return # <span className="text-danger">*</span></label>
              <Input id="imp-ext" value={externalId} onChange={(e) => { setExternalId(e.target.value); setErrors((x) => ({ ...x, externalId: "" })); }} placeholder="e.g. LR-10482" aria-invalid={Boolean(errors.externalId) || undefined} />
              {errors.externalId ? <p className="text-[11px] text-danger">{errors.externalId}</p> : null}
            </div>
            <div className={field}>
              <label htmlFor="imp-order" className={lbl}>Order <span className="text-danger">*</span></label>
              <Input id="imp-order" value={order} onChange={(e) => { setOrder(e.target.value); setErrors((x) => ({ ...x, order: "" })); }} placeholder="Order code or store order #" aria-invalid={Boolean(errors.order) || undefined} />
              {errors.order ? <p className="text-[11px] text-danger">{errors.order}</p> : null}
            </div>
          </div>
          <div className={field}>
            <label htmlFor="imp-lines" className={lbl}>Lines <span className="text-danger">*</span></label>
            <Textarea id="imp-lines" rows={4} value={linesText} onChange={(e) => { setLinesText(e.target.value); setErrors((x) => ({ ...x, lines: "" })); }} placeholder={"One per row: SKU, quantity, reason\nAPX-TEE-WHT-M, 1, Wrong size"} aria-invalid={Boolean(errors.lines) || undefined} />
            {errors.lines ? <p className="text-[11px] text-danger">{errors.lines}</p> : <p className="text-[11px] text-secondary">The reason is matched to your Return Reasons by name; unknown reasons are left empty.</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={field}><label htmlFor="imp-trk" className={lbl}>Return tracking #</label><Input id="imp-trk" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Optional" /></div>
            <div className={field}><label htmlFor="imp-car" className={lbl}>Return carrier</label><Input id="imp-car" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Optional, e.g. UPS" /></div>
          </div>
          {outcome ? (
            outcome.ok ? (
              <Callout variant={outcome.duplicate ? "attention" : "success"} title={outcome.duplicate ? "Already imported" : "Return imported"}>
                {outcome.duplicate ? `Loop return #${outcome.externalId} is ${outcome.rmaCode}. Nothing new was created.` : `${outcome.rmaCode} is Pending for ${outcome.orderCode}.`}{" "}
                {outcome.id ? <Link href={`/orders/returns/${outcome.id}`} className="font-medium text-primary hover:underline">Open {outcome.rmaCode}</Link> : null}
              </Callout>
            ) : <Callout variant="error" title="Not imported">{outcome.message}</Callout>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{outcome?.ok ? "Close" : "Cancel"}</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>{busy ? <Spinner className="h-3.5 w-3.5" label="Importing" /> : null}Import return</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
