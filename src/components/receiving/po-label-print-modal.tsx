"use client";

/**
 * Print Options for PO product labels (Logiwa parity: one modal with a "Use as Line Quantity"
 * toggle). Off (default): one label per PO line, times Print Quantity. On: each line prints as
 * many labels as its ordered or received quantity (basis picker), Print Quantity copies each.
 * The subtitle counts purchase orders and labels, never raw records. Renders through
 * `POST /api/print` (type `product-label`) with Preview / Download / Print.
 */
import * as React from "react";
import { Download, Eye, FileText, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { fileUrl, printResultSchema } from "@/components/shared/contracts";
import { apiFetch } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { errorMessage } from "./receiving-shared";

export interface LabelLine {
  readonly poCode: string;
  readonly record: Readonly<Record<string, unknown>>;
  readonly ordered: number;
  readonly received: number;
}

export type LabelBasis = "ordered" | "received";
export const MAX_LABELS = 5000;
const MAX_COPIES = 100;

/** Records to print and the label count for the chosen options (pure; unit tested). */
export function expandLabels(lines: readonly LabelLine[], opts: { readonly useLineQty: boolean; readonly basis: LabelBasis; readonly copies: number }): { records: Readonly<Record<string, unknown>>[]; labels: number } {
  const records: Readonly<Record<string, unknown>>[] = [];
  for (const l of lines) {
    const n = opts.useLineQty ? Math.max(0, opts.basis === "received" ? l.received : l.ordered) : 1;
    for (let i = 0; i < n && records.length < MAX_LABELS; i++) records.push(l.record);
  }
  return { records, labels: records.length * Math.max(1, opts.copies) };
}

export function PoLabelPrintModal({ ids, open, onOpenChange }: { readonly ids: readonly string[]; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const q = useApiQuery<LabelLine[]>(["po-label-lines", ids.join(",")], open && ids.length ? "/api/purchase-orders/labels" : null, { query: { ids: ids.join(","), lines: "1" }, retry: false });
  const lines = React.useMemo(() => q.data?.data ?? [], [q.data]);
  const [useLineQty, setUseLineQty] = React.useState(false);
  const [basis, setBasis] = React.useState<LabelBasis>("ordered");
  const [copies, setCopies] = React.useState<number | null>(1);
  const [busy, setBusy] = React.useState<"preview" | "download" | "print" | null>(null);
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const { records, labels } = expandLabels(lines, { useLineQty, basis, copies: copies ?? 1 });
  const pos = ids.length;
  const subtitle = q.isPending ? `${pos} purchase order${pos === 1 ? "" : "s"}` : `${pos} purchase order${pos === 1 ? "" : "s"} · ${labels.toLocaleString()} label${labels === 1 ? "" : "s"}`;
  const reason = q.isPending ? "Loading the purchase order lines…"
    : q.isError ? "Couldn't load the purchase order lines"
      : lines.length === 0 ? "The selected purchase orders have no lines"
        : records.length === 0 ? (basis === "received" ? "Nothing received yet: switch the basis to Ordered" : "Nothing to print")
          : copies === null || copies < 1 ? "Enter a print quantity"
            : busy ? "Preparing the file…" : null;

  const run = async (action: "preview" | "download" | "print") => {
    setBusy(action);
    try {
      const result = await apiFetch<unknown>("/api/print", { method: "POST", body: { typeKey: "product-label", records, options: { copies: copies ?? 1 } } });
      const id = printResultSchema.parse(result).fileId;
      if (action === "preview") setPreviewId(id);
      else if (action === "download") {
        const a = document.createElement("a");
        a.href = fileUrl(id, true);
        a.download = "";
        a.click();
      } else {
        const w = window.open(fileUrl(id), "_blank");
        if (!w) toast.warning("Pop-up blocked", "Allow pop-ups for KitStaks to print, or use Download.");
        else w.addEventListener("load", () => w.print(), { once: true });
      }
    } catch (error) {
      toast.error("Print failed", errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setPreviewId(null); onOpenChange(o); }}>
      <DialogContent size={previewId ? "xl" : "lg"}>
        <DialogHeader title="Print options · Product label" description={subtitle} />
        <DialogBody className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-lg border border-primary bg-primary-soft p-3" role="group" aria-label="Printout template">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-white"><FileText className="h-4 w-4" aria-hidden /></span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">Product label <Badge tone="info" size="sm">Default</Badge></span>
              <span className="text-xs text-faint">SKU, barcode, name, pack type and lot</span>
            </span>
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <Switch checked={useLineQty} onCheckedChange={(v) => { setUseLineQty(Boolean(v)); setPreviewId(null); }} label="Use as line quantity" description="Print one label per unit on each line. Off: one label per line." />
            {useLineQty ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                <span>Quantity basis</span>
                <SegmentedControl size="sm" ariaLabel="Label quantity basis" value={basis} onChange={(v) => { setBasis(v); setPreviewId(null); }} options={[{ value: "ordered" as const, label: "Ordered" }, { value: "received" as const, label: "Received" }]} />
              </div>
            ) : null}
            <label className="flex w-48 flex-col gap-1 text-xs font-semibold text-secondary">
              Print quantity
              <NumberInput min={1} max={MAX_COPIES} value={copies} onChange={(v) => { setCopies(v); setPreviewId(null); }} aria-label="Print quantity" />
            </label>
          </div>
          {q.isPending ? <div className="flex flex-col gap-1.5" aria-busy="true"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></div> : null}
          {!q.isPending && lines.length > 0 ? (
            <div className="relative max-h-48 max-w-full overflow-auto rounded-md border border-border ks-scroll">
              <table className="w-full border-collapse whitespace-nowrap text-xs">
                <thead><tr className="text-left text-2xs font-semibold text-faint">{["PO number", "SKU", "Ordered", "Received", "Labels"].map((h) => <th key={h} className="border-b border-border px-2.5 py-1.5">{h}</th>)}</tr></thead>
                <tbody>
                  {lines.map((l, i) => {
                    const n = (useLineQty ? (basis === "received" ? l.received : l.ordered) : 1) * Math.max(1, copies ?? 1);
                    return (
                      <tr key={`${l.poCode}-${i}`}>
                        <td className="border-b border-border px-2.5 py-1.5 font-mono">{l.poCode}</td>
                        <td className="border-b border-border px-2.5 py-1.5 font-semibold">{String(l.record.sku ?? "")}</td>
                        <td className="border-b border-border px-2.5 py-1.5 tabular-nums">{l.ordered.toLocaleString()}</td>
                        <td className="border-b border-border px-2.5 py-1.5 tabular-nums">{l.received.toLocaleString()}</td>
                        <td className="border-b border-border px-2.5 py-1.5 font-semibold tabular-nums">{n.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {records.length >= MAX_LABELS ? <p className="text-xs text-warning">Capped at {MAX_LABELS.toLocaleString()} labels per print.</p> : null}
          {previewId ? <iframe title="Label preview" src={fileUrl(previewId)} className="h-[60vh] w-full rounded-md border border-border bg-surface-sunken" /> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          {(["preview", "download", "print"] as const).map((action) => {
            const Icon = action === "preview" ? Eye : action === "download" ? Download : Printer;
            return (
              <DisabledReason key={action} reason={reason}>
                <Button variant={action === "print" ? "primary" : "secondary"} disabled={Boolean(reason)} onClick={() => void run(action)}>
                  {busy === action ? <Spinner className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" aria-hidden />}
                  {action === "preview" ? "Preview" : action === "download" ? "Download" : "Print"}
                </Button>
              </DisabledReason>
            );
          })}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
