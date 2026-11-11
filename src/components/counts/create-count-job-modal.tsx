"use client";

/**
 * Create New Job for count plans (Logiwa 04 §6.2): Job Type* (the warehouse's Count job
 * types), Batch Size (Location)*, Assign to. A preview shows how many jobs each plan
 * splits into. Plans move to Ready To Count.
 */
import * as React from "react";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { useApiQuery } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { DisabledReason } from "@/components/ui/tooltip";
import type { CountPlanListRow } from "@/lib/grid-defs/counts/count-rows";
import { jobsForUnits } from "@/lib/grid-defs/counts/count-math";
import { CountAssigneeSelect } from "./count-assignee-select";
import { errorMessage, runBulkCommand, useCountCan, COUNT_QUERY_TIMEOUT_MS } from "./counts-client";

interface JobPreview { readonly planId: string; readonly code: string; readonly units: number; readonly lines: number; readonly cancelled?: number }
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
  const types = useApiQuery<JobTypeOption[]>(["count-job-types", warehouseId ?? ""], warehouseId ? "/api/counts/job-types" : null, { query: { warehouseId: warehouseId ?? "" }, timeoutMs: COUNT_QUERY_TIMEOUT_MS });
  const list = types.data?.data ?? [];
  const cycle = list.filter((t) => !t.instantCount);
  const options = (cycle.length ? cycle : list).map((t) => ({ value: t.id, label: `${t.code} · ${t.description}`, textValue: t.code }));
  const [pickedType, setJobTypeId] = React.useState<string | null>(null);
  const [pickedBatch, setBatchSize] = React.useState<number | null | undefined>(undefined);
  const [assignee, setAssignee] = React.useState<string | null>(null);
  const [tried, setTried] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const jobTypeId = pickedType ?? (options.length === 1 ? options[0]?.value ?? null : null);
  const canCreateType = useCountCan("settings.job_types.create").allowed;
  const [creatingType, setCreatingType] = React.useState(false);
  const createDefaultType = async () => {
    if (!warehouseId) return;
    setCreatingType(true);
    try {
      const created = await apiFetch<JobTypeOption>("/api/counts/job-types", { method: "POST", body: { warehouseId } });
      toast.success("Success", `Job type ${created.code} is created.`);
      await types.refetch();
      setJobTypeId(created.id);
    } catch (error) {
      toast.error("Error", errorMessage(error));
    } finally {
      setCreatingType(false);
    }
  };

  // Batch units come from the server (SKU lines expand to every stocked location on save), so the
  // preview and the footer total match the jobs that Save creates.
  const preview = useApiQuery<JobPreview[]>(["count-job-preview", plans.map((p) => p.id).sort().join(",")], plans.length ? "/api/counts/create-job" : null, { query: { ids: plans.map((p) => p.id).join(",") }, staleTime: 0, timeoutMs: COUNT_QUERY_TIMEOUT_MS });
  const unitsByPlan = new Map((preview.data?.data ?? []).map((r) => [r.planId, r]));
  const unitsOf = (p: CountPlanListRow): number | null => unitsByPlan.get(p.id)?.units ?? (preview.isPending ? null : Math.max(p.locationCount, 1));
  const maxLocations = Math.max(1, ...plans.map((p) => unitsOf(p) ?? 1));
  const batchSize = pickedBatch === undefined ? Math.min(maxLocations, 50) : pickedBatch;

  const jobTypeError = tried && !jobTypeId ? "Choose a job type" : undefined;
  // Batch size is checked as you type (not only on Save), so an invalid value never shows a stale preview.
  const batchProblem = batchSize === null || batchSize === undefined ? "Enter a batch size" : !Number.isInteger(batchSize) ? "Whole numbers only" : batchSize < 1 ? "At least 1" : batchSize > 1000 ? "At most 1000" : null;
  const batchError = batchProblem && (tried || batchSize !== null) ? batchProblem : undefined;
  const reason = warehouseIds.length > 1 ? "Select plans from one warehouse" : types.isPending ? "Loading job types…" : types.error ? "Job types could not be loaded" : options.length === 0 ? "Create a Count job type first" : !jobTypeId ? "Choose a job type" : batchProblem ? `Batch Size (Location): ${batchProblem.toLowerCase()}` : saving ? "Saving…" : null;
  const jobsFor = (p: CountPlanListRow): number | null => { const u = unitsOf(p); return u === null || batchProblem ? null : Math.max(1, jobsForUnits(u, batchSize ?? 1)); };
  const totalJobs = preview.isPending || batchProblem ? null : plans.reduce((s, p) => s + (jobsFor(p) ?? 0), 0);
  const reissue = plans.some((p) => p.status !== "Pending");
  const selected = list.find((t) => t.id === jobTypeId);

  const submit = async () => {
    setTried(true);
    if (!jobTypeId || batchProblem || !batchSize) return;
    setSaving(true);
    const res = await runBulkCommand("/api/counts/create-job", { ids: plans.map((p) => p.id), jobTypeId, batchSize, assigneeUserId: assignee }, plans.length === 1 ? "count plan" : "count plans", reissue ? "given a new count job" : "moved to Ready to Count");
    setSaving(false);
    if (res) { onDone(); if (res.succeeded.length > 0) onOpenChange(false); }
  };

  return (
    <>
      <DialogHeader title={reissue ? "Re-create count job" : "Create New Job"} description={`${plans.length} ${plans.length === 1 ? "count plan" : "count plans"} selected: ${plans.slice(0, 3).map((p) => p.code).join(", ")}${plans.length > 3 ? ` +${plans.length - 3}` : ""}`} />
      <DialogBody>
        {warehouseIds.length > 1 ? <Callout variant="attention" title="Several warehouses">Job types belong to one warehouse. Select count plans from a single warehouse.</Callout> : (
          <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }} className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_260px]">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="cj-type" required>Job Type</FieldLabel>
                <Select id="cj-type" aria-label="Job Type" value={jobTypeId} onChange={setJobTypeId} options={options} invalid={Boolean(jobTypeError)} disabled={types.isPending || options.length === 0}
                  placeholder={types.isPending ? "Loading…" : options.length ? "Select job type" : "No job type has been created yet"} />
                {types.error ? <p role="alert" className="text-xs text-danger">{types.error.message}</p> : null}
                {!types.isPending && !types.error && options.length === 0 ? (
                  <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-sunken p-3">
                    <p className="text-xs text-secondary">This warehouse has no Count job type yet.{canCreateType ? " Create the default one now (lines with no difference update inventory automatically), or configure your own" : " Ask an admin to add one, or configure it"} under <Link className="font-semibold text-primary hover:underline" href="/settings/job-types">Settings → Job Types</Link>.</p>
                    {canCreateType ? <Button type="button" size="sm" variant="secondary" className="self-start" disabled={creatingType} onClick={() => void createDefaultType()}><Plus className="h-3.5 w-3.5" aria-hidden />{creatingType ? "Creating…" : "Create default Cycle Count job type"}</Button> : null}
                  </div>
                ) : null}
                {selected ? <p className="text-2xs text-secondary">{selected.autoUpdateNoDifference ? "Lines counted with no difference update inventory automatically." : "Every counted line waits for Update Inv."}</p> : null}
                <FieldError id="cj-type-err" message={jobTypeError} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="cj-batch" required info="How many locations each job contains, so one plan can be split across several counters.">Batch Size (Location)</FieldLabel>
                <NumberInput id="cj-batch" aria-label="Batch Size (Location)" min={1} max={1000} value={batchSize} onChange={setBatchSize} invalid={Boolean(batchError)} aria-invalid={Boolean(batchError)} aria-describedby={batchError ? "cj-batch-err" : undefined} className="w-[160px] [&_input]:text-left" />
                <FieldError id="cj-batch-err" message={batchError} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="cj-user">Assign to</FieldLabel>
                <CountAssigneeSelect id="cj-user" warehouseId={warehouseId} value={assignee} onChange={setAssignee} />
              </div>
            </div>
            <aside aria-label="Jobs preview" className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken p-3">
              <p className="text-xs font-semibold text-secondary">Below jobs will be created</p>
              <ul className="ks-scroll flex max-h-52 flex-col gap-1 overflow-auto">
                {plans.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-surface px-2.5 py-1.5 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5 font-semibold text-foreground"><ClipboardList className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /><span className="truncate">{p.code}</span></span>
                    <span className="flex shrink-0 flex-col items-end leading-tight">
                      {batchProblem ? <span className="font-semibold text-faint" title="Fix the batch size to see the jobs">—</span> : jobsFor(p) === null ? <Spinner className="h-3 w-3" label="Calculating" /> : <span className="font-semibold text-foreground">{jobsFor(p)} {jobsFor(p) === 1 ? "job" : "jobs"}</span>}
                      {unitsByPlan.get(p.id) ? <span className="text-2xs text-secondary">{unitsByPlan.get(p.id)?.units} {unitsByPlan.get(p.id)?.units === 1 ? "location" : "locations"}{(unitsByPlan.get(p.id)?.cancelled ?? 0) > 0 ? ` · ${unitsByPlan.get(p.id)?.cancelled} cancelled ${unitsByPlan.get(p.id)?.cancelled === 1 ? "line" : "lines"} skipped` : ""}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              {batchProblem ? <p role="status" className="text-2xs font-semibold text-danger">Enter a valid batch size to see the jobs.</p> : null}
              {reissue ? <p className="text-2xs text-secondary">Started plans: only the lines whose count job was cancelled get a new job.</p> : null}
              <p className="text-2xs text-faint">Jobs = locations ÷ batch size, rounded up. SKU counts expand to one line per stocked location.</p>
              {preview.error ? <p role="alert" className="text-2xs text-danger">The preview could not be calculated: {preview.error.message}</p> : null}
            </aside>
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        )}
      </DialogBody>
      <DialogFooter>
        <span className="mr-auto text-xs text-secondary"><strong className="text-foreground">{assignee ? 1 : 0}</strong> Person Assigned <span className="mx-1 text-border-strong">|</span> <strong className="text-foreground">{totalJobs ?? (batchProblem ? "—" : "…")}</strong> Total {totalJobs === 1 ? "Job" : "Jobs"}</span>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <DisabledReason reason={reason}>
          <Button variant="primary" disabled={Boolean(reason)} onClick={() => void submit()}>{saving ? <Spinner className="h-3.5 w-3.5" /> : null}Save</Button>
        </DisabledReason>
      </DialogFooter>
    </>
  );
}
