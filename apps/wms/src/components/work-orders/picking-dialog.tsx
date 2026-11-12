"use client";

/**
 * Warehouse Ops → Picking/Job Operations for work orders (create-job-modal flow, see
 * docs/requests/work-orders-kitting.md REQ-3). Step 1 is a dry run, so the preview shows
 * exactly what allocation will do for each work order: allocated, or short (with the short
 * SKUs). Step 2 picks the Work Order job type, assignee and priority, then creates the jobs.
 * Short work orders become Shortage with a "Manual Allocation - Work Order" exception.
 */
import * as React from "react";
import { AlertTriangle, CheckCircle2, ListPlus, XCircle } from "lucide-react";
import { UserPicker } from "@/components/shared/entity-pickers";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import { PRIORITIES, type Priority } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { errorMessage, useInvalidateWorkOrders } from "./wo-client";
import { Field } from "./wo-ui";

interface Outcome {
  readonly id: string;
  readonly code: string;
  readonly outcome: "allocated" | "shortage" | "failed";
  readonly message: string;
  readonly shortages: readonly { readonly sku: string; readonly need: number; readonly free: number }[];
}

interface PickingResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
  readonly outcomes: readonly Outcome[];
  readonly jobTypes: readonly { readonly id: string; readonly code: string; readonly name: string; readonly warehouseId: string }[];
  readonly dryRun: boolean;
}

export interface PickingDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly ids: readonly string[];
  readonly onDone?: () => void;
}

export function PickingDialog({ open, onOpenChange, ids, onDone }: PickingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {open ? <Body key={ids.join(",")} ids={ids} onClose={() => onOpenChange(false)} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function OutcomeIcon({ outcome }: { readonly outcome: Outcome["outcome"] }) {
  if (outcome === "allocated") return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Allocates" />;
  if (outcome === "shortage") return <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-label="Short" />;
  return <XCircle className="h-4 w-4 shrink-0 text-danger" aria-label="Not eligible" />;
}

function Body({ ids, onClose, onDone }: { readonly ids: readonly string[]; readonly onClose: () => void; readonly onDone?: () => void }) {
  const invalidate = useInvalidateWorkOrders();
  const [preview, setPreview] = React.useState<PickingResult | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<"preview" | "options">("preview");
  const [jobTypeId, setJobTypeId] = React.useState<string | null>(null);
  const [assignee, setAssignee] = React.useState<string | null>(null);
  const [priority, setPriority] = React.useState<Priority>("None");
  const [saving, setSaving] = React.useState(false);

  const idsKey = ids.join(",");
  React.useEffect(() => {
    let live = true;
    apiFetch<PickingResult>("/api/work-orders/picking", { method: "POST", body: { ids: idsKey.split(","), dryRun: true } })
      .then((r) => { if (live) { setPreview(r); setJobTypeId(r.jobTypes[0]?.id ?? null); } })
      .catch((e: unknown) => { if (live) setPreviewError(errorMessage(e)); });
    return () => { live = false; };
  }, [idsKey]);

  const allocatable = preview?.outcomes.filter((o) => o.outcome === "allocated") ?? [];
  const short = preview?.outcomes.filter((o) => o.outcome === "shortage") ?? [];
  const failed = preview?.outcomes.filter((o) => o.outcome === "failed") ?? [];
  const warehouses = new Set(preview?.jobTypes.map((j) => j.warehouseId));

  const run = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<PickingResult>("/api/work-orders/picking", {
        method: "POST", body: { ids: [...allocatable, ...short].map((o) => o.id), jobTypeId: warehouses.size > 1 ? null : jobTypeId, assigneeUserId: assignee, priority },
      });
      const ok = res.outcomes.filter((o) => o.outcome === "allocated").length;
      const sh = res.outcomes.filter((o) => o.outcome === "shortage");
      const bad = res.outcomes.filter((o) => o.outcome === "failed");
      if (sh.length === 0 && bad.length === 0) toast.success("Success", `Components allocated and ${ok} picking job${ok === 1 ? "" : "s"} created.`);
      else toast.show({ variant: ok ? "warning" : "error", title: ok ? "Partly done" : "Shortage", message: `${ok} allocated · ${sh.length} short${sh.length ? ` (${sh.map((o) => o.code).join(", ")} now Shortage)` : ""}${bad.length ? ` · ${bad.length} failed: ${bad[0]?.message ?? ""}` : ""}`, duration: 9000 });
      await invalidate();
      onDone?.();
      onClose();
    } catch (error) {
      toast.error("Error", errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const nextReason = !preview ? "Checking components…" : allocatable.length + short.length === 0 ? "None of the selected work orders can be allocated" : null;
  const runReason = saving ? "Creating…" : allocatable.length > 0 && !jobTypeId && warehouses.size <= 1 ? "Select a job type" : null;

  return (
    <>
      <DialogHeader title="Picking/Job operations" description="Allocate the components of work orders with picking and create Work Order Picking jobs that bring them to the kitting area." />
      <DialogBody>
        {previewError ? <Callout variant="error" title="Allocation check failed">{previewError}</Callout> : !preview ? (
          <div className="flex flex-col gap-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
        ) : step === "preview" ? (
          <div className="flex flex-col gap-3">
            <div className={cn("flex items-center gap-3 rounded-lg border p-3", allocatable.length ? "border-success/30 bg-success-soft" : "border-warning/30 bg-warning-soft")}>
              {allocatable.length ? <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> : <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />}
              <p className="text-base font-semibold text-foreground">{allocatable.length} of {preview.outcomes.length} work order{preview.outcomes.length === 1 ? "" : "s"} can be fully allocated</p>
            </div>
            <ul className="ks-scroll max-h-[46vh] divide-y divide-border overflow-auto rounded-md border border-border text-xs">
              {preview.outcomes.map((o) => (
                <li key={o.id} className="flex items-start gap-3 px-3 py-2">
                  <OutcomeIcon outcome={o.outcome} />
                  <span className="w-28 shrink-0 font-semibold text-foreground">{o.code}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1 text-secondary">
                    <span>{o.outcome === "allocated" ? "Components allocate; a picking job is created" : o.outcome === "shortage" ? "Short components — the work order becomes Shortage with a manual allocation exception" : o.message}</span>
                    {o.shortages.length ? (
                      <span className="flex flex-wrap gap-1.5">
                        {o.shortages.map((s) => <span key={s.sku} className="rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning">{s.sku}: need {s.need}, free {s.free}</span>)}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {failed.length ? <p className="text-xs text-secondary">Not eligible work orders are skipped.</p> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {warehouses.size > 1 ? (
              <Callout variant="info" title="Several warehouses">Each work order uses the first active Work Order job type of its own warehouse.</Callout>
            ) : (
              <Field id="jobTypeId" label="Job type" required info="Work Order job types of this warehouse">
                <Select id="jobTypeId" value={jobTypeId} onChange={setJobTypeId} placeholder={preview.jobTypes.length ? "Select job type" : "No Work Order job type"} options={preview.jobTypes.map((j) => ({ value: j.id, label: j.code, description: j.name }))} />
              </Field>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field id="assignee" label="Assign to">
                <UserPicker id="assignee" value={assignee} onChange={(v) => setAssignee(v)} />
              </Field>
              <Field id="priority" label="Priority">
                <Select id="priority" value={priority} onChange={(v) => setPriority((v ?? "None") as Priority)} options={PRIORITIES.map((p) => ({ value: p, label: p }))} />
              </Field>
            </div>
            <p className="text-xs text-secondary">
              <strong className="text-foreground">{allocatable.length}</strong> picking job{allocatable.length === 1 ? "" : "s"} will be created
              {short.length ? <> · <strong className="text-warning">{short.length}</strong> work order{short.length === 1 ? "" : "s"} will be marked Shortage</> : null}
            </p>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        {step === "options" ? <Button type="button" variant="secondary" onClick={() => setStep("preview")} disabled={saving}>Back</Button> : null}
        {step === "preview" ? (
          <DisabledReason reason={nextReason}>
            <Button type="button" variant="primary" disabled={Boolean(nextReason)} onClick={() => setStep("options")}>Next</Button>
          </DisabledReason>
        ) : (
          <DisabledReason reason={runReason}>
            <Button type="button" variant="primary" disabled={Boolean(runReason)} onClick={() => void run()} aria-busy={saving}>
              {saving ? <Spinner className="h-3.5 w-3.5" label="Creating" /> : <ListPlus className="h-3.5 w-3.5" aria-hidden />}
              {allocatable.length ? "Create job" : "Mark shortage"}
            </Button>
          </DisabledReason>
        )}
      </DialogFooter>
    </>
  );
}
