"use client";

/**
 * Job detail `/jobs/[id]` (KitStaks addition: Logiwa has no job page). Header with code, type,
 * status, priority, assignee, wave + rule, planned/actual dates and progress; the Job
 * Management actions; tabs Orders (remove from job) · Tasks (Execute / Update / Cancel) ·
 * Pick path (walking-path sequence) · Timeline (field-level change log).
 */
import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ExternalLink, FileQuestion, Footprints, MapPin, Sparkles, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SkeletonTable } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { UnderlineTabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { JobTimeline, useJobTimeline } from "./job-timeline";
import { Breadcrumbs } from "@/components/layout/page-header";
import { StatusScreen } from "@/components/layout/status-screen";
import { apiFetch, isApiError } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { usePermissionSet } from "@/components/jobs/use-permissions";
import { cn } from "@/lib/utils";
import type { getJobDetail } from "@/server/repositories/jobs";
import { TaskActions, type TaskFacts } from "@/components/tasks/task-actions";
import { JobPriorityPill, JobsStatusPill, OverduePill, ShortPill } from "./grid-columns";
import { SlowLoadNotice } from "@/components/layout/slow-load-notice";
import { progressTone } from "@/lib/grid-defs/jobs/progress-tone";
import { JOB_PERMS, JobActions, type JobFacts } from "./job-actions";
import { errorMessage, jobTasksHref } from "./jobs-client";

type Detail = Awaited<ReturnType<typeof getJobDetail>>;
type DetailTask = Detail["tasks"][number];
type DetailOrder = Detail["orders"][number];

const isOrderlessJob = (op: string): boolean => /count|replenish/i.test(op);
const TABS = ["orders", "tasks", "pick-path", "timeline"] as const;
type TabKey = (typeof TABS)[number];

function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{label}</dt>
      <dd className="truncate text-[13px] text-foreground">{children}</dd>
    </div>
  );
}

const dash = <span className="text-faint">—</span>;

function OrdersTab({ detail, onChanged }: { readonly detail: Detail; readonly onChanged: () => void }) {
  const { permissions } = usePermissionSet();
  const [removing, setRemoving] = React.useState<DetailOrder | null>(null);
  const closed = detail.job.status === "Completed" || detail.job.status === "Cancelled";
  if (detail.orders.length === 0) {
    const op = String(detail.job.operationType ?? "");
    const description = isOrderlessJob(op)
      ? `${op || "This"} jobs work on locations and stock, so they have tasks but no orders.`
      : detail.job.status === "Cancelled" ? "This job was cancelled before any order was added to it." : "No orders are in this job yet. Run a wave or add orders from Shipment Orders.";
    return <EmptyState compact title="No orders in this job" description={description} />;
  }
  return (
    <div className="overflow-auto rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className="bg-surface-sunken">
          <tr>
            {["Order code", "Status", "Customer", "Client", "Units", "Picked", "Packed", "Tasks", "Pick short", "Label", ""].map((h) => (
              <th key={h} scope="col" className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.orders.map((o) => {
            const started = o.startedTasks > 0 || o.completedTasks > 0 || Number(o.picked) > 0;
            const reason = o.released ? "This order was already released from the job" : closed ? `The job is ${String(detail.job.status).toLowerCase()}` : !permissions.has(JOB_PERMS.cancel) ? "You don't have permission to change jobs" : started ? (Number(o.picked) >= Number(o.units) && Number(o.units) > 0 ? "Picking is complete for this order. Cancel the job or unpick the units to release it." : "Picking already started for this order. Finish or cancel its tasks first.") : null;
            return (
              <tr key={o.id} className="border-b border-border last:border-b-0 hover:bg-surface-sunken/60">
                <td className="px-3 py-2"><Link className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(o.code)}`}>{o.code}</Link></td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><StatusPill status={o.status} domain="shipmentOrder" size="sm" />{o.released ? <span className="rounded-full bg-surface-sunken px-1.5 py-px text-[10px] font-semibold uppercase text-secondary" title="Released from this job; its tasks here were cancelled">Released</span> : null}</span></td>
                <td className="px-3 py-2">{o.customerName || dash}</td>
                <td className="px-3 py-2">{o.clientName || dash}</td>
                <td className="px-3 py-2 text-right tabular-nums">{o.units}</td>
                <td className="px-3 py-2 text-right tabular-nums">{o.picked}</td>
                <td className="px-3 py-2 text-right tabular-nums">{o.packed}</td>
                <td className="px-3 py-2 tabular-nums text-secondary">{o.completedTasks}/{o.pendingTasks + o.startedTasks + o.completedTasks}{o.cancelledTasks > 0 ? <span className="ml-1 text-faint">· {o.cancelledTasks} cancelled</span> : null}</td>
                <td className="px-3 py-2"><ShortPill value={o.pickShortStatus} /></td>
                <td className="px-3 py-2">{o.hasLabel ? <StatusPill status="Labeled" size="sm" /> : <span className="text-[12px] text-faint">No label</span>}</td>
                <td className="px-3 py-2 text-right">
                  <DisabledReason reason={reason}>
                    <Button variant="ghost" size="sm" disabled={Boolean(reason)} onClick={() => setRemoving(o)} aria-label={`Remove ${o.code} from the job`}>
                      <X className="h-3.5 w-3.5" aria-hidden />
                      Remove
                    </Button>
                  </DisabledReason>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => (o ? undefined : setRemoving(null))}
        variant="danger"
        title={`Remove ${removing?.code ?? "the order"} from ${detail.job.code}?`}
        description="Its pending tasks are cancelled. The order keeps its allocation and can be added to another job."
        cancelLabel="Keep order"
        confirmLabel="Remove from job"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await apiFetch(`/api/jobs/${encodeURIComponent(detail.job.id)}/orders/${encodeURIComponent(removing.id)}`, { method: "DELETE" });
            toast.success("Success", `${removing.code} removed from ${detail.job.code}`);
            onChanged();
          } catch (error) {
            toast.error("Couldn't remove the order", errorMessage(error));
          }
        }}
      />
    </div>
  );
}

function TasksTab({ detail, onChanged }: { readonly detail: Detail; readonly onChanged: () => void }) {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const facts = (t: DetailTask): TaskFacts => ({
    id: t.id, taskNo: t.taskNo, status: t.status, taskType: t.taskType, warehouseId: String(detail.job.warehouseId), assigneeUserId: t.assigneeUserId,
    plannedQty: t.plannedQty, actualQty: t.actualQty, sku: t.sku, sourceLocation: t.sourceLocation, jobId: String(detail.job.id), jobCode: String(detail.job.code),
  });
  const chosen = detail.tasks.filter((t) => selected.has(t.id)).map(facts);
  const toggle = (id: string, on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
  const all = detail.tasks.length > 0 && selected.size === detail.tasks.length;
  if (detail.tasks.length === 0) return <EmptyState compact title="No tasks" description="This job has no tasks yet." />;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-3 text-[12px] text-secondary">
          {selected.size > 0 ? `${selected.size} selected` : `${detail.tasks.length} tasks`}
          <Link className="inline-flex items-center gap-1 font-medium text-primary hover:underline" href={jobTasksHref(String(detail.job.code), String(detail.job.operationType))}>
            Open in Task Details
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        </span>
        <TaskActions tasks={chosen} onChanged={() => { setSelected(new Set()); onChanged(); }} />
      </div>
      <div className="overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="bg-surface-sunken">
            <tr>
              <th className="w-10 border-b border-border px-3 py-2"><Checkbox aria-label="Select all tasks" checked={all ? true : selected.size > 0 ? "indeterminate" : false} onCheckedChange={(c) => setSelected(c === true ? new Set(detail.tasks.map((t) => t.id)) : new Set())} /></th>
              {["Task ID", "Type", "Status", "Order", "SKU", "Source", "Target", "Planned", "Actual", "Pick short", "Assignee", "Executed by", "Finished"].map((h) => (
                <th key={h} scope="col" className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.tasks.map((t) => (
              <TaskRowView key={t.id} task={t} checked={selected.has(t.id)} onToggle={(on) => toggle(t.id, on)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaskRowView({ task: t, checked, onToggle }: { readonly task: DetailTask; readonly checked: boolean; readonly onToggle: (on: boolean) => void }) {
  const fmt = useFormat();
  return (
    <tr className={cn("border-b border-border last:border-b-0", checked ? "bg-primary-soft/60" : "hover:bg-surface-sunken/60")}>
      <td className="px-3 py-2"><Checkbox aria-label={`Select task ${t.taskNo}`} checked={checked} onCheckedChange={(c) => onToggle(c === true)} /></td>
      <td className="px-3 py-2 tabular-nums">{t.taskNo}</td>
      <td className="px-3 py-2">{t.taskType}</td>
      <td className="px-3 py-2"><JobsStatusPill status={t.status} domain="task" size="sm" /></td>
      <td className="px-3 py-2">{t.orderCode ? <Link className="text-primary hover:underline" href={`/orders/${encodeURIComponent(t.orderCode)}`}>{t.orderCode}</Link> : dash}</td>
      <td className="px-3 py-2"><span className="font-medium">{t.sku ?? "—"}</span><span className="block max-w-[200px] truncate text-[11px] text-faint">{t.productName}</span></td>
      <td className="px-3 py-2">{t.sourceLocation ?? "—"}{t.sourceLpn ? <span className="block text-[11px] text-faint">{t.sourceLpn}</span> : null}</td>
      <td className="px-3 py-2">{t.targetLocation ?? "—"}{t.targetLpn ? <span className="block text-[11px] text-faint">{t.targetLpn}</span> : null}</td>
      <td className="px-3 py-2 text-right tabular-nums">{t.plannedQty}</td>
      <td className="px-3 py-2 text-right tabular-nums">{t.actualQty}</td>
      <td className="px-3 py-2"><ShortPill value={t.pickShortStatus} /></td>
      <td className="px-3 py-2">{t.assignee ?? dash}</td>
      <td className="px-3 py-2">{t.executedBy ?? dash}</td>
      <td className="px-3 py-2 whitespace-nowrap text-secondary">{t.finishedAt ? fmt.gridDateTime(t.finishedAt) : "—"}</td>
    </tr>
  );
}

/**
 * Pick path: the job's source stops grouped by location, in walking-path order, or for AI jobs in
 * the AI-optimized task sequence (tasks arrive sorted by sequence).
 */
export function pickPathStops(tasks: readonly DetailTask[], bySequence = false) {
  const pick = tasks.filter((t) => t.status !== "Cancelled" && (t.taskType === "Picking" || t.taskType === "Replenishment" || t.taskType === "Count" || t.taskType === "Kitting"));
  const stops = new Map<string, { location: string; zone: string | null; aisle: string | null; walk: number | null; lines: DetailTask[] }>();
  for (const t of pick) {
    const key = t.sourceLocation ?? "Unassigned";
    const stop = stops.get(key) ?? { location: key, zone: t.zone, aisle: t.aisle, walk: t.walkingPathPriority, lines: [] };
    stop.lines.push(t);
    stops.set(key, stop);
  }
  if (bySequence) return [...stops.values()];
  return [...stops.values()].sort((a, b) => (a.walk ?? Number.MAX_SAFE_INTEGER) - (b.walk ?? Number.MAX_SAFE_INTEGER) || a.location.localeCompare(b.location));
}

function PickPathTab({ detail }: { readonly detail: Detail }) {
  const stops = pickPathStops(detail.tasks, Boolean(detail.ai));
  if (stops.length === 0) return <EmptyState compact icon={Footprints} title="No pick path" description="This job has no picking, count or replenishment stops." />;
  return (
    <div className="flex flex-col gap-4">
    {detail.ai ? (
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-[#D9CCF5] bg-[#F5F0FF] px-4 py-3 text-[13px] dark:border-[#4B3B78] dark:bg-[#211A33]">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#5B3DB5] dark:text-[#C7B5FF]"><Sparkles className="h-4 w-4" aria-hidden />AI-optimized route</span>
        <span className="text-body"><span className="font-semibold tabular-nums">{detail.ai.stops}</span> {detail.ai.stops === 1 ? "stop" : "stops"}</span>
        <span className="text-body"><span className="font-semibold tabular-nums">{Math.round(detail.ai.optimizedM)} m</span> walk</span>
        <span className="text-secondary">Walking-path order: <span className="tabular-nums">{Math.round(detail.ai.baselineM)} m</span></span>
        <span className={detail.ai.savingsPct > 0 ? "font-semibold text-success" : "text-secondary"}>{detail.ai.savingsPct > 0 ? `−${detail.ai.savingsPct}% walking distance` : "Already the shortest route"}</span>
      </div>
    ) : null}
    <ol className="relative ml-3 flex flex-col gap-3 border-l-2 border-dashed border-border pl-6">
      {stops.map((s, i) => {
        const done = s.lines.every((l) => l.status === "Completed");
        const units = s.lines.reduce((n, l) => n + l.plannedQty, 0);
        return (
          <li key={s.location} className="relative">
            <span className={cn("absolute -left-[37px] top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-bold", done ? "border-[#17874D] bg-[#D3F0E3] text-success" : "border-primary bg-surface text-primary")}>{i + 1}</span>
            <div className={cn("rounded-lg border bg-surface px-4 py-3", done ? "border-border opacity-70" : "border-border shadow-sm")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[14px] font-semibold text-foreground"><MapPin className="h-4 w-4 text-primary" aria-hidden />{s.location}</span>
                <span className="text-[12px] text-secondary">{[s.zone && `Zone ${s.zone}`, s.aisle && `Aisle ${s.aisle}`, s.walk !== null && s.walk > 0 && `Walk #${s.walk}`].filter(Boolean).join(" · ") || "No walking path set"}</span>
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {s.lines.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="min-w-0 truncate"><span className="font-semibold text-foreground">{l.sku ?? "—"}</span> <span className="text-secondary">{l.productName}</span>{l.orderCode ? <span className="text-faint"> · {l.orderCode}</span> : null}</span>
                    <span className="flex shrink-0 items-center gap-2"><span className="tabular-nums">{l.actualQty}/{l.plannedQty}</span><JobsStatusPill status={l.status} domain="task" size="sm" /></span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-faint">{units} {units === 1 ? "unit" : "units"} at this stop</p>
            </div>
          </li>
        );
      })}
    </ol>
    </div>
  );
}

function Header({ detail, onChanged }: { readonly detail: Detail; readonly onChanged: () => void }) {
  const fmt = useFormat();
  const j = detail.job;
  const dt = (v: unknown) => (v ? fmt.gridDateTime(String(v)) : "—");
  const facts: JobFacts = {
    id: j.id, code: String(j.code), status: String(j.status), warehouseId: j.warehouseId, assignedToUserId: j.assignedToUserId, hasPickShort: j.hasPickShort,
    mobileCartId: j.mobileCartId, operationType: String(j.operationType), jobType: String(j.jobType), priority: String(j.priority),
  };
  const pct = detail.progress.percent;
  const overdue = Boolean(Number(j.overdue));
  return (
    <div className="px-6 pt-3">
      <Breadcrumbs items={[{ label: "Fulfillment" }, { label: "Jobs", href: "/jobs" }, { label: "Job Management", href: "/jobs" }, { label: String(j.code) }]} />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/jobs" className="rounded p-1 text-secondary hover:bg-surface-sunken" aria-label="Back to jobs"><ArrowLeft className="h-4 w-4" aria-hidden /></Link>
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">{String(j.code)}</h1>
            <JobsStatusPill status={String(j.status)} domain="job" />
            <span className="inline-flex items-center gap-1 text-[12px] text-secondary">Priority <JobPriorityPill priority={j.priority} /></span>
            {detail.ai ? <span className="inline-flex items-center gap-1 rounded-full bg-[#EFE8FF] px-2 py-0.5 text-[11px] font-semibold text-[#5B3DB5] dark:bg-[#2C2245] dark:text-[#C7B5FF]" title={detail.ai.description}><Sparkles className="h-3 w-3" aria-hidden />AI job</span> : null}
            {Number(j.hasPickShort) ? <span className="inline-flex items-center gap-1 rounded-full bg-[#F7E9E4] px-2 py-0.5 text-[11px] font-semibold text-[#A13406]"><AlertTriangle className="h-3 w-3" aria-hidden />Pick short</span> : null}
            {overdue ? <OverduePill title={`Planned to finish by ${dt(j.plannedEndAt)}`} /> : null}
          </div>
          <p className="text-[13px] text-secondary">{String(j.jobType)}{j.originalJobType ? ` (from ${String(j.originalJobType)})` : ""} · {String(j.operationType)} · {String(j.warehouse ?? "")}{j.client ? ` · ${String(j.client)}` : ""}</p>
        </div>
        <JobActions jobs={[facts]} onChanged={onChanged} compact />
      </div>
      <div className="mt-3 grid gap-4 rounded-lg border border-border bg-surface px-4 py-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Fact label="Assignee">{j.assignee ? String(j.assignee) : <span className="text-secondary">Job pool</span>}</Fact>
          {detail.countPlan ? <Fact label="Count plan"><Link className="text-primary hover:underline" href={`/counts/${encodeURIComponent(detail.countPlan.code)}`}>{detail.countPlan.code}</Link></Fact> : <Fact label="Wave">{detail.wave ? <Link className="text-primary hover:underline" href={`/jobs/wave-log?q=${encodeURIComponent(detail.wave.waveNo)}&qm=eq`}>{detail.wave.waveNo}</Link> : "Manual allocation"}</Fact>}
          <Fact label="Wave rule">{detail.rule ? <Link className="text-primary hover:underline" href={`/jobs/wave-rules?q=${encodeURIComponent(detail.rule.name)}&qm=eq`}>{detail.rule.name}</Link> : "—"}</Fact>
          <Fact label="Mobile cart">{j.mobileCart ? String(j.mobileCart) : "—"}</Fact>
          <Fact label="Planned start">{dt(j.plannedStartAt)}</Fact>
          <Fact label="Planned end">{overdue ? <span className="font-semibold text-[#B42318] dark:text-[#F7A99C]">{dt(j.plannedEndAt)} · overdue</span> : dt(j.plannedEndAt)}</Fact>
          <Fact label="Actual start">{dt(j.startedAt)}</Fact>
          <Fact label="Actual finish">{dt(j.completedAt)}</Fact>
          <Fact label="Created">{dt(j.createdAt)} · {String(j.createdBy ?? "Integration")}</Fact>
          {isOrderlessJob(String(j.operationType)) ? null : <Fact label="Label status">{String(j.labelStatus ?? "—")}</Fact>}
          {isOrderlessJob(String(j.operationType)) ? null : <Fact label="Pick list">{String(j.pickListStatus ?? "—")}</Fact>}
          <Fact label="Orders · SKUs">{Number(j.orderCount)} · {Number(j.productCount)}{detail.history.releasedOrderCount > 0 && j.status !== "Cancelled" ? <span className="ml-1 text-[12px] font-normal text-faint">({detail.history.releasedOrderCount} released)</span> : null}</Fact>
        </dl>
        <div className="flex flex-col justify-center gap-2 border-t border-border pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">Progress</span>
            <span className="text-[20px] font-semibold tabular-nums text-foreground">{pct}%</span>
          </div>
          <ProgressBar value={pct} tone={progressTone({ percent: pct, status: String(j.status), hasPickShort: Boolean(Number(j.hasPickShort)), overdue })} label="Job progress" />
          <span className="text-[12px] text-secondary">{detail.progress.completedTaskCount} of {detail.history.liveTaskCount} tasks complete{detail.history.cancelledTaskCount > 0 ? ` · ${detail.history.cancelledTaskCount} cancelled` : ""}</span>
          {detail.phases.length > 0 ? (
            <ul className="flex flex-col gap-1" aria-label="Progress by task type">
              {detail.phases.map((p) => (
                <li key={p.phase} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-secondary">{p.phase}</span>
                  <span className="tabular-nums text-foreground">
                    {p.completedTasks}/{p.taskCount} tasks · {p.actualUnits}/{p.plannedUnits} units
                    {p.pendingTasks + p.startedTasks > 0 ? <span className="ml-1.5 rounded-full bg-surface-sunken px-1.5 py-px text-[10px] font-semibold uppercase text-secondary">{p.pendingTasks + p.startedTasks} pending</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function JobDetailPage({ id }: { readonly id: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const tabParam = params.get("tab");
  const urlTab: TabKey | null = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as TabKey) : null;
  // Client-side tab state; the URL is kept in sync with a shallow history update (no RSC round trip).
  const [tabState, setTabState] = React.useState<TabKey | null>(urlTab);
  React.useEffect(() => { setTabState(urlTab); }, [urlTab]);
  // Critic R5: never an endless skeleton — slow notice at 6 s, TIMEOUT error + Retry at 30 s.
  const query = useApiQuery<Detail>(["job", id], `/api/jobs/${encodeURIComponent(id)}`, { retry: false, timeoutMs: 30_000 });
  // Prefetch the Timeline tab with the page so switching to it is instant.
  useJobTimeline(query.data?.data.job.id ?? null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["job", id] });
    void qc.invalidateQueries({ queryKey: ["change-log", "job", id] });
    void qc.invalidateQueries({ queryKey: ["grid"] });
  };

  if (query.isPending) return <div className="flex flex-col gap-3 p-6"><SlowLoadNotice failMs={3_600_000} /><SkeletonTable rows={6} columns={6} /></div>;
  if (query.error) {
    const notFound = isApiError(query.error) && (query.error.status === 404 || query.error.code === "NOT_FOUND");
    return (
      <StatusScreen
        code={notFound ? "404" : undefined}
        icon={FileQuestion}
        tone={notFound ? "neutral" : "danger"}
        title={notFound ? "Job not found" : "Couldn't load the job"}
        description={notFound ? "It may have been removed, or it belongs to a warehouse you can't access." : errorMessage(query.error)}
        actions={notFound ? <Link className="text-primary hover:underline" href="/jobs">Back to jobs</Link> : <Button onClick={() => void query.refetch()}>Retry</Button>}
      />
    );
  }
  const detail = query.data.data;
  // Count / replenishment jobs carry no orders: open them on Tasks.
  const tab: TabKey = tabState ?? (isOrderlessJob(String(detail.job.operationType)) ? "tasks" : "orders");
  const setTab = (key: string) => {
    if (!(TABS as readonly string[]).includes(key)) return;
    setTabState(key as TabKey);
    const next = new URLSearchParams(window.location.search);
    next.set("tab", key);
    window.history.replaceState(window.history.state, "", `${pathname}?${next.toString()}`);
  };
  return (
    <div className="flex min-h-0 flex-col pb-8">
      <Header detail={detail} onChanged={refresh} />
      <UnderlineTabs
        className="mt-4"
        ariaLabel="Job sections"
        active={tab}
        onChange={setTab}
        tabs={[
          ...(isOrderlessJob(String(detail.job.operationType)) && detail.orders.length === 0 ? [] : [{ key: "orders" as const, label: "Orders", count: detail.orders.length }]),
          { key: "tasks", label: "Tasks", count: detail.tasks.length },
          { key: "pick-path", label: "Pick path" },
          { key: "timeline", label: "Timeline" },
        ]}
      />
      <div className="px-6 pt-4">
        {tab === "orders" ? <OrdersTab detail={detail} onChanged={refresh} /> : null}
        {tab === "tasks" ? <TasksTab detail={detail} onChanged={refresh} /> : null}
        {tab === "pick-path" ? <PickPathTab detail={detail} /> : null}
        {tab === "timeline" ? <JobTimeline jobId={detail.job.id} /> : null}
      </div>
    </div>
  );
}
