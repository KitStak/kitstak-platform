"use client";

/**
 * Create Job modal (BUILD_PLAN F4.4), backed by `/api/ops/jobs`.
 *   Step A  eligibility: "X of Y orders are eligible" + per-record reasons
 *   Path 1  Merge Into Existing Job: JOB CODE / TYPE / QTY / PROGRESS / ASSIGNEE → Select Job
 *   Path 2  Create New Job: Job Type*, Batch Size*, Assign to, preview of the jobs to be
 *           created, footer "N Person Assigned | Total Job", Back / Create Job
 * Used by Orders, Shipment Plans, Work Orders and Counts via `operation`.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GitMerge, ListPlus, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, isApiError, type ApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RadioCards } from "@/components/ui/radio-cards";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { bulkResultSchema, bulkSummary, eligibilitySchema, mergeableJobSchema, parseList, type Eligibility, type JobOperation, type MergeableJob } from "./contracts";
import { createJobReason, nounFor, planJobBatches } from "./create-job-model";
import { UserPicker } from "./entity-pickers";

type Step = "eligibility" | "merge" | "create";

export interface CreateJobModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly operation: JobOperation;
  readonly ids: readonly string[];
  /** Query keys to refresh after jobs are created/merged. */
  readonly invalidate?: readonly (readonly unknown[])[];
  readonly onDone?: (jobIds: readonly string[]) => void;
}

function EligibilityStep({ data, operation, path, onPath }: { readonly data: Eligibility; readonly operation: JobOperation; readonly path: "merge" | "create" | null; readonly onPath: (p: "merge" | "create") => void }) {
  const n = data.eligible.length;
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("flex items-center gap-3 rounded-lg border p-3", n ? "border-success/30 bg-success-soft" : "border-danger/30 bg-danger-soft")}>
        {n ? <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> : <XCircle className="h-5 w-5 text-danger" aria-hidden />}
        <p className="text-base font-semibold text-foreground">
          {n} of {data.total} {nounFor(operation, data.total)} {n === 1 ? "is" : "are"} eligible
        </p>
      </div>
      {data.ineligible.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-secondary">Not eligible</p>
          <ul className="ks-scroll max-h-40 divide-y divide-border overflow-auto rounded-md border border-border text-xs">
            {data.ineligible.map((r) => (
              <li key={r.id} className="flex gap-3 px-3 py-1.5">
                {/* The record code, never the error code (INVALID_STATE / NOT_FOUND). */}
                <span className="w-28 shrink-0 font-semibold text-foreground">{r.recordCode ?? (r.code && !/^[A-Z_]+$/.test(r.code) ? r.code : "—")}</span>
                <span className="text-secondary">{r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {n > 0 ? (
        <RadioCards<"merge" | "create">
          ariaLabel="How to continue"
          columns={2}
          chevron
          value={path}
          onChange={onPath}
          options={[
            { value: "merge", title: "Merge into existing job", description: "Add to a pending job of the same type", icon: GitMerge },
            { value: "create", title: "Create new job", description: "Batch the eligible records into new jobs", icon: ListPlus },
          ]}
        />
      ) : null}
    </div>
  );
}

function MergeStep({ operation, jobs, loading, selected, onSelect }: { readonly operation: JobOperation; readonly jobs: readonly MergeableJob[]; readonly loading: boolean; readonly selected: string | null; readonly onSelect: (id: string) => void }) {
  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (jobs.length === 0) return <p className="py-10 text-center text-sm text-faint">No open jobs can take these {nounFor(operation, 2)}. Create a new job instead.</p>;
  return (
    <div role="radiogroup" aria-label="Job to merge into" className="overflow-hidden rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
          <tr>
            <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Select</span></th>
            <th scope="col" className="px-3 py-2">Job code</th>
            <th scope="col" className="px-3 py-2">Type</th>
            <th scope="col" className="px-3 py-2 text-right">Qty</th>
            <th scope="col" className="w-40 px-3 py-2">Progress</th>
            <th scope="col" className="px-3 py-2">Assignee</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} onClick={() => onSelect(j.id)} className={cn("cursor-pointer border-t border-border", selected === j.id ? "bg-primary-soft" : "hover:bg-surface-sunken")}>
              <td className="px-3 py-2">
                <input type="radio" name="merge-job" aria-label={`Select ${j.code}`} checked={selected === j.id} onChange={() => onSelect(j.id)} className="accent-[var(--color-primary)]" />
              </td>
              <td className="px-3 py-2 font-semibold text-foreground">{j.code}</td>
              <td className="px-3 py-2 text-secondary">{j.jobType}</td>
              <td className="px-3 py-2 text-right tabular-nums">{j.quantity}</td>
              <td className="px-3 py-2"><ProgressBar value={j.progress} showValue label={`${j.code} progress`} /></td>
              <td className="px-3 py-2 text-secondary">{j.assigneeName ?? "Unassigned"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface CreateState {
  readonly jobTypeId: string | null;
  readonly batchSize: number | null;
  readonly assigneeUserId: string | null;
}

function CreateStep({ data, state, onChange }: { readonly data: Eligibility; readonly state: CreateState; readonly onChange: (s: CreateState) => void }) {
  const batches = state.batchSize ? planJobBatches(data.eligible.length, state.batchSize) : [];
  const jobType = data.jobTypes.find((t) => t.id === state.jobTypeId);
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_260px]">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
          <span>Job type <span className="text-danger">*</span></span>
          <Select
            aria-label="Job type"
            placeholder={data.jobTypes.length ? "Select job type" : "No job types configured"}
            disabled={data.jobTypes.length === 0}
            value={state.jobTypeId}
            options={data.jobTypes.map((t) => ({ value: t.id, label: t.name ? `${t.code} · ${t.name}` : t.code }))}
            onChange={(jobTypeId) => onChange({ ...state, jobTypeId, batchSize: data.jobTypes.find((t) => t.id === jobTypeId)?.defaultBatchSize ?? state.batchSize })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
          <span>Batch size <span className="text-danger">*</span></span>
          <NumberInput aria-label="Batch size" min={1} max={1000} value={state.batchSize} onChange={(batchSize) => onChange({ ...state, batchSize })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
          Assign to
          <UserPicker value={state.assigneeUserId} onChange={(assigneeUserId) => onChange({ ...state, assigneeUserId })} placeholder="Leave unassigned" />
        </label>
      </div>
      <aside aria-label="Jobs preview" className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken p-3">
        <p className="text-xs font-semibold text-secondary">Below jobs will be created</p>
        {batches.length === 0 ? (
          <p className="text-xs text-faint">Choose a job type and batch size to preview.</p>
        ) : (
          <ul className="ks-scroll flex max-h-48 flex-col gap-1 overflow-auto">
            {batches.map((size, i) => (
              <li key={i} className="flex items-center justify-between rounded-md bg-surface px-2.5 py-1.5 text-xs">
                <span className="font-semibold text-foreground">{jobType?.code ?? "Job"} #{i + 1}</span>
                <span className="text-secondary">{size} records</span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

const EMPTY_CREATE: CreateState = { jobTypeId: null, batchSize: null, assigneeUserId: null };

function Body({ onOpenChange, operation, ids, invalidate = [], onDone }: Omit<CreateJobModalProps, "open">) {
  const queryClient = useQueryClient();
  const [step, setStep] = React.useState<Step>("eligibility");
  const [path, setPath] = React.useState<"merge" | "create" | null>(null);
  const [mergeJobId, setMergeJobId] = React.useState<string | null>(null);
  const [create, setCreate] = React.useState<CreateState>(EMPTY_CREATE);
  const [submitting, setSubmitting] = React.useState(false);
  const eligibility = useQuery<unknown, ApiError>({
    queryKey: ["job-eligibility", operation, ids.join(",")],
    queryFn: () => apiFetch<unknown>("/api/ops/jobs/eligibility", { method: "POST", body: { operation, ids } }),
    retry: false,
    staleTime: 0,
  });
  const parsed = eligibilitySchema.safeParse(eligibility.data);
  const data = parsed.success ? parsed.data : null;
  const jobs = useApiQuery<unknown>(["mergeable-jobs", operation], step === "merge" ? "/api/pickers/jobs" : null, { query: { operation, mergeable: true, status: "Pending,Started", limit: 50 } });
  const mergeable = parseList(mergeableJobSchema, jobs.data?.data);

  const submit = async () => {
    if (!data) return;
    setSubmitting(true);
    try {
      const body = step === "merge" ? { operation, mode: "merge", jobId: mergeJobId, ids: data.eligible } : { operation, mode: "create", ids: data.eligible, jobTypeId: create.jobTypeId, batchSize: create.batchSize, assigneeUserId: create.assigneeUserId };
      const result = bulkResultSchema.parse(await apiFetch<unknown>("/api/ops/jobs", { method: "POST", body }));
      const noun = nounFor(operation, data.eligible.length);
      (result.failed.length ? toast.warning : toast.success)(step === "merge" ? "Merged into job" : "Jobs created", bulkSummary(result, noun, step === "merge" ? "merged" : "added to jobs"));
      await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onDone?.(result.jobIds ?? (mergeJobId ? [mergeJobId] : []));
      onOpenChange(false);
    } catch (error) {
      toast.error("Error", isApiError(error) ? error.message : "The jobs could not be created.");
    } finally {
      setSubmitting(false);
    }
  };

  const assigned = create.assigneeUserId ? 1 : 0;
  const totalJobs = data && create.batchSize ? planJobBatches(data.eligible.length, create.batchSize).length : 0;
  const nextReason = !data ? "Checking eligibility…" : data.eligible.length === 0 ? "No records are eligible" : path ? null : "Choose how to continue";
  const finishReason = submitting ? "Saving…" : step === "merge" ? (mergeJobId ? null : "Select a job") : createJobReason(create);

  return (
    <>
      <DialogHeader title={step === "merge" ? "Merge into existing job" : step === "create" ? "Create new job" : "Create job"} description={`${ids.length} ${nounFor(operation, ids.length)} selected`} />
      <DialogBody>
        {eligibility.isPending ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : eligibility.error || !data ? (
          <p className="py-8 text-center text-sm text-danger">{eligibility.error?.message ?? "The eligibility check returned an unexpected response."}</p>
        ) : step === "eligibility" ? (
          <EligibilityStep data={data} operation={operation} path={path} onPath={setPath} />
        ) : step === "merge" ? (
          <MergeStep operation={operation} jobs={mergeable} loading={jobs.isPending} selected={mergeJobId} onSelect={setMergeJobId} />
        ) : (
          <CreateStep data={data} state={create} onChange={setCreate} />
        )}
      </DialogBody>
      <DialogFooter>
        {step === "create" ? (
          <span className="mr-auto text-xs text-secondary">
            <strong className="text-foreground">{assigned}</strong> Person Assigned <span className="mx-1 text-border-strong">|</span> <strong className="text-foreground">{totalJobs}</strong> Total Job
          </span>
        ) : null}
        {step === "eligibility" ? (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <DisabledReason reason={nextReason}>
              <Button variant="primary" disabled={Boolean(nextReason)} onClick={() => path && setStep(path)}>Next</Button>
            </DisabledReason>
          </>
        ) : (
          <>
            <Button variant="secondary" disabled={submitting} onClick={() => setStep("eligibility")}>Back</Button>
            <DisabledReason reason={finishReason}>
              <Button variant="primary" disabled={Boolean(finishReason)} onClick={() => void submit()}>
                {submitting ? <Spinner className="h-3.5 w-3.5" /> : null}
                {step === "merge" ? "Select job" : "Create job"}
              </Button>
            </DisabledReason>
          </>
        )}
      </DialogFooter>
    </>
  );
}

export function CreateJobModal({ open, ...props }: CreateJobModalProps) {
  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent size="lg">{open ? <Body {...props} /> : null}</DialogContent>
    </Dialog>
  );
}
