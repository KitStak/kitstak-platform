"use client";

/**
 * Count detail (`/counts/[id]`, KitStaks addition; `id` = plan id or code). Header with
 * status, lock badge and plan actions; KPI band (lines, counted, variance, accuracy);
 * tabs: Lines (system / counted / % difference / recount flags, expandable per-bucket
 * entries, line Update Inv. / Create Recount / Cancel), Count sheet (web entry), Jobs,
 * Timeline (change log + ledger Count transactions).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { Ban, ClipboardCheck, ClipboardList, FileSearch, History, Lock, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { DataGrid } from "@/components/grid";
import { DateCell, LinkCell } from "@/components/grid/cells";
import { HomeLink, StatusScreen } from "@/components/layout/status-screen";
import { ActivityTimeline, ChangeLogDrawer, DetailHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { UnderlineTabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { COUNT_EXECUTE_PERMISSIONS, COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import {
  firstReason, LOCKING_PLAN_STATUSES, lineCancelReason, lineHoldsLock, lineRecountReason, lineUpdateInvReason, percentDifference,
  planCancelReason, planCreateJobReason, planDeleteReason, planEditReason, planUpdateInvReason,
} from "@/lib/grid-defs/counts/count-math";
import type { CountLineListRow, CountPlanListRow } from "@/lib/grid-defs/counts/count-rows";
import { DeltaBadge, DifferenceBadge } from "./count-badges";
import { RecountDialog, UpdateInventoryDialog } from "./count-dialogs";
import { CountPlanDrawer } from "./count-plan-drawer";
import { CountSheet } from "./count-sheet";
import { buildLineColumns } from "./counts-columns";
import { errorMessage, runBulkCommand, useRefreshCounts, useCountCan } from "./counts-client";
import { CreateCountJobModal } from "./create-count-job-modal";

interface EntryRow {
  readonly id: string; readonly lineId: string; readonly sku: string; readonly productName: string; readonly locationCode: string;
  readonly lpNumber: string | null; readonly lotNumber: string | null; readonly expiryDate: string | null; readonly packType: string;
  readonly systemQty: number; readonly countedQty: number; readonly countedBy: string | null; readonly countedAt: string;
}
interface JobRow { readonly id: string; readonly code: string; readonly jobType: string; readonly status: string; readonly assigneeName: string | null; readonly taskCount: number; readonly completedTaskCount: number; readonly createdAt: string }
interface Detail {
  readonly plan: CountPlanListRow; readonly lines: readonly CountLineListRow[]; readonly entries: readonly EntryRow[]; readonly jobs: readonly JobRow[];
  readonly mandatoryCountReason: boolean;
}

const TABS = ["lines", "sheet", "jobs", "timeline"] as const;
type Tab = (typeof TABS)[number];
type Dialog = { kind: "cancel" | "delete" | "update" | "job" | "edit" | "line-update" | "line-recount" | "line-cancel"; lineIds?: readonly string[] } | null;

export function CountDetailPage({ id }: { readonly id: string }) {
  const detail = useApiQuery<Detail>(["count-plan", id], `/api/counts/${encodeURIComponent(id)}`);
  if (detail.isPending) {
    return (
      <div className="flex flex-col gap-4 px-6 pt-5">
        <Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (detail.error) {
    if (detail.error.code === "NOT_FOUND") {
      return <StatusScreen code="404" icon={FileSearch} title="Count plan not found" description={<>No count plan <strong>{id}</strong> exists in the warehouses you can access.</>} actions={<><Link href="/counts" className="font-semibold text-primary hover:underline">Back to count plans</Link><HomeLink /></>} />;
    }
    if (detail.error.code === "FORBIDDEN") {
      return <StatusScreen code="403" tone="danger" icon={Lock} title="You can't view count plans" description="Ask an administrator for the Count Plans permission." actions={<HomeLink />} />;
    }
    return <div className="p-6"><Callout variant="error" title="The count plan could not be loaded" action={<Button size="sm" variant="secondary" onClick={() => void detail.refetch()}>Retry</Button>}>{detail.error.message}</Callout></div>;
  }
  return <Loaded data={detail.data.data} refetch={() => void detail.refetch()} />;
}

function Loaded({ data, refetch }: { readonly data: Detail; readonly refetch: () => void }) {
  const { plan, lines, entries, jobs } = data;
  const router = useRouter();
  const search = useSearchParams();
  const fmt = useFormat();
  const refresh = useRefreshCounts();
  const tabParam = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "lines";
  const setTab = (t: string) => {
    const params = new URLSearchParams(search.toString());
    if (t === "lines") params.delete("tab"); else params.set("tab", t);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const can = {
    edit: useCountCan(P.edit).allowed, del: useCountCan(P.delete).allowed, cancel: useCountCan(P.cancel).allowed, update: useCountCan(P.updateInv).allowed, job: useCountCan(P.createJob).allowed,
    lineUpdate: useCountCan([P.locUpdateInv, P.skuUpdateInv, P.updateInv], "any").allowed, recount: useCountCan([P.locRecount, P.skuRecount], "any").allowed,
    lineCancel: useCountCan([P.locCancel, P.skuCancel], "any").allowed, execute: useCountCan(COUNT_EXECUTE_PERMISSIONS, "any").allowed,
  };
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [log, setLog] = React.useState(false);
  const selectedLines = lines.filter((l) => selection[l.id]);

  const done = async () => { setSelection({}); await refresh(); refetch(); };

  const locked = plan.lockLocations && (LOCKING_PLAN_STATUSES as readonly string[]).includes(plan.status);
  const counted = lines.filter((l) => l.countedQty !== null);
  const active = lines.filter((l) => l.status !== "Cancelled" && l.status !== "Recount Created");
  const liveLineIds = new Set(lines.filter((l) => l.status !== "Cancelled" && l.status !== "Recount Created").map((l) => l.id));
  const liveEntries = entries.filter((e) => liveLineIds.has(e.lineId));
  const varianceUnits = liveEntries.reduce((s, e) => s + (e.countedQty - e.systemQty), 0);
  const lockedLocationCount = new Set(lines.filter((l) => lineHoldsLock(plan.lockLocations, plan.status, l.status) && l.locationCode).map((l) => l.locationCode)).size;
  const systemTotal = counted.filter((l) => l.status !== "Recount Created").reduce((s, l) => s + (l.approvedStockQty ?? l.initialStockQty), 0);
  const countedTotal = counted.filter((l) => l.status !== "Recount Created").reduce((s, l) => s + (l.countedQty ?? 0), 0);
  const accuracyLines = counted.filter((l) => l.status !== "Recount Created");
  const exact = accuracyLines.filter((l) => (l.difference ?? 0) === 0).length;

  const lineColumns = React.useMemo(() => buildLineColumns("plan"), []);
  const entriesByLine = React.useMemo(() => {
    const m = new Map<string, EntryRow[]>();
    for (const e of entries) m.set(e.lineId, [...(m.get(e.lineId) ?? []), e]);
    return m;
  }, [entries]);

  const reasons = {
    edit: planEditReason(plan.status), del: planDeleteReason(plan.status) ?? (jobs.length ? "This count plan has jobs; cancel it instead" : null),
    cancel: planCancelReason(plan.status), update: planUpdateInvReason(plan.status, plan.countedLineCount), job: planCreateJobReason(plan.status),
  };
  const none = selectedLines.length === 0 ? "Select at least one line" : null;
  const lineReasons = {
    update: none ?? firstReason(selectedLines, (l) => lineUpdateInvReason(l.status)),
    recount: none ?? firstReason(selectedLines, (l) => lineRecountReason(l.status)),
    cancel: none ?? firstReason(selectedLines, (l) => lineCancelReason(l.status)),
  };

  const runDelete = async () => {
    try {
      await apiFetch(`/api/counts/${encodeURIComponent(plan.id)}`, { method: "DELETE", query: { version: plan.version } });
      toast.success("Success", `Count plan ${plan.code} is deleted.`);
      await refresh();
      router.push("/counts");
    } catch (error) {
      toast.error("Error", errorMessage(error));
    }
  };

  const headerActions = (
    <>
      <Button variant="ghost" onClick={() => setLog(true)}><History className="h-3.5 w-3.5" aria-hidden />Change log</Button>
      {can.edit ? <DisabledReason reason={reasons.edit}><Button variant="secondary" disabled={Boolean(reasons.edit)} onClick={() => setDialog({ kind: "edit" })}><Pencil className="h-3.5 w-3.5" aria-hidden />Edit</Button></DisabledReason> : null}
      {can.del ? <DisabledReason reason={reasons.del}><Button variant="secondary" disabled={Boolean(reasons.del)} onClick={() => setDialog({ kind: "delete" })}><Trash2 className="h-3.5 w-3.5" aria-hidden />Delete</Button></DisabledReason> : null}
      {can.cancel ? <DisabledReason reason={reasons.cancel}><Button variant="secondary" disabled={Boolean(reasons.cancel)} onClick={() => setDialog({ kind: "cancel" })}><Ban className="h-3.5 w-3.5" aria-hidden />Cancel</Button></DisabledReason> : null}
      {can.job && plan.status === "Pending" ? <Button variant="primary" onClick={() => setDialog({ kind: "job" })}><ClipboardList className="h-3.5 w-3.5" aria-hidden />Create Job</Button> : null}
      {can.update && plan.status !== "Pending" ? <DisabledReason reason={reasons.update}><Button variant="primary" disabled={Boolean(reasons.update)} onClick={() => setDialog({ kind: "update" })}><ClipboardCheck className="h-3.5 w-3.5" aria-hidden />Update Inv.</Button></DisabledReason> : null}
    </>
  );

  const meta = (
    <>
      <span>Warehouse <strong className="text-foreground">{plan.warehouseCode}</strong></span>
      <span>{plan.countType} count · {plan.operationType}</span>
      <span>Scheduled {fmt.dateTime(plan.scheduledAt)}</span>
      <span>Created by {plan.createdByName ?? "System"} on {fmt.dateTime(plan.createdAt)}</span>
      {plan.inventoryUpdatedAt ? <span>Inventory updated {fmt.dateTime(plan.inventoryUpdatedAt)} by {plan.inventoryUpdatedByName ?? "System"}</span> : null}
    </>
  );

  const tabs = [
    { key: "lines", label: "Lines", count: lines.length },
    { key: "sheet", label: "Count sheet", count: lines.filter((l) => l.status === "Ready To Count" || l.status === "Count Started").length },
    { key: "jobs", label: "Jobs", count: jobs.length },
    { key: "timeline", label: "Timeline" },
  ];

  return (
    <div className="flex min-h-0 flex-col pb-8">
      <DetailHeader title={plan.code} backHref="/counts" backLabel="Count plans" status={plan.status} statusDomain="count" meta={meta} actions={headerActions}
        badges={locked ? <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning"><Lock className="h-3 w-3" aria-hidden />Locations locked</span> : null} />
      {plan.description ? <p className="-mt-2 px-6 pb-3 text-[13px] text-secondary">{plan.description}</p> : null}
      {locked ? (
        <div className="px-6 pb-3">
          <Callout variant="attention" title="Stock in these locations is frozen">Transfers, picks and putaways in or out of {lockedLocationCount ? <>the {lockedLocationCount} counted {lockedLocationCount === 1 ? "location" : "locations"}</> : "the locations that hold the counted SKUs"} are blocked until the count is cancelled or inventory is updated.</Callout>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 px-6 pb-4 lg:grid-cols-5">
        <StatTile label="Lines" value={active.length.toLocaleString()} sublabel={`${plan.locationCount} locations · ${plan.skuCount} SKUs`} />
        <StatTile label="Counted" value={`${accuracyLines.length} / ${active.length}`} sublabel={active.length ? `${Math.round((accuracyLines.length / active.length) * 100)}% complete` : "Nothing to count"} tone="primary" />
        <StatTile label="Counted vs system" value={<span className="flex items-center gap-2">{countedTotal.toLocaleString()}<span className="text-[13px] font-normal text-secondary">/ {systemTotal.toLocaleString()}</span></span>} sublabel={<DifferenceBadge value={accuracyLines.length ? percentDifference(systemTotal, countedTotal) : null} />} />
        <StatTile label="Unit variance" value={<DeltaBadge value={varianceUnits} />} sublabel={`${liveEntries.filter((e) => e.countedQty !== e.systemQty).length} buckets differ`} tone={varianceUnits === 0 ? "success" : "warning"} />
        <StatTile label="Exact lines" value={accuracyLines.length ? `${Math.round((exact / accuracyLines.length) * 100)}%` : "—"} sublabel={`${exact} of ${accuracyLines.length} counted lines match`} tone={accuracyLines.length && exact === accuracyLines.length ? "success" : "default"} />
      </div>
      <UnderlineTabs tabs={tabs} active={tab} onChange={setTab} className="px-6" ariaLabel="Count sections" />
      <div className="px-6 pt-4">
        {tab === "lines" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-secondary">{selectedLines.length ? <><strong className="text-foreground">{selectedLines.length}</strong> selected</> : "Select lines to update inventory, recount or cancel them. Expand a line to see each counted bucket."}</p>
              <div className="flex flex-wrap items-center gap-2">
                {can.lineCancel ? <DisabledReason reason={lineReasons.cancel}><Button size="sm" variant="secondary" disabled={Boolean(lineReasons.cancel)} onClick={() => setDialog({ kind: "line-cancel", lineIds: selectedLines.map((l) => l.id) })}><Ban className="h-3.5 w-3.5" aria-hidden />Cancel</Button></DisabledReason> : null}
                {can.recount ? <DisabledReason reason={lineReasons.recount}><Button size="sm" variant="secondary" disabled={Boolean(lineReasons.recount)} onClick={() => setDialog({ kind: "line-recount", lineIds: selectedLines.map((l) => l.id) })}><RotateCcw className="h-3.5 w-3.5" aria-hidden />Create Recount</Button></DisabledReason> : null}
                {can.lineUpdate ? <DisabledReason reason={lineReasons.update}><Button size="sm" variant="primary" disabled={Boolean(lineReasons.update)} onClick={() => setDialog({ kind: "line-update", lineIds: selectedLines.map((l) => l.id) })}><ClipboardCheck className="h-3.5 w-3.5" aria-hidden />Update Inv.</Button></DisabledReason> : null}
              </div>
            </div>
            <div className="flex h-[min(60vh,640px)] min-h-[320px] flex-col rounded-lg border border-border">
              <DataGrid<CountLineListRow>
                columns={lineColumns} data={[...lines]} total={lines.length} page={1} pageSize={Math.max(100, lines.length)} onPageChange={() => undefined}
                getRowId={(l) => l.id} selection={selection} onSelectionChange={setSelection} exportName={`${plan.code}-lines`}
                renderExpanded={(l) => <EntriesTable entries={entriesByLine.get(l.id) ?? []} />}
                emptyTitle="This plan has no lines" emptyDescription="Edit the plan to add locations or SKUs."
              />
            </div>
          </div>
        ) : null}
        {tab === "sheet" ? (
          <CountSheet planId={plan.id} planCode={plan.code} planStatus={plan.status} warehouseId={plan.warehouseId} canExecute={can.execute} onSubmitted={() => void done()} onCreateJob={can.job ? () => setDialog({ kind: "job" }) : undefined} />
        ) : null}
        {tab === "jobs" ? <JobsTable jobs={jobs} /> : null}
        {tab === "timeline" ? <ActivityTimeline entityType="count_plan" entityId={plan.id} ledgerPath={`/api/counts/${encodeURIComponent(plan.id)}/ledger`} /> : null}
      </div>

      <ConfirmDialog open={dialog?.kind === "cancel"} onOpenChange={(o) => !o && setDialog(null)} variant="danger" icon={Ban}
        title={`Cancel count plan ${plan.code}?`} description={`Open lines and pending count tasks are cancelled; counted lines that were not posted are discarded.${plan.lockLocations ? " Its locked locations unlock right away." : ""}`}
        confirmLabel="Yes" cancelLabel="No" onConfirm={async () => { await runBulkCommand("/api/counts/cancel", { ids: [plan.id] }, "count plan", "cancelled"); await done(); }} />
      <ConfirmDialog open={dialog?.kind === "delete"} onOpenChange={(o) => !o && setDialog(null)} variant="danger"
        title={`Delete count plan ${plan.code}?`} description="The plan and its lines are removed. This action cannot be undone." confirmLabel="Yes" cancelLabel="No" onConfirm={runDelete} />
      <ConfirmDialog open={dialog?.kind === "line-cancel"} onOpenChange={(o) => !o && setDialog(null)} variant="danger" icon={Ban}
        title={`Cancel ${dialog?.lineIds?.length ?? 0} count ${dialog?.lineIds?.length === 1 ? "line" : "lines"}?`} description="Their pending count tasks are cancelled. The plan is cancelled when no line is left."
        records={{ columns: [{ key: "line", label: "Line" }, { key: "status", label: "Status" }], rows: lines.filter((l) => dialog?.lineIds?.includes(l.id)).map((l) => ({ line: [l.locationCode, l.sku].filter(Boolean).join(" · "), status: <StatusPill status={l.status} domain="count" size="sm" /> })) }}
        confirmLabel="Yes" cancelLabel="No" onConfirm={async () => { await runBulkCommand("/api/counts/lines/cancel", { ids: dialog?.lineIds ?? [] }, "count line", "cancelled"); await done(); }} />
      <UpdateInventoryDialog open={dialog?.kind === "update"} onOpenChange={(o) => !o && setDialog(null)} level="plan" ids={[plan.id]} onDone={() => void done()} />
      <UpdateInventoryDialog open={dialog?.kind === "line-update"} onOpenChange={(o) => !o && setDialog(null)} level="line" ids={dialog?.lineIds ?? []} onDone={() => void done()} />
      <RecountDialog open={dialog?.kind === "line-recount"} onOpenChange={(o) => !o && setDialog(null)} onDone={() => void done()}
        lines={lines.filter((l) => dialog?.lineIds?.includes(l.id)).map((l) => ({ id: l.id, label: [l.locationCode, l.sku].filter(Boolean).join(" · "), planCode: plan.code, countedQty: l.countedQty, systemQty: l.approvedStockQty ?? l.initialStockQty, warehouseId: plan.warehouseId }))} />
      <CreateCountJobModal open={dialog?.kind === "job"} onOpenChange={(o) => !o && setDialog(null)} plans={[plan]} onDone={() => void done()} />
      <CountPlanDrawer open={dialog?.kind === "edit"} onOpenChange={(o) => !o && setDialog(null)} mode="edit" planId={plan.id} onSaved={() => void done()} />
      {log ? <ChangeLogDrawer open onOpenChange={setLog} entityType="count_plan" entityId={plan.id} entityCode={plan.code} /> : null}
    </div>
  );
}

function EntriesTable({ entries }: { readonly entries: readonly EntryRow[] }) {
  if (entries.length === 0) return <p className="px-4 py-3 text-[12px] text-secondary">Not counted yet.</p>;
  return (
    <div className="px-4 py-2">
      <table className="w-full max-w-[880px] border-collapse text-[12px]">
        <thead className="text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
          <tr><th className="py-1 pr-3">SKU</th><th className="py-1 pr-3">Location</th><th className="py-1 pr-3">Lot / LP</th><th className="py-1 pr-3 text-right">System</th><th className="py-1 pr-3 text-right">Counted</th><th className="py-1 pr-3 text-right">Diff</th><th className="py-1 pr-3">Counted by</th><th className="py-1">At</th></tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-border">
              <td className="py-1 pr-3 font-semibold text-foreground" title={e.productName}>{e.sku}</td>
              <td className="py-1 pr-3">{e.locationCode}</td>
              <td className="py-1 pr-3 text-secondary">{[e.lotNumber, e.lpNumber].filter(Boolean).join(" · ") || "—"}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{e.systemQty}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{e.countedQty}</td>
              <td className="py-1 pr-3 text-right"><DeltaBadge value={e.countedQty - e.systemQty} /></td>
              <td className="py-1 pr-3">{e.countedBy ?? "—"}</td>
              <td className="py-1"><DateCell value={e.countedAt} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobsTable({ jobs }: { readonly jobs: readonly JobRow[] }) {
  if (jobs.length === 0) {
    return <div className="rounded-lg border border-dashed border-border-strong px-6 py-10 text-center text-[13px] text-secondary">No jobs yet. Create Job splits a pending plan into Count jobs by location batch.</div>;
  }
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[13px]">
        <thead className="bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
          <tr><th className="px-3 py-2">Job code</th><th className="px-3 py-2">Job type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Assignee</th><th className="px-3 py-2">Tasks</th><th className="px-3 py-2">Created</th></tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-t border-border">
              <td className="px-3 py-2"><LinkCell href={`/jobs/${encodeURIComponent(j.id)}`}>{j.code}</LinkCell></td>
              <td className="px-3 py-2">{j.jobType}</td>
              <td className="px-3 py-2"><StatusPill status={j.status} domain="job" size="sm" /></td>
              <td className="px-3 py-2">{j.assigneeName ?? <span className="text-faint">Job pool</span>}</td>
              <td className="px-3 py-2 tabular-nums">{j.completedTaskCount} / {j.taskCount}</td>
              <td className="px-3 py-2"><DateCell value={j.createdAt} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
