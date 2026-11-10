"use client";

/**
 * Channel Logs (spec 06 §8–§11): left sub-nav Methods / History / Orders and Shipments /
 * Products and Inventory. Methods shows a live NEXT RUN countdown and per-row Run; History opens
 * a Show Details modal with the right title per method and real dates; call logs are exportable.
 */
import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ListChecks, Play } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { VerticalNav } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { DisabledReason, Tooltip } from "@/components/ui/tooltip";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import {
  HISTORY_FIELDS, HISTORY_GRID_KEY, METHOD_FIELDS, METHODS_GRID_KEY, ORDER_ITEM_FIELDS, ORDER_ITEMS_GRID_KEY, PRODUCT_ITEM_FIELDS, PRODUCT_ITEMS_GRID_KEY, RUN_DETAIL_TITLE,
} from "@/lib/grid-defs/integrations/logs";
import type { CallLogRow, MethodRow, RunItemRow, RunRow } from "@/server/repositories/integration-logs";
import type { RunSummary } from "@/server/integrations/runtime/channel-runtime";
import { Muted, NO_PERMISSION, StatRow, toFilterFields, usePagePerms, YesNo } from "@/components/integrations/shared/shared";
import { ProviderCell, providerOptions } from "@/components/integrations/shared/logos";

const NAV = [
  { key: "methods", label: "Channel Methods", href: "/integrations/logs/methods" },
  { key: "history", label: "Channel History", href: "/integrations/logs/history" },
  { key: "orders", label: "Orders and Shipments", href: "/integrations/logs/orders" },
  { key: "products", label: "Products and Inventory", href: "/integrations/logs/products" },
];

function Shell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Integration Management" tabs="integrations" helper="Every channel method run, call and error, so you can see exactly what came in and what went out." />
      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-4">
        <aside className="w-52 shrink-0"><VerticalNav ariaLabel="Channel logs" items={NAV} /></aside>
        <section className="flex min-w-0 flex-1 flex-col">{children}</section>
      </div>
    </div>
  );
}

function useNow(ms = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function Countdown({ at, status }: { readonly at: string | null; readonly status: string }) {
  const now = useNow();
  if (status !== "Active" || !at) return <Muted />;
  const diff = Math.max(0, Math.floor((Date.parse(at) - now) / 1000));
  if (diff === 0) return <span className="font-medium text-primary">Due now</span>;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return <span className="font-mono tabular-nums">{String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</span>;
}

const every = (min: number) => (min >= 1440 ? `${Math.round(min / 1440)} day` : min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`);

export function ChannelMethodsPage() {
  const perms = usePagePerms("integrations.integrations", ["edit_setup", "create_setup"] as const);
  const fields = React.useMemo(() => toFilterFields(METHOD_FIELDS, { provider: providerOptions("channel") }), []);
  const g = useGrid<MethodRow>({ gridKey: METHODS_GRID_KEY, path: "/api/integration-logs/methods", fields });
  const qc = useQueryClient();
  const [running, setRunning] = React.useState<string | null>(null);
  const canRun = perms.edit_setup || perms.create_setup;
  const run = async (row: MethodRow) => {
    setRunning(row.id);
    try {
      const { data } = await apiRequest<RunSummary>(`/api/integration-logs/methods/${row.id}/run`, { method: "POST", body: {} });
      const fn = data.status === "Successful" || data.status === "No Data" ? toast.success : data.status === "Partially Successful" ? toast.warning : toast.error;
      fn(`${data.method} · ${data.status}`, data.message ?? `${data.storeName}: ${data.success} succeeded · ${data.error} failed of ${data.total}`);
      g.refetch();
      void qc.invalidateQueries({ queryKey: ["grid", HISTORY_GRID_KEY] });
    } catch (error) {
      toast.error("Run failed", isApiError(error) ? error.message : "Something went wrong");
    } finally {
      setRunning(null);
    }
  };
  const COLUMNS: GridColumnDef<MethodRow>[] = [
    { id: "method", header: "Method", size: 180, meta: { alwaysVisible: true }, cell: ({ row }) => <span className="font-medium">{row.original.method}</span> },
    { id: "storeName", header: "Store name", size: 200, cell: ({ row }) => <Link className="text-primary hover:underline" href={`/integrations/channels/${row.original.provider}`}>{row.original.storeName}</Link> },
    { id: "provider", header: "Channel", size: 170, cell: ({ row }) => <ProviderCell kind="channel" provider={row.original.provider} isSandbox={row.original.isSandbox} /> },
    { id: "status", header: "Status", size: 100, cell: ({ row }) => <StatusPill status={row.original.status} domain="active" /> },
    { id: "jobStatus", header: "Job status", size: 140, enableSorting: false, cell: ({ row }) => (row.original.pauseReason ? <Tooltip content={row.original.pauseReason}><span><Badge size="sm" tone="warning">Paused</Badge></span></Tooltip> : <span className="text-secondary">{row.original.jobStatus}</span>) },
    { id: "intervalMinutes", header: "Runs every", size: 110, cell: ({ row }) => every(row.original.intervalMinutes) },
    { id: "nextRunAt", header: "Next run in", size: 120, cell: ({ row }) => <Countdown at={row.original.nextRunAt} status={row.original.pauseReason ? "Paused" : row.original.status} /> },
    { id: "lastRunAt", header: "Last run", size: 200, cell: ({ row }) => (row.original.lastRunAt ? <span className="inline-flex items-center gap-1.5">{row.original.lastRunStatus ? <StatusPill size="sm" status={row.original.lastRunStatus} domain="integration" /> : null}<LastRun at={row.original.lastRunAt} /></span> : <Muted>Never</Muted>) },
    { id: "run", header: "", size: 90, enableSorting: false, meta: { alwaysVisible: true }, cell: ({ row }) => (
      <DisabledReason reason={!canRun ? NO_PERMISSION : running === row.original.id ? "Running…" : null}>
        <Button size="sm" variant="primary" disabled={!canRun || running !== null} onClick={(e) => { e.stopPropagation(); void run(row.original); }}>{running === row.original.id ? <Spinner className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}Run</Button>
      </DisabledReason>
    ) },
  ];
  return (
    <Shell>
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search store name" />
      <DataGrid<MethodRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} emptyTitle="No channel methods yet" emptyDescription="Connect a store; its four methods appear here." />
    </Shell>
  );
}

function LastRun({ at }: { readonly at: string }) {
  const fmt = useFormat();
  return <span className="text-[12px] text-secondary">{fmt.dateTime(at)}</span>;
}

function RunDetailDialog({ run, onClose }: { readonly run: RunRow | null; readonly onClose: () => void }) {
  const fmt = useFormat();
  const [page, setPage] = React.useState(1);
  const [filter, setFilter] = React.useState<"all" | "errors">("all");
  React.useEffect(() => { setPage(1); setFilter(run && run.errorCount > 0 ? "errors" : "all"); }, [run]);
  const q = useApiQuery<{ run: RunRow; items: RunItemRow[]; total: number }>(["run-detail", run?.id ?? "", page, filter], run ? `/api/integration-logs/runs/${run.id}` : null, { query: { page, ps: 25, errors: filter === "errors" ? "true" : "false" }, placeholderData: (p) => p });
  const d = q.data?.data;
  const pages = Math.max(1, Math.ceil((d?.total ?? 0) / 25));
  const title = run ? RUN_DETAIL_TITLE[run.method as keyof typeof RUN_DETAIL_TITLE] ?? "Run Details" : "";
  const props = (raw: string) => {
    try { return Object.entries(JSON.parse(raw) as Record<string, unknown>).map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}: ${String(v)}`).join(" · "); } catch { return raw; }
  };
  return (
    <Dialog open={run !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader title={title} description={run ? `${run.storeName} · ${run.method}` : undefined} />
        <DialogBody className="flex flex-col gap-4">
          {run ? <StatRow stats={[{ label: "Success qty", value: run.successCount, tone: "success" }, { label: "Error qty", value: run.errorCount, tone: run.errorCount > 0 ? "danger" : undefined }, { label: "Total qty", value: run.totalCount }, { label: "Status", value: <StatusPill status={run.status} domain="integration" /> }]} /> : null}
          {run ? <p className="text-[12px] text-secondary">Started {fmt.dateTime(run.startedAt)} · {run.endedAt ? `ended ${fmt.dateTime(run.endedAt)} (${Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000))} s)` : "still running"}</p> : null}
          <SegmentedControl size="sm" ariaLabel="Show" value={filter} onChange={(v) => { setFilter(v); setPage(1); }} options={[{ value: "all", label: "All rows" }, { value: "errors", label: "Errors only" }]} />
          {q.isPending ? <SkeletonTable rows={5} columns={3} /> : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-[12px]">
                <thead className="bg-surface-sunken text-[11px] uppercase text-secondary"><tr><th className="w-20 px-3 py-2 text-left">Success</th><th className="px-3 py-2 text-left">Properties</th><th className="px-3 py-2 text-left">Error message</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {(d?.items ?? []).length === 0 ? <tr><td colSpan={3} className="px-3 py-6 text-center text-faint">No rows to display.</td></tr> : (d?.items ?? []).map((i) => (
                    <tr key={i.id} className="align-top">
                      <td className="px-3 py-2"><YesNo value={i.success} /></td>
                      <td className="px-3 py-2">{i.orderId ? <Link className="text-primary hover:underline" href={`/orders/${i.orderId}`}>{props(i.properties)}</Link> : props(i.properties)}</td>
                      <td className="px-3 py-2 text-danger">{i.errorMessage ? i.errorMessage : <Muted />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto text-[12px] text-secondary">Total: {d?.total ?? 0}</span>
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-[12px] tabular-nums">{page} / {pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChannelHistoryPage() {
  const fmt = useFormat();
  const fields = React.useMemo(() => toFilterFields(HISTORY_FIELDS, { provider: providerOptions("channel") }), []);
  const g = useGrid<RunRow>({ gridKey: HISTORY_GRID_KEY, path: "/api/integration-logs/history", fields });
  const [detail, setDetail] = React.useState<RunRow | null>(null);
  const COLUMNS: GridColumnDef<RunRow>[] = [
    { id: "storeName", header: "Store name", size: 200, meta: { alwaysVisible: true }, cell: ({ row }) => <span className="font-medium">{row.original.storeName}</span> },
    { id: "provider", header: "Channel", size: 170, cell: ({ row }) => <ProviderCell kind="channel" provider={row.original.provider} isSandbox={row.original.isSandbox} /> },
    { id: "method", header: "Method", size: 170, cell: ({ row }) => row.original.method },
    { id: "startedAt", header: "Date", size: 180, cell: ({ row }) => fmt.dateTime(row.original.startedAt) },
    { id: "status", header: "Status", size: 160, cell: ({ row }) => <StatusPill status={row.original.status} domain="integration" /> },
    { id: "successCount", header: "Success", size: 90, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums text-success">{row.original.successCount}</div> },
    { id: "errorCount", header: "Error", size: 90, meta: { align: "right" }, cell: ({ row }) => <div className={`text-right tabular-nums ${row.original.errorCount > 0 ? "font-semibold text-danger" : "text-faint"}`}>{row.original.errorCount}</div> },
    { id: "totalCount", header: "Total", size: 90, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.totalCount}</div> },
  ];
  const rowActions = (row: RunRow): readonly RowAction[] => [{ key: "details", label: "Show details", icon: ListChecks, onSelect: () => setDetail(row) }];
  return (
    <Shell>
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search store name" />
      <DataGrid<RunRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} rowActions={rowActions} onRowClick={setDetail} emptyTitle="No runs yet" emptyDescription="Runs appear here each time a channel method runs." />
      <RunDetailDialog run={detail} onClose={() => setDetail(null)} />
    </Shell>
  );
}

export function CallLogsPage({ kind }: { readonly kind: "orders" | "products" }) {
  const fmt = useFormat();
  const fields = React.useMemo(() => toFilterFields(kind === "orders" ? ORDER_ITEM_FIELDS : PRODUCT_ITEM_FIELDS, { provider: providerOptions("channel") }), [kind]);
  const extraQuery = React.useMemo(() => ({ kind }), [kind]);
  const g = useGrid<CallLogRow>({ gridKey: kind === "orders" ? ORDER_ITEMS_GRID_KEY : PRODUCT_ITEMS_GRID_KEY, path: "/api/integration-logs/items", fields, extraQuery });
  const COLUMNS: GridColumnDef<CallLogRow>[] = [
    { id: "provider", header: "Channel", size: 170, cell: ({ row }) => <ProviderCell kind="channel" provider={row.original.provider} isSandbox={row.original.isSandbox} /> },
    { id: "storeName", header: "Store name", size: 190, cell: ({ row }) => row.original.storeName },
    { id: "method", header: "Call method", size: 160, cell: ({ row }) => row.original.method },
    { id: "at", header: "Call date", size: 180, cell: ({ row }) => fmt.dateTime(row.original.at) },
    ...(kind === "orders"
      ? [{ id: "storeOrderNumber", header: "Store order no", size: 140, cell: ({ row }) => row.original.storeOrderNumber ?? <Muted /> } satisfies GridColumnDef<CallLogRow>]
      : [{ id: "sellerSku", header: "Seller SKU", size: 160, cell: ({ row }) => row.original.sellerSku ?? <Muted /> } satisfies GridColumnDef<CallLogRow>,
        { id: "qty", header: "Qty", size: 80, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.qty ?? <Muted />}</div> } satisfies GridColumnDef<CallLogRow>]),
    { id: "errorMessage", header: "Error message", size: 320, enableSorting: false, cell: ({ row }) => (row.original.errorMessage ? <span className="truncate text-danger" title={row.original.errorMessage}>{row.original.errorMessage}</span> : <Muted />) },
    { id: "success", header: "Successful", size: 100, cell: ({ row }) => <YesNo value={row.original.success} /> },
  ];
  return (
    <Shell>
      <GridToolbar {...g.toolbarProps} searchPlaceholder={kind === "orders" ? "Search order number or store" : "Search seller SKU or store"} />
      <DataGrid<CallLogRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} emptyTitle="No calls recorded yet" emptyDescription={kind === "orders" ? "Order downloads and shipment updates appear here." : "Product downloads and inventory syncs appear here."} />
    </Shell>
  );
}
