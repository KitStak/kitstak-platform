"use client";

/**
 * Picking / Job Operations for shipment orders (Logiwa "Picking/Job Operations"):
 *   1. allocates the selected Open / Shortage orders (`/api/ops/allocate`, full mode, per
 *      warehouse) — Logiwa allocates while it creates the job;
 *   2. eligibility summary + choice: Merge into existing job / Create new job;
 *   3a. merge: pending picking jobs of the warehouse (job code, type, qty, progress, assignee);
 *   3b. create: job type (picking types of the warehouse), batch size, assignee, a live dry run
 *       ("X of Y orders are eligible" with per-order reasons) and the jobs preview;
 *   4. `POST /api/ops/jobs { mode, orderIds, … }`.
 * LOCAL ADAPTER for docs/requests/orders-outbound.md REQ-5: the shared CreateJobModal posts
 * `ids` while `/api/ops/jobs` expects `orderIds`, so orders use this modal until it lands.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, GitMerge, ListPlus, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, type ApiError } from "@/lib/api-client";
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
import { UserPicker } from "@/components/shared";
import type { OrderJobOptions } from "@/server/repositories/orders-options";
import { errorMessage, ORDER_INVALIDATE } from "../orders-client";

export interface JobOrderRef {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly warehouseId: string;
}

interface BulkFailure {
  readonly id: string;
  readonly message: string;
}

interface AllocationResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly BulkFailure[];
}

interface DryRun {
  readonly total: number;
  readonly eligible: readonly string[];
  readonly ineligible: readonly BulkFailure[];
  readonly jobCount: number;
}

interface JobsResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly BulkFailure[];
  readonly jobIds?: readonly string[];
}

const NEEDS_ALLOCATION = new Set(["Open", "Shortage"]);
const CAN_JOIN_JOB = new Set(["Open", "Shortage", "Ready to Pick"]);

/** Groups the orders that still need stock by warehouse (the allocate endpoint is per warehouse). */
export function allocationBatches(orders: readonly JobOrderRef[]): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const o of orders) {
    if (!NEEDS_ALLOCATION.has(o.status)) continue;
    out.set(o.warehouseId, [...(out.get(o.warehouseId) ?? []), o.id]);
  }
  return out;
}

/** Pre-check before anything is written: one warehouse, and only statuses that can get a picking job. */
export function jobPrecheck(orders: readonly JobOrderRef[]): { readonly blocked: string | null; readonly skipped: readonly BulkFailure[] } {
  if (new Set(orders.map((o) => o.warehouseId)).size > 1) return { blocked: "Select orders from one warehouse. A picking job belongs to a single warehouse.", skipped: [] };
  const skipped = orders.filter((o) => !CAN_JOIN_JOB.has(o.status)).map((o) => ({ id: o.id, message: `Order is ${o.status}; only Open, Shortage or Ready to Pick orders can get a picking job.` }));
  return { blocked: skipped.length === orders.length && orders.length > 0 ? "None of the selected orders can get a picking job." : null, skipped };
}

/** Batch sizes of the jobs that will be created (last batch takes the remainder). */
export function jobBatches(count: number, batchSize: number | null): readonly number[] {
  if (!batchSize || count <= 0 || !Number.isInteger(batchSize) || batchSize < 1) return [];
  const full = Math.floor(count / batchSize);
  const rest = count % batchSize;
  return [...Array.from({ length: full }, () => batchSize), ...(rest ? [rest] : [])];
}

export interface OrderJobModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly orders: readonly JobOrderRef[];
  readonly onDone?: (jobIds: readonly string[]) => void;
}

type Step = "choose" | "merge" | "create";

export function OrderJobModal({ open, onOpenChange, orders, onDone }: OrderJobModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">{open ? <Body orders={orders} onOpenChange={onOpenChange} onDone={onDone} /> : null}</DialogContent>
    </Dialog>
  );
}

function Body({ orders, onOpenChange, onDone }: Omit<OrderJobModalProps, "open">) {
  const queryClient = useQueryClient();
  const codes = React.useMemo(() => new Map(orders.map((o) => [o.id, o.code])), [orders]);
  const precheck = React.useMemo(() => jobPrecheck(orders), [orders]);
  const warehouseId = orders[0]?.warehouseId ?? null;
  const [phase, setPhase] = React.useState<"allocating" | "ready">("allocating");
  const [ready, setReady] = React.useState<readonly string[]>([]);
  const [failed, setFailed] = React.useState<readonly BulkFailure[]>([]);
  const [step, setStep] = React.useState<Step>("choose");
  const [path, setPath] = React.useState<"merge" | "create" | null>(null);
  const [mergeJobId, setMergeJobId] = React.useState<string | null>(null);
  const [jobTypeId, setJobTypeId] = React.useState<string | null>(null);
  const [batchSize, setBatchSize] = React.useState<number | null>(null);
  const [assigneeUserId, setAssigneeUserId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const ordersRef = React.useRef(orders);
  ordersRef.current = orders;

  React.useEffect(() => {
    if (precheck.blocked) {
      setPhase("ready");
      return;
    }
    let cancelled = false;
    const run = async () => {
      const skippedIds = new Set(precheck.skipped.map((s) => s.id));
      const candidates = ordersRef.current.filter((o) => !skippedIds.has(o.id));
      const fails = new Map<string, string>(precheck.skipped.map((s) => [s.id, s.message]));
      for (const [wh, orderIds] of allocationBatches(candidates)) {
        try {
          const res = await apiFetch<AllocationResult>("/api/ops/allocate", { method: "POST", body: { action: "allocate", orderIds, warehouseId: wh, mode: "full" } });
          for (const f of res.failed) fails.set(f.id, f.message);
        } catch (error) {
          for (const id of orderIds) fails.set(id, errorMessage(error));
        }
      }
      if (cancelled) return;
      await Promise.all(ORDER_INVALIDATE.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      setFailed([...fails].map(([id, message]) => ({ id, message })));
      setReady(candidates.map((o) => o.id).filter((id) => !fails.has(id)));
      setPhase("ready");
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [precheck, queryClient]);

  const options = useApiQuery<OrderJobOptions>(["order-job-options", warehouseId ?? ""], warehouseId && phase === "ready" ? "/api/orders/job-options" : null, {
    query: { warehouseId: warehouseId ?? undefined },
    staleTime: 0,
  });
  const jobTypes = options.data?.data.jobTypes ?? [];
  const mergeable = options.data?.data.mergeableJobs ?? [];
  const jobType = jobTypes.find((t) => t.id === jobTypeId) ?? null;

  const dryRun = useQuery<DryRun, ApiError>({
    queryKey: ["order-job-dry-run", ready.join(","), step === "merge" ? `job:${mergeJobId}` : `type:${jobTypeId}`],
    queryFn: () => apiFetch<DryRun>("/api/ops/jobs/eligibility", {
      method: "POST",
      body: step === "merge" ? { operation: "order", orderIds: ready, jobId: mergeJobId } : { operation: "order", orderIds: ready, jobTypeId },
    }),
    enabled: ready.length > 0 && ((step === "create" && Boolean(jobTypeId)) || (step === "merge" && Boolean(mergeJobId))),
    retry: false,
    staleTime: 0,
  });
  const eligibleIds = dryRun.data?.eligible ?? null;

  const submit = async () => {
    const orderIds = eligibleIds && eligibleIds.length > 0 ? eligibleIds : ready;
    setSubmitting(true);
    try {
      const body = step === "merge"
        ? { mode: "merge", operation: "order", jobId: mergeJobId, orderIds }
        : { mode: "create", operation: "order", orderIds, jobTypeId, batchSize: batchSize ?? undefined, assigneeUserId };
      const result = await apiFetch<JobsResult>("/api/ops/jobs", { method: "POST", body });
      const ok = result.succeeded.length;
      const summary = `${ok} of ${orderIds.length} order${orderIds.length === 1 ? "" : "s"} ${step === "merge" ? "merged into the job" : `added to ${result.jobIds?.length ?? 0} new job${(result.jobIds?.length ?? 0) === 1 ? "" : "s"}`}`;
      if (result.failed.length) {
        const first = result.failed[0];
        toast.warning(step === "merge" ? "Merged with exceptions" : "Jobs created with exceptions", `${summary}. ${codes.get(first.id) ?? "An order"}: ${first.message}`);
      } else {
        toast.success(step === "merge" ? "Merged into job" : "Job created", summary);
      }
      await Promise.all([...ORDER_INVALIDATE, ["order-job-options"]].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onDone?.(result.jobIds ?? (mergeJobId ? [mergeJobId] : []));
      onOpenChange(false);
    } catch (error) {
      toast.error("The job could not be saved", errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const title = step === "merge" ? "Merge into existing job" : step === "create" ? "Create new job" : "Picking / job operations";
  const description = `${orders.length} order${orders.length === 1 ? "" : "s"} selected`;

  if (phase === "allocating") {
    return (
      <>
        <DialogHeader title={title} description={description} />
        <DialogBody className="flex items-center gap-3 py-8 text-[13px] text-body">
          <Spinner className="size-4" label="Allocating" />
          Allocating inventory for the selected orders…
        </DialogBody>
      </>
    );
  }

  const nextReason = precheck.blocked ?? (ready.length === 0 ? "No order is eligible" : path ? null : "Choose how to continue");
  const finishReason = submitting
    ? "Saving…"
    : step === "merge"
      ? (mergeJobId ? null : "Select a job")
      : !jobTypeId ? "Choose a job type" : !batchSize || batchSize < 1 ? "Enter a batch size" : null;
  const batches = jobBatches(eligibleIds?.length ?? ready.length, batchSize);

  return (
    <>
      <DialogHeader title={title} description={description} />
      <DialogBody>
        {step === "choose" ? (
          <ChooseStep blocked={precheck.blocked} ready={ready.length} total={orders.length} failed={failed} codes={codes} path={path} onPath={setPath} />
        ) : step === "merge" ? (
          <div className="flex flex-col gap-3">
            <MergeTable jobs={mergeable} loading={options.isPending} selected={mergeJobId} onSelect={setMergeJobId} />
            <DryRunNote query={dryRun} codes={codes} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_260px]">
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-secondary">
                <span>Job type <span className="text-danger">*</span></span>
                <Select
                  aria-label="Job type"
                  placeholder={options.isPending ? "Loading…" : jobTypes.length ? "Select job type" : "No picking job types in this warehouse"}
                  disabled={jobTypes.length === 0}
                  value={jobTypeId}
                  options={jobTypes.map((t) => ({ value: t.id, label: t.code, description: t.description }))}
                  onChange={(id) => {
                    setJobTypeId(id);
                    const t = jobTypes.find((x) => x.id === id);
                    if (t) setBatchSize(t.batchMax || 1);
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-secondary">
                <span>Batch size <span className="text-danger">*</span></span>
                <NumberInput aria-label="Batch size" min={1} max={1000} value={batchSize} onChange={setBatchSize} />
                {jobType ? <span className="font-normal text-faint">{jobType.batchMethod === "Nof Item" ? "Units" : "Orders"} per job · job type allows {jobType.batchMin}–{jobType.batchMax}</span> : null}
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-secondary">
                Assign to
                <UserPicker warehouseId={warehouseId} value={assigneeUserId} onChange={setAssigneeUserId} placeholder="Leave unassigned" />
              </label>
              <DryRunNote query={dryRun} codes={codes} />
            </div>
            <aside aria-label="Jobs preview" className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken p-3">
              <p className="text-[12px] font-semibold text-secondary">Below jobs will be created</p>
              {batches.length === 0 ? (
                <p className="text-[12px] text-faint">Choose a job type and batch size to preview.</p>
              ) : (
                <ul className="ks-scroll flex max-h-48 flex-col gap-1 overflow-auto">
                  {batches.map((size, i) => (
                    <li key={i} className="flex items-center justify-between rounded-md bg-surface px-2.5 py-1.5 text-[12px]">
                      <span className="font-semibold text-foreground">{jobType?.code ?? "Job"} #{i + 1}</span>
                      <span className="text-secondary">{size} order{size === 1 ? "" : "s"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        {step === "create" ? (
          <span className="mr-auto text-[12px] text-secondary">
            <strong className="text-foreground">{assigneeUserId ? 1 : 0}</strong> person assigned <span className="mx-1 text-border-strong">|</span> <strong className="text-foreground">{batches.length}</strong> total job{batches.length === 1 ? "" : "s"}
          </span>
        ) : null}
        {step === "choose" ? (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <DisabledReason reason={nextReason}>
              <Button variant="primary" disabled={Boolean(nextReason)} onClick={() => path && setStep(path)}>Next</Button>
            </DisabledReason>
          </>
        ) : (
          <>
            <Button variant="secondary" disabled={submitting} onClick={() => setStep("choose")}>
              <ArrowLeft className="size-3.5" aria-hidden /> Back
            </Button>
            <DisabledReason reason={finishReason}>
              <Button variant="primary" disabled={Boolean(finishReason)} onClick={() => void submit()}>
                {submitting ? <Spinner className="size-3.5" /> : null}
                {step === "merge" ? "Merge into job" : "Create job"}
              </Button>
            </DisabledReason>
          </>
        )}
      </DialogFooter>
    </>
  );
}

function ChooseStep({ blocked, ready, total, failed, codes, path, onPath }: {
  readonly blocked: string | null; readonly ready: number; readonly total: number; readonly failed: readonly BulkFailure[];
  readonly codes: ReadonlyMap<string, string>; readonly path: "merge" | "create" | null; readonly onPath: (p: "merge" | "create") => void;
}) {
  if (blocked) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft p-3">
        <XCircle className="size-5 text-danger" aria-hidden />
        <p className="text-[13px] font-semibold text-foreground">{blocked}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("flex items-center gap-3 rounded-lg border p-3", ready ? "border-success/30 bg-success-soft" : "border-danger/30 bg-danger-soft")}>
        {ready ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-danger" aria-hidden />}
        <p className="text-[14px] font-semibold text-foreground">
          {ready} of {total} order{total === 1 ? "" : "s"} {ready === 1 ? "is" : "are"} allocated and ready for a picking job
        </p>
      </div>
      <FailureList failed={failed} codes={codes} title="Not eligible" />
      {ready > 0 ? (
        <RadioCards<"merge" | "create">
          ariaLabel="How to continue"
          columns={2}
          chevron
          value={path}
          onChange={onPath}
          options={[
            { value: "merge", title: "Merge into existing job", description: "Add the orders to a pending picking job", icon: GitMerge },
            { value: "create", title: "Create new job", description: "Batch the orders into new picking jobs", icon: ListPlus },
          ]}
        />
      ) : null}
    </div>
  );
}

function FailureList({ failed, codes, title }: { readonly failed: readonly BulkFailure[]; readonly codes: ReadonlyMap<string, string>; readonly title: string }) {
  if (failed.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12px] font-semibold text-secondary">{title}</p>
      <ul className="ks-scroll max-h-40 divide-y divide-border overflow-auto rounded-md border border-border text-[12px]">
        {failed.map((r) => (
          <li key={r.id} className="flex gap-3 px-3 py-1.5">
            <span className="w-28 shrink-0 font-semibold text-foreground">{codes.get(r.id) ?? "Order"}</span>
            <span className="text-secondary">{r.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DryRunNote({ query, codes }: { readonly query: ReturnType<typeof useQuery<DryRun, ApiError>>; readonly codes: ReadonlyMap<string, string> }) {
  if (!query.isEnabled) return null;
  if (query.isPending) return <p className="flex items-center gap-2 text-[12px] text-secondary"><Spinner className="size-3" /> Checking the job type rules…</p>;
  if (query.error) return <p className="text-[12px] text-danger">{query.error.message}</p>;
  const d = query.data;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-secondary">
        <strong className="text-foreground">{d.eligible.length} of {d.total}</strong> order{d.total === 1 ? "" : "s"} match this job&apos;s rules.
      </p>
      <FailureList failed={d.ineligible} codes={codes} title="Excluded by the job rules" />
    </div>
  );
}

function MergeTable({ jobs, loading, selected, onSelect }: {
  readonly jobs: OrderJobOptions["mergeableJobs"]; readonly loading: boolean; readonly selected: string | null; readonly onSelect: (id: string) => void;
}) {
  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (jobs.length === 0) return <p className="py-10 text-center text-[13px] text-faint">No pending picking job in this warehouse. Go back and create a new job instead.</p>;
  return (
    <div role="radiogroup" aria-label="Job to merge into" className="ks-scroll max-h-72 overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
          <tr>
            <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Select</span></th>
            <th scope="col" className="px-3 py-2">Job code</th>
            <th scope="col" className="px-3 py-2">Type</th>
            <th scope="col" className="px-3 py-2 text-right">Orders</th>
            <th scope="col" className="px-3 py-2 text-right">Qty</th>
            <th scope="col" className="w-36 px-3 py-2">Progress</th>
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
              <td className="px-3 py-2 text-right tabular-nums">{j.orderCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">{j.unitCount}</td>
              <td className="px-3 py-2"><ProgressBar value={j.unitCount ? Math.round((j.completedUnits / j.unitCount) * 100) : 0} showValue label={`${j.code} progress`} /></td>
              <td className="px-3 py-2 text-secondary">{j.assigneeName ?? "Unassigned"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
