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
import { Ban, ChevronDown, ClipboardCheck, ClipboardList, Eye, FileSearch, History, Lock, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataGrid } from "@/components/grid/data-grid";
import { DateCell, LinkCell } from "@/components/grid/cells";
import { HomeLink, StatusScreen } from "@/components/layout/status-screen";
import { ChangeLogDrawer } from "@/components/shared/change-log-drawer";
import { DetailHeader } from "@/components/shared/detail-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatTile } from "@/components/ui/stat-tile";
import { CountStatusPill } from "./count-status-pill";
import { UnderlineTabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { DisabledReason, Tooltip } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { COUNT_EXECUTE_PERMISSIONS, COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import {
  firstReason, LOCKING_PLAN_STATUSES, orphanedLinesMessage, lineCancelReason, lineHoldsLock, lineRecountReason, lineUpdateInvReason, percentDifference,
  planCancelReason, planCreateJobReason, planDeleteReason, planEditReason, planUpdateInvReason,
} from "@/lib/grid-defs/counts/count-math";
import type { CountLineListRow, CountPlanListRow } from "@/lib/grid-defs/counts/count-rows";
import { DeltaBadge, DifferenceBadge } from "./count-badges";
import { assertCancelReason, CancelReasonField, RecountDialog, UpdateInventoryDialog } from "./count-dialogs";
import { CountPlanDrawer } from "./count-plan-drawer";
import { CountSheet } from "./count-sheet";
import { CountTimeline } from "./count-timeline";
import { buildLineColumns } from "./counts-columns";
import { errorMessage, runBulkCommand, useRefreshCounts, useCountCan, COUNT_QUERY_TIMEOUT_MS } from "./counts-client";
import { CreateCountJobModal } from "./create-count-job-modal";

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

interface EntryRow {
  readonly id: string; readonly lineId: string; readonly sku: string; readonly productName: string; readonly locationCode: string;
  readonly lpNumber: string | null; readonly lotNumber: string | null; readonly expiryDate: string | null; readonly packType: string;
  readonly systemQty: number; readonly countedQty: number; readonly countedBy: string | null; readonly countedAt: string;
}
interface JobRow { readonly id: string; readonly code: string; readonly jobType: string; readonly status: string; readonly assigneeName: string | null; readonly taskCount: number; readonly completedTaskCount: number; readonly cancelledTaskCount?: number; readonly createdAt: string }
interface Detail {
  readonly plan: CountPlanListRow; readonly lines: readonly CountLineListRow[]; readonly entries: readonly EntryRow[]; readonly jobs: readonly JobRow[];
  readonly mandatoryCountReason: boolean;
}

const TABS = ["lines", "sheet", "jobs", "timeline"] as const;
type Tab = (typeof TABS)[number];
type Dialog = { kind: "cancel" | "delete" | "update" | "job" | "edit" | "view" | "line-update" | "line-recount" | "line-cancel"; lineIds?: readonly string[] } | null;

export function CountDetailPage({ id }: { readonly id: string }) {
  const detail = useApiQuery<Detail>(["count-plan", id], `/api/counts/${encodeURIComponent(id)}`, { timeoutMs: COUNT_QUERY_TIMEOUT_MS });
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
  return <Loaded data={detail.data.data} refetch={() => detail.refetch()} fetching={detail.isFetching} />;
}

function Loaded({ data, refetch, fetching = false }: { readonly data: Detail; readonly refetch: () => Promise<unknown>; readonly fetching?: boolean }) {
  const { plan, lines, entries, jobs } = data;
  const router = useRouter();
  const search = useSearchParams();
  const fmt = useFormat();
  const refresh = useRefreshCounts();
  const tabParam = search.get("tab");
  const [tab, setTabState] = React.useState<Tab>((TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "lines");
  const setTab = (t: string) => {
    if (!(TABS as readonly string[]).includes(t)) return;
    setTabState(t as Tab);
    // Mirror to the URL without a router round trip (Next integrates native history.replaceState).
    const url = new URL(window.location.href);
    if (t === "lines") url.searchParams.delete("tab"); else url.searchParams.set("tab", t);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  };
  const can = {
    edit: useCountCan(P.edit).allowed, del: useCountCan(P.delete).allowed, cancel: useCountCan(P.cancel).allowed, update: useCountCan(P.updateInv).allowed, job: useCountCan(P.createJob).allowed,
    lineUpdate: useCountCan([P.locUpdateInv, P.skuUpdateInv, P.updateInv], "any").allowed, recount: useCountCan([P.locRecount, P.skuRecount], "any").allowed,
    lineCancel: useCountCan([P.locCancel, P.skuCancel], "any").allowed, execute: useCountCan(COUNT_EXECUTE_PERMISSIONS, "any").allowed,
  };
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [log, setLog] = React.useState(false);
  const [cancelNote, setCancelNote] = React.useState("");
  const closeDialog = () => { setDialog(null); setCancelNote(""); };
  const tabStrip = React.useRef<HTMLDivElement>(null);
  const panel = useTabPanelIds(tabStrip, tab);
  const selectedLines = lines.filter((l) => selection[l.id]);
  // Finished plans (Inventory Updated / Cancelled) have no line actions left: no selection, no dead buttons.
  const finished = plan.status === "Inventory Updated" || plan.status === "Cancelled";
  const lineSelectable = !finished && (can.lineCancel || can.recount || can.lineUpdate);

  // Every mutation refetches this plan (lines, KPIs, sheet, jobs) right away, in parallel with the
  // grids and timeline, so a recount line or cancelled line shows without a reload.
  const done = async () => { setSelection({}); await Promise.all([refetch(), refresh()]); };

  const locked = plan.lockLocations && (LOCKING_PLAN_STATUSES as readonly string[]).includes(plan.status);
  const orphanLineIds = lines.filter((l) => l.orphaned).map((l) => l.id);
  const orphaned = plan.orphanedLineCount ?? orphanLineIds.length;
  const orphanMessage = finished ? null : orphanedLinesMessage(orphaned);
  const cancelledJobs = jobs.filter((j) => j.status === "Cancelled").map((j) => j.code);
  const counted = lines.filter((l) => l.countedQty !== null);
  const active = lines.filter((l) => l.status !== "Cancelled" && l.status !== "Recount Created");
  const superseded = lines.filter((l) => l.status === "Recount Created").length;
  const cancelledLines = lines.length - active.length - superseded;
  const liveLineIds = new Set(lines.filter((l) => l.status !== "Cancelled" && l.status !== "Recount Created").map((l) => l.id));
  const liveEntries = entries.filter((e) => liveLineIds.has(e.lineId));
  const varianceUnits = liveEntries.reduce((s, e) => s + (e.countedQty - e.systemQty), 0);
  const lockedLocationCount = new Set(lines.filter((l) => lineHoldsLock(plan.lockLocations, plan.status, l.status) && l.locationCode).map((l) => l.locationCode)).size;
  const scopeSystemTotal = active.reduce((s, l) => s + (l.approvedStockQty ?? l.initialStockQty), 0);
  const differingBuckets = liveEntries.filter((e) => e.countedQty !== e.systemQty).length;
  const systemTotal = counted.filter((l) => l.status !== "Recount Created").reduce((s, l) => s + (l.approvedStockQty ?? l.initialStockQty), 0);
  const countedTotal = counted.filter((l) => l.status !== "Recount Created").reduce((s, l) => s + (l.countedQty ?? 0), 0);
  const accuracyLines = counted.filter((l) => l.status !== "Recount Created");
  const exact = accuracyLines.filter((l) => (l.difference ?? 0) === 0).length;

  // Preload the Count Sheet with the same query key CountSheet reads, so switching to the tab
  // renders from cache like the Lines tab instead of showing a skeleton while the sheet loads.
  useApiQuery(["count-sheet", plan.id], `/api/counts/${encodeURIComponent(plan.id)}/sheet`, { timeoutMs: COUNT_QUERY_TIMEOUT_MS, enabled: !finished, staleTime: 30_000 });

  const { ref: gridBox, height: gridHeight } = useFillHeight(tab === "lines");
  const lineColumns = React.useMemo(() => buildLineColumns("plan", plan.countType), [plan.countType]);
  const entriesByLine = React.useMemo(() => {
    const m = new Map<string, EntryRow[]>();
    for (const e of entries) m.set(e.lineId, [...(m.get(e.lineId) ?? []), e]);
    return m;
  }, [entries]);

  const reasons = {
    edit: planEditReason(plan.status), del: planDeleteReason(plan.status) ?? (jobs.length ? "This count plan has jobs; cancel it instead" : null),
    cancel: planCancelReason(plan.status),
    // Update Inv. needs a Count Completed line (same rule as the list toolbar); the confirm lists the open lines it cancels.
    update: planUpdateInvReason(plan.status, plan.countedLineCount),
    job: planCreateJobReason(plan.status, orphaned),
  };
  const none = selectedLines.length === 0 ? "Select at least one line" : null;
  const lineDiscards = dialog?.kind === "line-cancel" ? lines.filter((l) => dialog.lineIds?.includes(l.id) && l.status === "Count Completed").length : 0;
  const lineReasons = {
    update: none ?? firstReason(selectedLines, (l) => lineUpdateInvReason(l.status)),
    recount: none ?? firstReason(selectedLines, (l) => lineRecountReason(l.status, plan.operationType)),
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

  // Finished plans (Inventory Updated / Cancelled) keep only the actions that still apply, so the bar
  // stays on the title row in every status instead of wrapping under the meta line.
  // The less-used actions (Show Details, Change log, Delete) live in a More menu so the bar keeps the
  // same footprint in every status and never wraps under the meta line (critic r4).
  const headerActions = (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" aria-label="More plan actions"><MoreHorizontal className="h-3.5 w-3.5" aria-hidden />More<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[240px]">
          <DropdownMenuItem icon={Eye} onSelect={() => setDialog({ kind: "view" })} description="Read-only view of the plan settings">Show Details</DropdownMenuItem>
          <DropdownMenuItem icon={History} onSelect={() => setLog(true)} description="Every change to this plan, field by field">Change log</DropdownMenuItem>
          {can.del && !finished ? <DropdownMenuItem icon={Trash2} destructive disabledReason={reasons.del} onSelect={() => setDialog({ kind: "delete" })} description="Remove a pending plan that has no jobs">Delete</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {plan.status === "Inventory Updated" ? <Tooltip content="Inventory was posted from this count. The plan is locked for the audit trail: no line or quantity edits, recounts or re-posting. Only the description can still be edited."><span tabIndex={0} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-sunken px-2.5 text-[12px] font-semibold text-secondary"><Lock className="h-3.5 w-3.5" aria-hidden />Locked</span></Tooltip> : null}
      {can.edit && !finished ? <DisabledReason reason={reasons.edit}><Button variant="secondary" disabled={Boolean(reasons.edit)} onClick={() => setDialog({ kind: "edit" })}><Pencil className="h-3.5 w-3.5" aria-hidden />Edit</Button></DisabledReason> : null}
      {can.cancel && !finished ? <DisabledReason reason={reasons.cancel}><Button variant="secondary" disabled={Boolean(reasons.cancel)} onClick={() => setDialog({ kind: "cancel" })}><Ban className="h-3.5 w-3.5" aria-hidden />Cancel</Button></DisabledReason> : null}
      {can.job && !reasons.job ? <Button variant="primary" onClick={() => setDialog({ kind: "job" })}><ClipboardList className="h-3.5 w-3.5" aria-hidden />{plan.status === "Pending" ? "Create Job" : "Re-create job"}</Button> : null}
      {can.update && !finished ? <DisabledReason reason={reasons.update}><Button variant={reasons.update ? "secondary" : "primary"} disabled={Boolean(reasons.update)} aria-disabled={Boolean(reasons.update)} title={reasons.update ?? undefined} onClick={() => setDialog({ kind: "update" })}><ClipboardCheck className="h-3.5 w-3.5" aria-hidden />Update Inv.</Button></DisabledReason> : null}
    </>
  );

  const meta = (
    <span className="flex max-w-[640px] flex-wrap items-center gap-x-3 gap-y-1">
      <span>Warehouse <strong className="text-foreground">{plan.warehouseCode}</strong></span>
      <span>{plan.countType} count · {plan.operationType}{plan.isAi ? " · AI Count Plan" : ""}</span>
      {plan.waveRuleId ? <span>Scheduled by wave rule <Link href="/jobs/wave-rules" className="font-semibold text-primary hover:underline">{plan.waveRuleName ?? "Cycle Count"}</Link></span> : null}
      <span>Scheduled {fmt.gridDateTime(plan.scheduledAt)}</span>
      <span>Created by {plan.createdByName ?? "System"} on {fmt.gridDateTime(plan.createdAt)}</span>
      {plan.inventoryUpdatedAt ? <span>Inventory updated {fmt.gridDateTime(plan.inventoryUpdatedAt)} by {plan.inventoryUpdatedByName ?? "System"}</span> : null}
    </span>
  );

  const tabs = [
    { key: "lines", label: "Lines", count: lines.length },
    { key: "sheet", label: "Count sheet", count: lines.filter((l) => l.status === "Ready To Count" || l.status === "Count Started").length },
    { key: "jobs", label: "Jobs", count: jobs.length },
    { key: "timeline", label: "Timeline" },
  ];

  return (
    <div className="flex min-h-0 flex-col pb-8">
      <DetailHeader title={plan.code} backHref="/counts" backLabel="Count plans" meta={meta} actions={headerActions}
        badges={<><CountStatusPill status={plan.status} />{locked ? <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning"><Lock className="h-3 w-3" aria-hidden />Locations locked</span> : null}</>} />
      {plan.description ? <p className="-mt-2 px-6 pb-3 text-[13px] text-secondary">{plan.description}</p> : null}
      {orphanMessage ? (
        <div className="px-6 pb-3">
          <Callout variant="error" title={cancelledJobs.length ? `Count job ${cancelledJobs.slice(0, 3).join(", ")}${cancelledJobs.length > 3 ? ` +${cancelledJobs.length - 3}` : ""} was cancelled` : "Lines without a count task"}
            action={<span className="flex flex-wrap gap-2">
              {can.job ? <Button size="sm" variant="primary" onClick={() => setDialog({ kind: "job" })}><ClipboardList className="h-3.5 w-3.5" aria-hidden />Re-create job</Button> : null}
              {can.lineCancel ? <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "line-cancel", lineIds: orphanLineIds })}><Ban className="h-3.5 w-3.5" aria-hidden />Cancel these lines</Button> : null}
            </span>}>
            {orphanMessage}
          </Callout>
        </div>
      ) : null}
      {locked ? (
        <div className="px-6 pb-3">
          <Callout variant="attention" title="Stock in these locations is frozen">Transfers, picks and putaways in or out of {lockedLocationCount ? <>the {lockedLocationCount} counted {lockedLocationCount === 1 ? "location" : "locations"}</> : "the locations that hold the counted SKUs"} are blocked until the count is cancelled or inventory is updated.</Callout>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 px-6 pb-4 lg:grid-cols-5">
        <StatTile label={lines.length > active.length ? "Active lines" : "Lines"} value={active.length.toLocaleString()} sublabel={lines.length > active.length ? [superseded ? `${superseded} superseded by recount` : null, cancelledLines ? `${cancelledLines} cancelled` : null, `${lines.length} total`].filter(Boolean).join(" · ") : `${plural(plan.locationCount, "location", "locations")} · ${plural(plan.skuCount, "SKU", "SKUs")}`} />
        <StatTile label="Counted" value={`${accuracyLines.length} / ${active.length}`} sublabel={active.length ? `${Math.round((accuracyLines.length / active.length) * 100)}% complete` : "Nothing to count"} tone="primary" />
        <StatTile label="Counted vs system" value={accuracyLines.length ? <span className="flex items-center gap-2">{countedTotal.toLocaleString()}<span className="text-[13px] font-normal text-secondary">/ {systemTotal.toLocaleString()}</span></span> : "—"} sublabel={accuracyLines.length ? <span className="inline-flex items-center gap-1.5"><DifferenceBadge value={percentDifference(systemTotal, countedTotal)} /><span>{accuracyLines.length === 1 ? "counted line only" : `${accuracyLines.length} counted lines only`}</span></span> : `${plural(scopeSystemTotal, "system unit", "system units")} to count`} />
        <StatTile label="Unit variance" value={!accuracyLines.length ? "—" : <span className="tabular-nums">{varianceUnits > 0 ? `+${varianceUnits.toLocaleString()}` : varianceUnits < 0 ? `−${Math.abs(varianceUnits).toLocaleString()}` : "0"}</span>} sublabel={!accuracyLines.length ? "Shown once a line is counted" : differingBuckets === 1 ? "1 bucket differs" : `${differingBuckets.toLocaleString()} buckets differ`} tone={!accuracyLines.length ? "default" : varianceUnits === 0 ? "success" : "warning"} />
        <StatTile label="Exact lines" value={accuracyLines.length ? `${Math.round((exact / accuracyLines.length) * 100)}%` : "—"} sublabel={`${exact} of ${plural(accuracyLines.length, "counted line", "counted lines")} ${exact === 1 && accuracyLines.length === 1 ? "matches" : "match"}`} tone={accuracyLines.length && exact === accuracyLines.length ? "success" : "default"} />
      </div>
      <div className="relative">
        <div ref={tabStrip}><UnderlineTabs tabs={tabs} active={tab} onChange={setTab} className="px-6" ariaLabel="Count sections" /></div>
        {fetching ? <span role="status" className="absolute right-6 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 text-[12px] text-secondary"><Spinner className="h-3 w-3" />Updating…</span> : null}
      </div>
      {/* The tab strip's triggers point aria-controls at this panel (critic r5: no role=tabpanel before). */}
      <div className="px-6 pt-4" role="tabpanel" id={panel.panelId} aria-labelledby={panel.tabId} tabIndex={-1} data-tab={tab}>
        {tab === "lines" ? (
          // Single card: the grid owns the border; the line actions sit in its toolbar row, and the card
          // is sized to its rows (min 260px) so a short plan leaves no blank card below the grid.
          <div ref={gridBox} className="flex flex-col" style={{ height: gridHeight }}>
            <DataGrid<CountLineListRow>
              columns={lineColumns} data={[...lines]} total={lines.length} page={1} pageSize={Math.max(100, lines.length)} onPageChange={() => undefined}
              getRowId={(l) => l.id} selection={selection} onSelectionChange={setSelection} exportName={`${plan.code}-lines`}
              selectable={lineSelectable}
              toolbarLeft={<p className="text-[12px] text-secondary">{selectedLines.length ? <><strong className="text-foreground">{selectedLines.length}</strong> selected</> : lineSelectable ? "Select lines to update inventory, recount or cancel them. Expand a line to see each counted bucket." : "Expand a line to see each counted bucket."}</p>}
              toolbarRight={() => (finished ? null :
                <>
                  {can.lineCancel ? <DisabledReason reason={lineReasons.cancel}><Button size="sm" variant="secondary" disabled={Boolean(lineReasons.cancel)} onClick={() => setDialog({ kind: "line-cancel", lineIds: selectedLines.map((l) => l.id) })}><Ban className="h-3.5 w-3.5" aria-hidden />Cancel</Button></DisabledReason> : null}
                  {can.recount ? <DisabledReason reason={lineReasons.recount}><Button size="sm" variant="secondary" disabled={Boolean(lineReasons.recount)} onClick={() => setDialog({ kind: "line-recount", lineIds: selectedLines.map((l) => l.id) })}><RotateCcw className="h-3.5 w-3.5" aria-hidden />Create Recount</Button></DisabledReason> : null}
                  {can.lineUpdate ? <DisabledReason reason={lineReasons.update}><Button size="sm" variant={lineReasons.update ? "secondary" : "primary"} disabled={Boolean(lineReasons.update)} onClick={() => setDialog({ kind: "line-update", lineIds: selectedLines.map((l) => l.id) })}><ClipboardCheck className="h-3.5 w-3.5" aria-hidden />Update Inv.</Button></DisabledReason> : null}
                </>
              )}
              renderExpanded={(l) => <StickyExpansion><EntriesTable line={l} entries={entriesByLine.get(l.id) ?? []} /></StickyExpansion>}
              emptyTitle="This plan has no lines" emptyDescription="Edit the plan to add locations or SKUs."
            />
          </div>
        ) : null}
        {tab === "sheet" ? (
          <CountSheet planId={plan.id} planCode={plan.code} planStatus={plan.status} warehouseId={plan.warehouseId} canExecute={can.execute} onSubmitted={() => void done()} onCreateJob={can.job ? () => setDialog({ kind: "job" }) : undefined} />
        ) : null}
        {tab === "jobs" ? <JobsTable jobs={jobs} /> : null}
        {tab === "timeline" ? <CountTimeline planId={plan.id} /> : null}
      </div>

      <ConfirmDialog open={dialog?.kind === "cancel"} onOpenChange={(o) => !o && closeDialog()} variant="danger" icon={Ban}
        title={`Cancel count plan ${plan.code}?`} description={`Open lines and pending count tasks are cancelled; counted lines that were not posted are discarded.${plan.lockLocations ? " Its locked locations unlock right away." : ""}`}
        confirmLabel="Cancel count plan" cancelLabel="Keep plan" onConfirm={async () => { assertCancelReason(plan.countedLineCount, cancelNote); await runBulkCommand("/api/counts/cancel", { ids: [plan.id], reason: cancelNote.trim() || null }, "count plan", "cancelled"); setCancelNote(""); await done(); }}>
        <CancelReasonField discards={plan.countedLineCount} value={cancelNote} onChange={setCancelNote} />
      </ConfirmDialog>
      <ConfirmDialog open={dialog?.kind === "delete"} onOpenChange={(o) => !o && setDialog(null)} variant="danger"
        title={`Delete count plan ${plan.code}?`} description="The plan and its lines are removed. This action cannot be undone." confirmLabel="Delete plan" cancelLabel="Keep plan" onConfirm={runDelete} />
      <ConfirmDialog open={dialog?.kind === "line-cancel"} onOpenChange={(o) => !o && closeDialog()} variant="danger" icon={Ban}
        title={`Cancel ${dialog?.lineIds?.length ?? 0} count ${dialog?.lineIds?.length === 1 ? "line" : "lines"}?`} description="Their pending count tasks are cancelled. The plan is cancelled when no line is left."
        records={{ columns: [{ key: "line", label: "Line" }, { key: "status", label: "Status" }], rows: lines.filter((l) => dialog?.lineIds?.includes(l.id)).map((l) => ({ line: [l.locationCode, l.sku].filter(Boolean).join(" · "), status: <CountStatusPill status={l.status} domain="count" size="sm" /> })) }}
        confirmLabel={dialog?.lineIds?.length === 1 ? "Cancel line" : "Cancel lines"} cancelLabel={dialog?.lineIds?.length === 1 ? "Keep line" : "Keep lines"} onConfirm={async () => { assertCancelReason(lineDiscards, cancelNote); await runBulkCommand("/api/counts/lines/cancel", { ids: dialog?.lineIds ?? [], reason: cancelNote.trim() || null }, "count line", "cancelled"); setCancelNote(""); await done(); }}>
        <CancelReasonField discards={lineDiscards} value={cancelNote} onChange={setCancelNote} />
      </ConfirmDialog>
      <UpdateInventoryDialog open={dialog?.kind === "update"} onOpenChange={(o) => !o && setDialog(null)} level="plan" ids={[plan.id]} onDone={() => void done()} />
      <UpdateInventoryDialog open={dialog?.kind === "line-update"} onOpenChange={(o) => !o && setDialog(null)} level="line" ids={dialog?.lineIds ?? []} onDone={() => void done()} />
      <RecountDialog open={dialog?.kind === "line-recount"} onOpenChange={(o) => !o && setDialog(null)} onDone={() => void done()}
        lines={lines.filter((l) => dialog?.lineIds?.includes(l.id)).map((l) => ({ id: l.id, label: [l.locationCode, l.sku].filter(Boolean).join(" · "), planCode: plan.code, countedQty: l.countedQty, systemQty: l.approvedStockQty ?? l.initialStockQty, warehouseId: plan.warehouseId }))} />
      <CreateCountJobModal open={dialog?.kind === "job"} onOpenChange={(o) => !o && setDialog(null)} plans={[plan]} onDone={() => void done()} />
      <CountPlanDrawer open={dialog?.kind === "view"} onOpenChange={(o) => !o && setDialog(null)} mode="view" planId={plan.id} />
      <CountPlanDrawer open={dialog?.kind === "edit"} onOpenChange={(o) => !o && setDialog(null)} mode="edit" planId={plan.id} onSaved={() => void done()} />
      {log ? <ChangeLogDrawer open onOpenChange={setLog} entityType="count_plan" entityId={plan.id} entityCode={plan.code} /> : null}
    </div>
  );
}

/**
 * Ids for the tab panel: the shared strip (Radix) generates the trigger id and its aria-controls
 * target, so the panel reads both from the active trigger and renders with matching id /
 * aria-labelledby. Shared fix (UnderlineTabs panels) is docs/requests/counts.md REQ-29.
 */
function useTabPanelIds(strip: React.RefObject<HTMLDivElement | null>, tab: string): { panelId: string | undefined; tabId: string | undefined } {
  const [ids, setIds] = React.useState<{ panelId: string | undefined; tabId: string | undefined }>({ panelId: undefined, tabId: undefined });
  React.useLayoutEffect(() => {
    const trigger = strip.current?.querySelector<HTMLElement>("[role=tab][aria-selected=true]");
    const next = { panelId: trigger?.getAttribute("aria-controls") ?? undefined, tabId: trigger?.id || undefined };
    setIds((prev) => (prev.panelId === next.panelId && prev.tabId === next.tabId ? prev : next));
  }, [strip, tab]);
  return ids;
}

/**
 * Lines grid fills the space down to the viewport bottom (min 420px), so expanding a row never hides
 * its neighbours behind an inner scroll while the page below stays empty. Re-measures on resize.
 */
function useFillHeight(active: boolean): { ref: React.RefObject<HTMLDivElement | null>; height: number } {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = React.useState(480);
  React.useLayoutEffect(() => {
    if (!active) return;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setHeight(Math.max(420, Math.round(window.innerHeight - top - 24)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);
  return { ref, height };
}

/**
 * Expansion panel pinned to the left edge of the grid's visible area with the visible width, so a
 * horizontally scrolled grid never cuts the per-bucket table ("DIFF" read "IFF", critic r4).
 * The shared grid renders the panel in a full-width row inside its scroll box; this measures that box.
 */
function StickyExpansion({ children }: { readonly children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let box: HTMLElement | null = el.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowX)) box = box.parentElement;
    if (!box) return;
    const scroller = box;
    // The td has 16px side padding; the panel spans the visible width inside it.
    const measure = () => setWidth(Math.max(280, scroller.clientWidth - 32));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} className="sticky left-4" style={width ? { width } : undefined}>{children}</div>;
}

function EntriesTable({ line, entries }: { readonly line: CountLineListRow; readonly entries: readonly EntryRow[] }) {
  const context = [line.locationCode, line.sku ?? line.lpNumber].filter(Boolean).join(" · ");
  if (entries.length === 0) return <p className="px-4 py-3 text-[12px] text-secondary">{context ? <><strong className="text-foreground">{context}</strong>: </> : null}not counted yet.</p>;
  return (
    <div className="ks-scroll overflow-x-auto px-4 py-2">
      {context ? <p className="pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">Counted buckets · <span className="normal-case text-foreground">{context}</span></p> : null}
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
              <td className="py-1 pr-3 text-right"><DeltaBadge value={e.countedQty - e.systemQty} system={e.systemQty} /></td>
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
              <td className="px-3 py-2"><CountStatusPill status={j.status} domain="job" size="sm" /></td>
              <td className="px-3 py-2">{j.assigneeName ?? <span className="text-faint">Job pool</span>}</td>
              <td className="px-3 py-2 tabular-nums">{j.completedTaskCount} / {j.taskCount}{j.cancelledTaskCount ? <span className="ml-1.5 text-[12px] text-secondary">· {j.cancelledTaskCount} cancelled</span> : null}</td>
              <td className="px-3 py-2"><DateCell value={j.createdAt} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
