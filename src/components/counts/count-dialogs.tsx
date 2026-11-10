"use client";

/**
 * Count command dialogs (M07):
 *   - UpdateInventoryDialog: variance summary table (`POST /api/counts/variance`), units
 *     up / down, blocked records, adjustment reason (required when the warehouse demands
 *     one) and note, then posts ledger `Count` transactions.
 *   - RecountDialog: confirms Create Recount for counted lines with an optional assignee.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, ClipboardCheck, Equal, RotateCcw } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/form";
import { SkeletonText } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DisabledReason } from "@/components/ui/tooltip";
import { LookupSelect, UserPicker } from "@/components/shared/entity-pickers";
import { DeltaBadge } from "./count-badges";
import { errorMessage, runBulkCommand } from "./counts-client";

export interface VarianceRow {
  readonly planCode: string;
  readonly locationCode: string;
  readonly sku: string;
  readonly lotNumber: string | null;
  readonly systemQty: number;
  readonly countedQty: number;
  readonly delta: number;
}

export interface VarianceSummary {
  readonly eligible: number;
  readonly blocked: readonly { readonly id: string; readonly code: string; readonly reason: string }[];
  readonly rows: readonly VarianceRow[];
  readonly unitsUp: number;
  readonly unitsDown: number;
  readonly noDifferenceLines: number;
  readonly reasonRequired: boolean;
}

export interface UpdateInventoryDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** `plan` posts whole plans, `line` posts selected Location / SKU Details lines. */
  readonly level: "plan" | "line";
  readonly ids: readonly string[];
  readonly onDone: () => void;
}

export function UpdateInventoryDialog(props: UpdateInventoryDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="lg">{props.open ? <UpdateBody {...props} /> : null}</DialogContent>
    </Dialog>
  );
}

function Stat({ icon: Icon, label, value, tone }: { readonly icon: React.ComponentType<{ className?: string }>; readonly label: string; readonly value: number; readonly tone: "up" | "down" | "flat" }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2">
      <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", tone === "up" ? "bg-success-soft text-success" : tone === "down" ? "bg-danger-soft text-danger" : "bg-surface-sunken text-secondary")}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[16px] font-semibold tabular-nums text-foreground">{value.toLocaleString()}</span>
        <span className="text-[11px] text-secondary">{label}</span>
      </span>
    </div>
  );
}

function UpdateBody({ onOpenChange, level, ids, onDone }: Omit<UpdateInventoryDialogProps, "open">) {
  const key = [...ids].sort().join(",");
  const summary = useQuery<VarianceSummary>({
    queryKey: ["count-variance", level, key],
    queryFn: () => apiFetch<VarianceSummary>("/api/counts/variance", { method: "POST", body: { level, ids } }),
    staleTime: 0,
  });
  const [reasonId, setReasonId] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [tried, setTried] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const data = summary.data;
  const reasonError = tried && data?.reasonRequired && !reasonId ? "This warehouse requires a reason for cycle count updates" : undefined;
  const nothing = data && data.eligible === 0 ? "None of the selected records has counted lines waiting for an update" : null;
  const reason = summary.isPending ? "Loading the variance summary…" : summary.error ? "The variance summary could not be loaded" : saving ? "Updating…" : nothing;

  const submit = async () => {
    setTried(true);
    if (data?.reasonRequired && !reasonId) return;
    setSaving(true);
    const path = level === "plan" ? "/api/counts/update-inventory" : "/api/counts/lines/update-inventory";
    const res = await runBulkCommand(path, { ids, reasonId, note: note.trim() || null }, level === "plan" ? (ids.length === 1 ? "count plan" : "count plans") : (ids.length === 1 ? "count line" : "count lines"), "updated in inventory");
    setSaving(false);
    if (res) {
      onDone();
      if (res.succeeded.length > 0) onOpenChange(false);
    }
  };

  return (
    <>
      <DialogHeader title="Update inventory from counts" description="Counted quantities replace the system quantities below. Each difference posts a Count transaction tagged with the count plan code." />
      <DialogBody>
        {summary.isPending ? <SkeletonText lines={5} /> : summary.error ? (
          <Callout variant="error" title="Variance summary unavailable" action={<Button size="sm" variant="secondary" onClick={() => void summary.refetch()}>Retry</Button>}>{errorMessage(summary.error)}</Callout>
        ) : data ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Stat icon={ArrowUpRight} label="Units added" value={data.unitsUp} tone="up" />
              <Stat icon={ArrowDownRight} label="Units removed" value={data.unitsDown} tone="down" />
              <Stat icon={Equal} label="Lines with no difference" value={data.noDifferenceLines} tone="flat" />
            </div>
            {data.blocked.length > 0 ? (
              <Callout variant="attention" title={`${data.blocked.length} ${data.blocked.length === 1 ? "record is" : "records are"} skipped`}>
                <ul className="mt-1 list-disc pl-4 text-[12px]">
                  {data.blocked.slice(0, 5).map((b) => <li key={b.id}><strong>{b.code}</strong>: {b.reason}</li>)}
                  {data.blocked.length > 5 ? <li>+{data.blocked.length - 5} more</li> : null}
                </ul>
              </Callout>
            ) : null}
            <div className="ks-scroll max-h-[240px] overflow-auto rounded-md border border-border">
              <table className="w-full border-collapse text-left text-[12px]">
                <thead className="sticky top-0 bg-surface-sunken text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
                  <tr>
                    <th scope="col" className="px-2.5 py-1.5">Count code</th>
                    <th scope="col" className="px-2.5 py-1.5">Location</th>
                    <th scope="col" className="px-2.5 py-1.5">SKU</th>
                    <th scope="col" className="px-2.5 py-1.5">Lot</th>
                    <th scope="col" className="px-2.5 py-1.5 text-right">System</th>
                    <th scope="col" className="px-2.5 py-1.5 text-right">Counted</th>
                    <th scope="col" className="px-2.5 py-1.5 text-right">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-secondary">No differences. The lines are marked Inventory Updated without stock changes.</td></tr>
                  ) : data.rows.map((r, i) => (
                    <tr key={`${r.planCode}-${r.locationCode}-${r.sku}-${r.lotNumber ?? ""}-${i}`} className="border-t border-border">
                      <td className="px-2.5 py-1.5 font-semibold text-foreground">{r.planCode}</td>
                      <td className="px-2.5 py-1.5">{r.locationCode}</td>
                      <td className="px-2.5 py-1.5">{r.sku}</td>
                      <td className="px-2.5 py-1.5 text-secondary">{r.lotNumber ?? "—"}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{r.systemQty.toLocaleString()}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{r.countedQty.toLocaleString()}</td>
                      <td className="px-2.5 py-1.5 text-right"><DeltaBadge value={r.delta} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form noValidate className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!reason) void submit(); }}>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="ui-reason" required={data.reasonRequired}>Adjustment reason</FieldLabel>
                <LookupSelect id="ui-reason" type="adjustment_reason" aria-label="Adjustment reason" value={reasonId} onChange={(v) => setReasonId(v)} invalid={Boolean(reasonError)} placeholder={data.reasonRequired ? "Select a reason" : "Optional"} clearable />
                <FieldError id="ui-reason-err" message={reasonError} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="ui-note">Note</FieldLabel>
                <Textarea id="ui-note" rows={2} maxLength={400} showCount value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shown on the Count transactions" />
              </div>
              <button type="submit" hidden aria-hidden tabIndex={-1} />
            </form>
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>No</Button>
        <DisabledReason reason={reason}>
          <Button variant="primary" disabled={Boolean(reason)} onClick={() => void submit()}>
            {saving ? <Spinner className="h-3.5 w-3.5" /> : <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />}
            Update inventory
          </Button>
        </DisabledReason>
      </DialogFooter>
    </>
  );
}

/* ---------------------------------------------------------------- recount */
export interface RecountTarget {
  readonly id: string;
  readonly label: string;
  readonly planCode: string;
  readonly countedQty: number | null;
  readonly systemQty: number | null;
  readonly warehouseId: string;
}

export function RecountDialog({ open, onOpenChange, lines, onDone }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly lines: readonly RecountTarget[]; readonly onDone: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">{open ? <RecountBody lines={lines} onOpenChange={onOpenChange} onDone={onDone} /> : null}</DialogContent>
    </Dialog>
  );
}

function RecountBody({ lines, onOpenChange, onDone }: { readonly lines: readonly RecountTarget[]; readonly onOpenChange: (open: boolean) => void; readonly onDone: () => void }) {
  const [assignee, setAssignee] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const warehouses = [...new Set(lines.map((l) => l.warehouseId))];
  const submit = async () => {
    setSaving(true);
    const res = await runBulkCommand("/api/counts/lines/recount", { ids: lines.map((l) => l.id), assigneeUserId: assignee }, lines.length === 1 ? "count line" : "count lines", "sent for recount");
    setSaving(false);
    if (res) {
      onDone();
      if (res.succeeded.length > 0) onOpenChange(false);
    }
  };
  return (
    <>
      <DialogHeader title={`Create recount for ${lines.length} ${lines.length === 1 ? "line" : "lines"}?`} description="Each line gets a new Ready To Count line (Recount Line = Yes) in a new job. The original line becomes Recount Created and no longer updates inventory." />
      <DialogBody>
        <div className="flex flex-col gap-3">
          <div className="ks-scroll max-h-[200px] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead className="sticky top-0 bg-surface-sunken text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
                <tr><th scope="col" className="px-2.5 py-1.5">Line</th><th scope="col" className="px-2.5 py-1.5">Count code</th><th scope="col" className="px-2.5 py-1.5 text-right">System</th><th scope="col" className="px-2.5 py-1.5 text-right">Counted</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-2.5 py-1.5 font-semibold text-foreground">{l.label}</td>
                    <td className="px-2.5 py-1.5">{l.planCode}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{l.systemQty ?? "—"}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{l.countedQty ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="rc-user">Assign the recount to</FieldLabel>
            <UserPicker id="rc-user" warehouseId={warehouses.length === 1 ? warehouses[0] ?? null : null} value={assignee} onChange={(v) => setAssignee(v)} placeholder="Leave in the job pool" clearable />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>No</Button>
        <Button variant="primary" disabled={saving} onClick={() => void submit()}>{saving ? <Spinner className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}Create recount</Button>
      </DialogFooter>
    </>
  );
}
