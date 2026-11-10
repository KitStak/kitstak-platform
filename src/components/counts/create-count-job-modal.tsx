"use client";

/**
 * Create New Job for count plans (Logiwa 04 §6.2): Job Type* (the warehouse's Count job
 * types), Batch Size (Location)*, Assign to. A preview shows how many jobs each plan
 * splits into. Plans move to Ready To Count.
 */
import * as React from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { DisabledReason } from "@/components/ui/tooltip";
import { UserPicker } from "@/components/shared/entity-pickers";
import type { CountPlanListRow } from "@/lib/grid-defs/counts/count-rows";
import { runBulkCommand } from "./counts-client";

interface JobTypeOption { readonly id: string; readonly code: string; readonly description: string; readonly autoUpdateNoDifference: boolean; readonly instantCount: boolean }

export interface CreateCountJobModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly plans: readonly CountPlanListRow[];
  readonly onDone: () => void;
}

export function CreateCountJobModal({ open, onOpenChange, plans, onDone }: CreateCountJobModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">{open ? <Body plans={plans} onOpenChange={onOpenChange} onDone={onDone} /> : null}</DialogContent>
    </Dialog>
  );
}

function Body({ plans, onOpenChange, onDone }: Omit<CreateCountJobModalProps, "open">) {
  const warehouseIds = [...new Set(plans.map((p) => p.warehouseId))];
  const warehouseId = warehouseIds.length === 1 ? warehouseIds[0] ?? null : null;
  const types = useApiQuery<JobTypeOption[]>(["count-job-types", warehouseId ?? ""], warehouseId ? "/api/counts/job-types" : null, { query: { warehouseId: warehouseId ?? "" } });
  const list = types.data?.data ?? [];
  const cycle = list.filter((t) => !t.instantCount);
  const options = (cycle.length ? cycle : list).map((t) => ({ value: t.id, label: `${t.code} · ${t.description}`, textValue: t.code }));
  const [pickedType, setJobTypeId] = React.useState<string | null>(null);
  const [pickedBatch, setBatchSize] = React.useState<number | null | undefined>(undefined);
  const [assignee, setAssignee] = React.useState<string | null>(null);
  const [tried, setTried] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const jobTypeId = pickedType ?? (options.length === 1 ? options[0]?.value ?? null : null);

  const maxLocations = Math.max(1, ...plans.map((p) => p.countType === "SKU" ? Math.max(p.locationCount, p.lineCount) : p.locationCount));
  const batchSize = pickedBatch === undefined ? Math.min(maxLocations, 50) : pickedBatch;

  const jobTypeError = tried && !jobTypeId ? "Choose a job type" : undefined;
  const batchError = tried && (!batchSize || batchSize < 1) ? "Enter a batch size of at least 1" : undefined;
  const reason = warehouseIds.length > 1 ? "Select plans from one warehouse" : saving ? "Saving…" : null;
  const jobsFor = (p: CountPlanListRow) => Math.max(1, Math.ceil(Math.max(p.locationCount, p.countType === "SKU" ? p.lineCount : 0, 1) / Math.max(1, batchSize ?? 1)));
  const totalJobs = plans.reduce((s, p) => s + jobsFor(p), 0);
  const selected = list.find((t) => t.id === jobTypeId);

  const submit = async () => {
    setTried(true);
    if (!jobTypeId || !batchSize || batchSize < 1) return;
    setSaving(true);
    const res = await runBulkCommand("/api/counts/create-job", { ids: plans.map((p) => p.id), jobTypeId, batchSize, assigneeUserId: assignee }, plans.length === 1 ? "count plan" : "count plans", "moved to Ready To Count");
    setSaving(false);
    if (res) { onDone(); if (res.succeeded.length > 0) onOpenChange(false); }
  };

  return (
    <>
      <DialogHeader title="Create New Job" description={`${plans.length} ${plans.length === 1 ? "count plan" : "count plans"} selected: ${plans.slice(0, 3).map((p) => p.code).join(", ")}${plans.length > 3 ? ` +${plans.length - 3}` : ""}`} />
      <DialogBody>
        {warehouseIds.length > 1 ? <Callout variant="attention" title="Several warehouses">Job types belong to one warehouse. Select count plans from a single warehouse.</Callout> : (
          <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }} className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_260px]">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="cj-type" required>Job Type</FieldLabel>
                <Select id="cj-type" aria-label="Job Type" value={jobTypeId} onChange={setJobTypeId} options={options} invalid={Boolean(jobTypeError)} disabled={types.isPending || options.length === 0}
                  placeholder={types.isPending ? "Loading…" : options.length ? "Select job type" : "No job type has been created yet"} />
                {!types.isPending && options.length === 0 ? (
                  <p className="text-[12px] text-secondary">Add a Count job type first under <Link className="font-semibold text-primary hover:underline" href="/settings/job-types">Settings → Job Types</Link>.</p>
                ) : null}
                {selected ? <p className="text-[11px] text-secondary">{selected.autoUpdateNoDifference ? "Lines counted with no difference update inventory automatically." : "Every counted line waits for Update Inv."}</p> : null}
                <FieldError id="cj-type-err" message={jobTypeError} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="cj-batch" required info="How many locations each job contains, so one plan can be split across several counters.">Batch Size (Location)</FieldLabel>
                <NumberInput id="cj-batch" aria-label="Batch Size (Location)" min={1} max={1000} value={batchSize} onChange={setBatchSize} invalid={Boolean(batchError)} />
                <FieldError id="cj-batch-err" message={batchError} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="cj-user">Assign to</FieldLabel>
                <UserPicker id="cj-user" warehouseId={warehouseId} value={assignee} onChange={(v) => setAssignee(v)} placeholder="Leave in the job pool" clearable />
              </div>
            </div>
            <aside aria-label="Jobs preview" className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken p-3">
              <p className="text-[12px] font-semibold text-secondary">Below jobs will be created</p>
              <ul className="ks-scroll flex max-h-52 flex-col gap-1 overflow-auto">
                {plans.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-surface px-2.5 py-1.5 text-[12px]">
                    <span className="flex min-w-0 items-center gap-1.5 font-semibold text-foreground"><ClipboardList className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /><span className="truncate">{p.code}</span></span>
                    <span className="shrink-0 text-secondary">{jobsFor(p)} {jobsFor(p) === 1 ? "job" : "jobs"}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-faint">SKU counts expand to one line per stocked location when the job is created.</p>
            </aside>
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        )}
      </DialogBody>
      <DialogFooter>
        <span className="mr-auto text-[12px] text-secondary"><strong className="text-foreground">{assignee ? 1 : 0}</strong> Person Assigned <span className="mx-1 text-border-strong">|</span> <strong className="text-foreground">{totalJobs}</strong> Total Job</span>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <DisabledReason reason={reason}>
          <Button variant="primary" disabled={Boolean(reason)} onClick={() => void submit()}>{saving ? <Spinner className="h-3.5 w-3.5" /> : null}Save</Button>
        </DisabledReason>
      </DialogFooter>
    </>
  );
}
