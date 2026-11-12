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
import { ArrowDownRight, ArrowUpRight, ClipboardCheck, Copy, Equal, ExternalLink, Lock, RotateCcw, Unlink } from "lucide-react";
import { COUNT_DISCARD_REASON_MESSAGE, unitsLabel } from "@/lib/grid-defs/counts/count-math";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/form";
import { SkeletonText } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DisabledReason } from "@/components/ui/tooltip";
import { LookupSelect } from "@/components/shared/entity-pickers";
import { CountAssigneeSelect } from "./count-assignee-select";
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
  readonly lineId?: string;
  /** Allocated qty of the bucket (0 = free stock). */
  readonly allocated?: number;
  /** Unpicked allocation units this posting shorts first. */
  readonly unallocates?: number;
  /** The line can't post: its shortage is held by committed (picked / in-job) stock. */
  readonly blocked?: boolean;
}

export interface AllocationBlockedLine {
  readonly lineId: string;
  readonly planCode: string;
  readonly label: string;
  readonly units: number;
  readonly holders: string;
  readonly message: string;
}

export interface VarianceSummary {
  readonly eligible: number;
  readonly blocked: readonly { readonly id: string; readonly code: string; readonly reason: string }[];
  readonly rows: readonly VarianceRow[];
  readonly unitsUp: number;
  readonly unitsDown: number;
  readonly noDifferenceLines: number;
  readonly reasonRequired: boolean;
  readonly linesToCancel?: readonly { readonly code: string; readonly lines: number }[];
  readonly countedLines?: number;
  readonly allocationBlocked?: readonly AllocationBlockedLine[];
  readonly unitsUnallocated?: number;
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

/** Plural-aware KPI label: "1 unit removed", "0 units added". */
export const statLabel = (value: number, one: string, many: string): string => (value === 1 ? one : many);

function Stat({ icon: Icon, label, value, tone }: { readonly icon: React.ComponentType<{ className?: string }>; readonly label: string; readonly value: number; readonly tone: "up" | "down" | "flat" }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2">
      <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", tone === "up" ? "bg-success-soft text-success" : tone === "down" ? "bg-danger-soft text-danger" : "bg-surface-sunken text-secondary")}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-md font-semibold tabular-nums text-foreground">{value.toLocaleString()}</span>
        <span className="text-2xs text-secondary">{label}</span>
      </span>
    </div>
  );
}

function LinesToCancel({ items, nothingCounted }: { readonly items: readonly { readonly code: string; readonly lines: number }[]; readonly nothingCounted: boolean }) {
  const [copied, setCopied] = React.useState(false);
  const total = items.reduce((s, i) => s + i.lines, 0);
  const copy = async () => {
    try { await navigator.clipboard.writeText(items.map((i) => i.code).join(", ")); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <Callout variant="attention" title={nothingCounted ? "Nothing has been counted yet" : "Some lines are not counted yet"}>
      {nothingCounted ? (
        <p className="text-xs">No line is in Count Completed status, so <strong>no stock changes</strong>. If you proceed, {total === 1 ? "the line" : `all ${total} lines`} <strong className="text-danger">will be cancelled</strong> and the count plan is closed as Cancelled. Its pending count tasks are cancelled too.</p>
      ) : (
        <p className="text-xs">If you proceed, inventory is updated for <strong className="text-success">Count Completed lines only</strong>, and the {total === 1 ? "line" : `${total} lines`} not in Count Completed status <strong className="text-danger">will be cancelled</strong>.</p>
      )}
      <div className="mt-1.5 flex items-start gap-2">
        <ul className="list-disc pl-4 text-xs">
          {items.slice(0, 5).map((i) => <li key={i.code}><strong>{i.code}</strong>: {i.lines} {i.lines === 1 ? "line" : "lines"}</li>)}
          {items.length > 5 ? <li>+{items.length - 5} more</li> : null}
        </ul>
        <Button size="sm" variant="ghost" onClick={() => void copy()} aria-label="Copy count plan codes"><Copy className="h-3.5 w-3.5" aria-hidden />{copied ? "Copied" : "Copy codes"}</Button>
      </div>
      <DetailLinks codes={items.map((i) => i.code)} />
    </Callout>
  );
}

/**
 * Location / SKU Details deep links pre-filtered to the affected plans (`f.planCode=in:…`, the grid
 * grammar), opened in a new tab so the confirm stays open (Logiwa Update Inv. info box parity).
 */
export function countDetailsHref(path: "/counts/locations" | "/counts/skus", codes: readonly string[]): string {
  const value = codes.slice(0, 100).map((c) => c.replace(/,/g, "\\,")).join(",");
  return `${path}?${new URLSearchParams({ "f.planCode": `in:${value}` }).toString()}`;
}

function DetailLinks({ codes }: { readonly codes: readonly string[] }) {
  if (codes.length === 0) return null;
  const cls = "inline-flex items-center gap-1 font-semibold text-primary hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
  return (
    <span className="mt-1 block w-full text-2xs text-secondary">
      Review the lines of {codes.length === 1 ? "this plan" : `these ${codes.length} plans`} in{" "}
      <a className={cls} href={countDetailsHref("/counts/locations", codes)} target="_blank" rel="noreferrer">Location Details<ExternalLink className="h-3 w-3" aria-hidden /></a>{" or "}
      <a className={cls} href={countDetailsHref("/counts/skus", codes)} target="_blank" rel="noreferrer">SKU Details<ExternalLink className="h-3 w-3" aria-hidden /></a>
      {" "}(opens filtered, in a new tab).
    </span>
  );
}

/** Affected plan codes with copy-to-clipboard and the Location / SKU Details hint (Logiwa Update Inv. confirm parity). */
function AffectedPlans({ codes }: { readonly codes: readonly string[] }) {
  const [copied, setCopied] = React.useState(false);
  if (codes.length === 0) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(codes.join(", ")); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 truncate text-secondary" title={codes.join(", ")}><strong className="text-foreground">{codes.length} {codes.length === 1 ? "count plan" : "count plans"}</strong>: {codes.slice(0, 4).join(", ")}{codes.length > 4 ? ` +${codes.length - 4} more` : ""}</span>
      <Button size="sm" variant="ghost" onClick={() => void copy()} aria-label="Copy affected count plan codes"><Copy className="h-3.5 w-3.5" aria-hidden />{copied ? "Copied" : "Copy codes"}</Button>
      <DetailLinks codes={codes} />
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
  const [closeBlocked, setCloseBlocked] = React.useState(false);
  const data = summary.data;
  const held = data?.allocationBlocked ?? [];
  const allHeld = held.length > 0 && held.length === (data?.countedLines ?? 0);
  // No counted line posts: nothing differs and no line is "no difference" either (older servers omit countedLines).
  const countedLines = data ? (data.countedLines ?? (data.rows.length === 0 && data.noDifferenceLines === 0 ? 0 : 1)) : 1;
  const cancelOnly = level === "plan" && countedLines === 0 && (data?.linesToCancel?.length ?? 0) > 0;
  const reasonError = tried && data?.reasonRequired && !reasonId ? "Choose an adjustment reason: counted quantities differ from the system" : undefined;
  const nothing = data && data.eligible === 0 ? "None of the selected records has counted lines waiting for an update" : null;
  const reason = summary.isPending ? "Loading the variance summary…" : summary.error ? "The variance summary could not be loaded" : saving ? "Updating…" : nothing;
  const blockedTip = held.length > 0 && !closeBlocked ? `${unitsLabel(held.length, ["counted line", "counted lines"])} can't post. Tick "Close without posting" in the attention box first.` : null;

  const submit = async () => {
    setTried(true);
    if (data?.reasonRequired && !reasonId) return;
    if (held.length > 0 && !closeBlocked) return;
    setSaving(true);
    const path = level === "plan" ? "/api/counts/update-inventory" : "/api/counts/lines/update-inventory";
    const res = await runBulkCommand(path, { ids, reasonId, note: note.trim() || null, ...(held.length > 0 ? { closeBlocked: true } : {}) }, level === "plan" ? (ids.length === 1 ? "count plan" : "count plans") : (ids.length === 1 ? "count line" : "count lines"), "updated in inventory");
    setSaving(false);
    if (res) {
      onDone();
      if (res.succeeded.length > 0) onOpenChange(false);
    }
  };

  return (
    <>
      <DialogHeader title="Update inventory from counts" description={cancelOnly ? "Nothing is counted on this plan yet, so Update Inv. only closes it." : "Counted quantities replace the system quantities below. Each difference posts a Count transaction tagged with the count plan code."} />
      <DialogBody>
        {summary.isPending ? <SkeletonText lines={5} /> : summary.error ? (
          <Callout variant="error" title="Variance summary unavailable" action={<Button size="sm" variant="secondary" onClick={() => void summary.refetch()}>Retry</Button>}>{errorMessage(summary.error)}</Callout>
        ) : data ? (
          <div className="flex flex-col gap-3">
            {cancelOnly ? null : <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Stat icon={ArrowUpRight} label={statLabel(data.unitsUp, "unit added", "units added")} value={data.unitsUp} tone="up" />
              <Stat icon={ArrowDownRight} label={statLabel(data.unitsDown, "unit removed", "units removed")} value={data.unitsDown} tone="down" />
              <Stat icon={Equal} label={statLabel(data.noDifferenceLines, "line with no difference", "lines with no difference")} value={data.noDifferenceLines} tone="flat" />
            </div>}
            {cancelOnly ? null : <AffectedPlans codes={[...new Set(data.rows.map((r) => r.planCode))]} />}
            {data.linesToCancel && data.linesToCancel.length > 0 ? <LinesToCancel items={data.linesToCancel} nothingCounted={cancelOnly} /> : null}
            {held.length > 0 ? (
              <Callout variant="attention" title={`${unitsLabel(held.length, ["counted line", "counted lines"])} can't post: the stock is committed to orders`}>
                <p className="text-xs">The ledger never takes stock below what is picked, in a pick job or reserved for a work order. {allHeld ? "Nothing else posts, so the plan closes as Cancelled." : "The other counted lines post as usual."} {held.length === 1 ? "This line closes" : "These lines close"} <strong>without posting</strong> (cancelled, with your reason on the timeline) and {held.length === 1 ? "its location unlocks" : "their locations unlock"}. To post instead, short the order first and recount.</p>
                <ul className="mt-1.5 flex flex-col gap-1 text-xs" data-testid="allocation-blocked">
                  {held.slice(0, 6).map((b) => (
                    <li key={b.lineId} className="flex flex-wrap items-baseline gap-x-1.5"><Lock className="h-3 w-3 shrink-0 self-center text-warning" aria-hidden /><strong className="text-foreground">{b.planCode} · {b.label}</strong><span>{unitsLabel(b.units)} held by {b.holders}</span></li>
                  ))}
                  {held.length > 6 ? <li>+{held.length - 6} more</li> : null}
                </ul>
                <div className="mt-2">
                  <Checkbox checked={closeBlocked} onCheckedChange={(c) => setCloseBlocked(c === true)}
                    label={<span className="text-xs font-semibold text-foreground">Close {held.length === 1 ? "this line" : `these ${held.length} lines`} without posting</span>} />
                </div>
              </Callout>
            ) : null}
            {(data.unitsUnallocated ?? 0) > 0 ? (
              <Callout variant="info" title={`${unitsLabel(data.unitsUnallocated ?? 0, ["allocated unit", "allocated units"])} will be shorted on ${(data.unitsUnallocated ?? 0) === 1 ? "its order" : "their orders"}`}>
                <p className="text-xs">The count found less than is allocated. Unpicked allocations are released first, re-allocated from other locations where stock allows, and an allocation exception is logged on each order.</p>
              </Callout>
            ) : null}
            {data.blocked.length > 0 ? (
              <Callout variant="attention" title={`${data.blocked.length} ${data.blocked.length === 1 ? "record is" : "records are"} skipped`}>
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {data.blocked.slice(0, 5).map((b) => <li key={b.id}><strong>{b.code}</strong>: {b.reason}</li>)}
                  {data.blocked.length > 5 ? <li>+{data.blocked.length - 5} more</li> : null}
                </ul>
              </Callout>
            ) : null}
            {cancelOnly ? null : <div className="ks-scroll max-h-[240px] overflow-auto rounded-md border border-border">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-surface-sunken text-2xs font-semibold text-faint">
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
                    <tr key={`${r.planCode}-${r.locationCode}-${r.sku}-${r.lotNumber ?? ""}-${i}`} className={cn("border-t border-border", r.blocked && "bg-warning-soft/40 text-secondary")} data-blocked={r.blocked ? "true" : undefined}>
                      <td className="px-2.5 py-1.5 font-semibold text-foreground">{r.planCode}</td>
                      <td className="px-2.5 py-1.5">{r.locationCode}</td>
                      <td className="px-2.5 py-1.5">
                        <span className="flex flex-wrap items-center gap-1">{r.sku}
                          {r.blocked ? <Badge tone="warning" size="sm" icon={Lock} title="Committed to orders: this line closes without posting">Can&apos;t post</Badge>
                            : (r.unallocates ?? 0) > 0 ? <Badge tone="info" size="sm" icon={Unlink} title={`Shorts ${unitsLabel(r.unallocates ?? 0)} of unpicked allocations`}>Shorts {r.unallocates} alloc.</Badge>
                            : (r.allocated ?? 0) > 0 ? <Badge tone="neutral" size="sm" title={`${unitsLabel(r.allocated ?? 0)} allocated in this bucket`}>{r.allocated} alloc.</Badge> : null}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 text-secondary">{r.lotNumber ?? "—"}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{r.systemQty.toLocaleString()}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{r.countedQty.toLocaleString()}</td>
                      <td className="px-2.5 py-1.5 text-right"><DeltaBadge value={r.delta} system={r.systemQty} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
            {cancelOnly ? null : <form noValidate className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!reason) void submit(); }}>
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
            </form>}
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <DisabledReason reason={reason ?? blockedTip}>
          <Button variant="primary" disabled={Boolean(reason) || Boolean(blockedTip)} onClick={() => void submit()}>
            {saving ? <Spinner className="h-3.5 w-3.5" /> : <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />}
            {cancelOnly ? "Cancel lines and close plan" : allHeld && closeBlocked ? "Close without posting" : "Proceed"}
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
      <DialogHeader title={`Create recount for ${lines.length} ${lines.length === 1 ? "line" : "lines"}?`} description="Each line gets a new Ready to Count line (Recount Line = Yes) in a new job. The original line becomes Recount Created and no longer updates inventory." />
      <DialogBody>
        <div className="flex flex-col gap-3">
          <div className="ks-scroll max-h-[200px] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-surface-sunken text-2xs font-semibold text-faint">
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
            <CountAssigneeSelect id="rc-user" warehouseId={warehouses.length === 1 ? warehouses[0] ?? null : null} value={assignee} onChange={setAssignee} />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button variant="primary" disabled={saving} onClick={() => void submit()}>{saving ? <Spinner className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}Create recount</Button>
      </DialogFooter>
    </>
  );
}

/* --------------------------------------------------------- cancel reason */
/**
 * Reason field for the Cancel confirms. Cancelling counted (Count Completed) lines discards results
 * that were never posted, so the reason is then required (server rule COUNT_DISCARD_REASON_MESSAGE)
 * and lands on the plan timeline; for open lines it is optional.
 */
export function CancelReasonField({ discards, value, onChange }: { readonly discards: number; readonly value: string; readonly onChange: (value: string) => void }) {
  const id = React.useId();
  return (
    <div className="mt-3 flex flex-col gap-2">
      {discards > 0 ? (
        <Callout variant="attention" title={`${unitsLabel(discards, ["counted line", "counted lines"])} will be discarded`}>
          <p className="text-xs">{discards === 1 ? "Its counted quantity was" : "Their counted quantities were"} never posted to inventory, so stock stays as it is. The reason is kept on the plan timeline.</p>
        </Callout>
      ) : null}
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={id} required={discards > 0}>Reason</FieldLabel>
        <Textarea id={id} rows={2} maxLength={400} showCount value={value} onChange={(e) => onChange(e.target.value)} placeholder={discards > 0 ? "Why are the counted results discarded?" : "Optional. Shown on the plan timeline"} />
      </div>
    </div>
  );
}

/** Throws (shown inline by ConfirmDialog) when discarded counts have no reason. */
export function assertCancelReason(discards: number, value: string): void {
  if (discards > 0 && !value.trim()) throw new Error(COUNT_DISCARD_REASON_MESSAGE);
}
