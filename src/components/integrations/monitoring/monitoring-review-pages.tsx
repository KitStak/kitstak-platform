"use client";

/**
 * Channel Monitoring › Items For Review (spec 06 §14–§16b): Missing Shipment Orders (bulk Retry
 * Download, Order Details drawer with the error catalog + payload JSON, Download Payload),
 * Recent Errors (grouped, drilldown to affected orders), Workflow Blocked (Release) and Product
 * Listing Exceptions (links to listings).
 */
import * as React from "react";
import Link from "next/link";
import { Download, ExternalLink, Eye, Lightbulb, RefreshCcw, ShieldOff, Unlock } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { VerticalNav } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { useQueryClient } from "@tanstack/react-query";
import {
  BLOCKED_FIELDS, BLOCKED_GRID_KEY, LISTING_EXCEPTION_FIELDS, LISTING_EXCEPTIONS_GRID_KEY, MISSING_FIELDS, MISSING_GRID_KEY, RECENT_ERROR_FIELDS, RECENT_ERRORS_GRID_KEY,
} from "@/lib/grid-defs/integrations/monitoring";
import type { BlockedRow, ListingExceptionRow, MissingDetail, MissingRow, RecentErrorRow } from "@/server/repositories/monitoring";
import { DetailList, Muted, NO_PERMISSION, toastBulk, toFilterFields, useAction, useClientOptions, usePagePerms, useWarehouseOptions, type BulkResponse } from "@/components/integrations/shared/shared";
import { downloadText, JsonViewer, prettyJson } from "@/components/integrations/shared/json-viewer";
import { ProviderCell, providerOptions } from "@/components/integrations/shared/logos";
import { z } from "zod";

const NAV = [
  { key: "missing", label: "Missing Shipment Orders", href: "/integrations/monitoring/missing-orders" },
  { key: "errors", label: "Recent Errors", href: "/integrations/monitoring/recent-errors" },
  { key: "blocked", label: "Workflow Blocked Shipment Orders", href: "/integrations/monitoring/workflow-blocked" },
  { key: "listings", label: "Product Listing Exceptions", href: "/integrations/monitoring/listing-exceptions" },
];

export function MonitoringHeader() {
  return <PageHeader title="Channel Monitoring" tabs="monitoring" helper="Monitor and review integration issues so data keeps flowing between your stores and KitStaks." />;
}

function ReviewShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MonitoringHeader />
      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-4">
        <aside className="w-60 shrink-0"><VerticalNav ariaLabel="Items for review" items={NAV} /></aside>
        <section className="flex min-w-0 flex-1 flex-col">{children}</section>
      </div>
    </div>
  );
}

const connOptions = z.array(z.object({ id: z.string(), storeName: z.string() }));
function useSetupOptions() {
  const q = useApiQuery<unknown>(["channel-options"], "/api/channels/options", { staleTime: 60_000 });
  const p = connOptions.safeParse(q.data?.data);
  return p.success ? p.data.map((c) => ({ value: c.id, label: c.storeName })) : [];
}

/* ---------------- missing orders ---------------- */

export function MissingOrderDrawer({ id, onOpenChange, onRetry, canRetry }: { readonly id: string | null; readonly onOpenChange: (o: boolean) => void; readonly onRetry: (id: string) => void; readonly canRetry: boolean }) {
  const fmt = useFormat();
  const q = useApiQuery<MissingDetail>(["missing-order", id ?? ""], id ? `/api/monitoring/missing-orders/${id}` : null, { staleTime: 0 });
  const d = q.data?.data;
  return (
    <Drawer open={id !== null} onOpenChange={onOpenChange} width={60} title="Order details" description="The error KitStaks hit while downloading this store order, what it means and how to fix it."
      footer={d ? <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => downloadText(`${d.orderCode}-payload.json`, prettyJson(d.payload))}><Download className="h-4 w-4" />Download payload</Button>
        {d.status !== "Resolved" ? <Button variant="primary" disabled={!canRetry} title={canRetry ? undefined : NO_PERMISSION} onClick={() => onRetry(d.id)}><RefreshCcw className="h-4 w-4" />Retry download</Button> : null}</div> : undefined}>
      {q.isPending ? <Skeleton className="h-72 w-full" /> : !d ? <EmptyState title="Couldn't load this order" description={q.error?.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} /> : (
        <div className="flex flex-col gap-4">
          <DetailList items={[
            { label: "Channel", value: <ProviderCell kind="channel" provider={d.provider} isSandbox={d.isSandbox} /> }, { label: "Order code", value: d.orderCode },
            { label: "Channel order number", value: d.channelOrderNumber }, { label: "Channel setup name", value: d.storeName },
            { label: "Last updated", value: fmt.dateTime(d.lastUpdated) }, { label: "Status", value: <StatusPill status={d.status === "Resolved" ? "Successful" : d.status} domain="integration" /> },
          ]} />
          <section className="rounded-lg border border-danger/30 bg-danger-soft/30 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-danger">Error details · {d.lastErrorCode}</p>
            <h3 className="mt-1 text-[15px] font-semibold text-foreground">{d.error.title}</h3>
            <p className="mt-1 text-[13px] text-body">{d.error.explanation}</p>
            <div className="mt-3 flex gap-2 rounded-md bg-surface px-3 py-2">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <div><p className="text-[12px] font-semibold text-foreground">Recommended action</p><p className="text-[13px] text-body">{d.error.recommendedAction}</p></div>
            </div>
            <a href={d.error.guideHref} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">View troubleshooting guide<ExternalLink className="h-3 w-3" /></a>
          </section>
          {d.history.length > 0 ? (
            <section>
              <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-secondary">Download attempts</h3>
              <ul className="divide-y divide-border rounded-lg border border-border text-[12px]">{d.history.map((h, i) => (
                <li key={i} className="flex gap-3 px-3 py-1.5"><span className="w-40 shrink-0 text-secondary">{fmt.dateTime(h.at)}</span><span className={h.success ? "text-success" : "text-danger"}>{h.success ? "Downloaded" : h.message ?? "Failed"}</span></li>
              ))}</ul>
            </section>
          ) : null}
          <JsonViewer title="Order payload (JSON)" value={d.payload} filename={`${d.orderCode}-payload.json`} />
        </div>
      )}
    </Drawer>
  );
}

export function MissingOrdersPage() {
  const fmt = useFormat();
  const perms = usePagePerms("integrations.integrations", ["edit_setup", "create_setup"] as const);
  const canRetry = perms.edit_setup || perms.create_setup;
  const clients = useClientOptions();
  const setups = useSetupOptions();
  const fields = React.useMemo(() => toFilterFields(MISSING_FIELDS, { provider: providerOptions("channel"), clientId: clients, connectionId: setups }), [clients, setups]);
  const g = useGrid<MissingRow>({ gridKey: MISSING_GRID_KEY, path: "/api/monitoring/missing-orders", fields });
  const [detail, setDetail] = React.useState<string | null>(null);
  const [retrying, setRetrying] = React.useState(false);
  const qc = useQueryClient();
  const retry = async (ids: readonly string[]) => {
    setRetrying(true);
    try {
      const { data } = await apiRequest<BulkResponse>("/api/monitoring/missing-orders/retry", { method: "POST", body: { ids } });
      toastBulk(data, "order", "downloaded");
      g.clearSelection();
      g.refetch();
      void qc.invalidateQueries({ queryKey: ["missing-order"] });
    } catch (error) {
      toastBulk({ succeeded: [], failed: ids.map((id) => ({ id, code: "ERROR", message: error instanceof Error ? error.message : "Retry failed" })) }, "order", "downloaded");
    } finally {
      setRetrying(false);
    }
  };
  const COLUMNS: GridColumnDef<MissingRow>[] = [
    { id: "orderCode", header: "Order code", size: 170, meta: { alwaysVisible: true }, cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setDetail(row.original.id); }}>{row.original.orderCode}</button> },
    { id: "channelOrderNumber", header: "Channel order number", size: 160, cell: ({ row }) => row.original.channelOrderNumber },
    { id: "storeName", header: "Channel setup name", size: 190, cell: ({ row }) => row.original.storeName },
    { id: "provider", header: "Channel", size: 160, cell: ({ row }) => <ProviderCell kind="channel" provider={row.original.provider} isSandbox={row.original.isSandbox} /> },
    { id: "clientName", header: "Client", size: 170, cell: ({ row }) => row.original.clientName },
    { id: "orderDate", header: "Order date", size: 170, cell: ({ row }) => fmt.dateTime(row.original.orderDate) },
    { id: "lastUpdated", header: "Last updated", size: 170, cell: ({ row }) => fmt.dateTime(row.original.lastUpdated) },
    { id: "lastErrorCode", header: "Last error code", size: 320, cell: ({ row }) => <Badge tone="danger" size="sm" shape="pill" className="max-w-full truncate" title={row.original.lastErrorCode}>{row.original.lastErrorCode}</Badge> },
    { id: "status", header: "Status", size: 110, cell: ({ row }) => <StatusPill status={row.original.status === "Resolved" ? "Successful" : row.original.status} domain="integration" size="sm" /> },
  ];
  const bulk: readonly BulkAction[] = [{ key: "retry", label: retrying ? "Retrying…" : "Retry Download", icon: RefreshCcw, onSelect: (ids) => void retry(ids), disabledReason: !canRetry ? NO_PERMISSION : retrying ? "A retry is running" : null }];
  const rowActions = (row: MissingRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => setDetail(row.id) },
    { key: "payload", label: "Download payload", icon: Download, onSelect: () => void apiRequest<MissingDetail>(`/api/monitoring/missing-orders/${row.id}`).then(({ data }) => downloadText(`${data.orderCode}-payload.json`, prettyJson(data.payload))) },
    { key: "retry", label: "Retry download", icon: RefreshCcw, onSelect: () => void retry([row.id]), disabledReason: !canRetry ? NO_PERMISSION : row.status === "Resolved" ? "Already downloaded" : null },
  ];
  return (
    <ReviewShell>
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search order code or store order number" bulkActions={bulk} bulkNoun="order" />
      <DataGrid<MissingRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} rowActions={rowActions} onRowClick={(r) => setDetail(r.id)}
        emptyTitle="No missing orders" emptyDescription="Every store order downloaded. Orders that fail show here with what went wrong and how to fix it." />
      <MissingOrderDrawer id={detail} onOpenChange={(o) => !o && setDetail(null)} canRetry={canRetry} onRetry={(id) => void retry([id])} />
    </ReviewShell>
  );
}

/* ---------------- recent errors ---------------- */

const drillSchema = z.array(z.object({ storeOrderNumber: z.string(), missingOrderId: z.string().nullable(), orderCode: z.string().nullable(), status: z.string(), lastErrorCode: z.string(), message: z.string().nullable(), at: z.string() }));

function DrilldownDialog({ row, onClose, onOpenOrder }: { readonly row: RecentErrorRow | null; readonly onClose: () => void; readonly onOpenOrder: (id: string) => void }) {
  const fmt = useFormat();
  const q = useApiQuery<unknown>(["recent-error-orders", row?.id ?? ""], row ? "/api/monitoring/recent-errors/orders" : null, { query: row ? { connectionId: row.connectionId, reason: row.errorReason, day: row.day } : undefined });
  const p = drillSchema.safeParse(q.data?.data);
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader title="Affected orders" description={row ? `${row.errorReason} · ${row.storeName} · ${row.day}` : undefined} />
        <DialogBody>
          {q.isPending ? <SkeletonTable rows={4} columns={4} /> : !p.success || p.data.length === 0 ? <EmptyState compact title="No affected orders found" /> : (
            <table className="w-full text-[12px]">
              <thead className="bg-surface-sunken text-[11px] uppercase text-secondary"><tr><th className="px-3 py-2 text-left">Store order</th><th className="px-3 py-2 text-left">Order code</th><th className="px-3 py-2 text-left">Last attempt</th><th className="px-3 py-2 text-left">Status</th><th /></tr></thead>
              <tbody className="divide-y divide-border">{p.data.map((o) => (
                <tr key={o.storeOrderNumber}>
                  <td className="px-3 py-2 font-medium">{o.storeOrderNumber}</td><td className="px-3 py-2">{o.orderCode ?? <Muted />}</td>
                  <td className="px-3 py-2 text-secondary">{fmt.dateTime(o.at)}</td><td className="px-3 py-2"><StatusPill size="sm" status={o.status === "Resolved" ? "Successful" : o.status} domain="integration" /></td>
                  <td className="px-3 py-2 text-right">{o.missingOrderId ? <Button size="sm" variant="secondary" onClick={() => onOpenOrder(o.missingOrderId as string)}>Open</Button> : null}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </DialogBody>
        <DialogFooter>
          {row ? <Link href={`/integrations/monitoring/missing-orders?f.connectionId=in:${row.connectionId}&f.lastErrorCode=in:${encodeURIComponent(row.errorReason)}`}><Button variant="secondary">Open in Missing Orders</Button></Link> : null}
          <Button variant="primary" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RecentErrorsPage() {
  const fmt = useFormat();
  const perms = usePagePerms("integrations.integrations", ["edit_setup", "create_setup"] as const);
  const clients = useClientOptions();
  const setups = useSetupOptions();
  const fields = React.useMemo(() => toFilterFields(RECENT_ERROR_FIELDS, { provider: providerOptions("channel"), clientId: clients, connectionId: setups }), [clients, setups]);
  const g = useGrid<RecentErrorRow>({ gridKey: RECENT_ERRORS_GRID_KEY, path: "/api/monitoring/recent-errors", fields });
  const [drill, setDrill] = React.useState<RecentErrorRow | null>(null);
  const [order, setOrder] = React.useState<string | null>(null);
  const COLUMNS: GridColumnDef<RecentErrorRow>[] = [
    { id: "errorReason", header: "Error reason", size: 360, meta: { alwaysVisible: true }, cell: ({ row }) => <button type="button" className="truncate text-left font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setDrill(row.original); }}>{row.original.errorReason}</button> },
    { id: "storeName", header: "Channel setup name", size: 190, cell: ({ row }) => row.original.storeName },
    { id: "provider", header: "Channel", size: 160, cell: ({ row }) => <ProviderCell kind="channel" provider={row.original.provider} /> },
    { id: "clientName", header: "Client", size: 170, cell: ({ row }) => row.original.clientName },
    { id: "occurrences", header: "Num. of occurrence", size: 140, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.occurrences}</div> },
    { id: "affectedOrders", header: "Num. of affected order", size: 160, meta: { align: "right" }, cell: ({ row }) => <div className="text-right"><button type="button" className="tabular-nums font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setDrill(row.original); }}>{row.original.affectedOrders}</button></div> },
    { id: "lastOccurrence", header: "Last occurrence date", size: 180, cell: ({ row }) => fmt.dateTime(row.original.lastOccurrence) },
  ];
  return (
    <ReviewShell>
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search error reason or setup" />
      <DataGrid<RecentErrorRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} onRowClick={setDrill} rowActions={(r) => [{ key: "drill", label: "Show affected orders", icon: Eye, onSelect: () => setDrill(r) }]}
        emptyTitle="No download errors in the last two weeks" emptyDescription="Grouped order download errors show here with a drilldown to the affected orders." />
      <DrilldownDialog row={drill} onClose={() => setDrill(null)} onOpenOrder={(id) => { setDrill(null); setOrder(id); }} />
      <MissingOrderDrawer id={order} onOpenChange={(o) => !o && setOrder(null)} canRetry={perms.edit_setup || perms.create_setup} onRetry={(id) => void apiRequest("/api/monitoring/missing-orders/retry", { method: "POST", body: { ids: [id] } }).then(() => { setOrder(null); g.refetch(); })} />
    </ReviewShell>
  );
}

/* ---------------- workflow blocked ---------------- */

export function WorkflowBlockedPage() {
  const fmt = useFormat();
  const ordersPerms = usePagePerms("fulfillment.shipment_orders", ["edit"] as const);
  const wfPerms = usePagePerms("automation.workflows", ["edit"] as const);
  const canRelease = ordersPerms.edit || wfPerms.edit;
  const clients = useClientOptions();
  const warehouses = useWarehouseOptions();
  const fields = React.useMemo(() => toFilterFields(BLOCKED_FIELDS, { provider: providerOptions("channel"), clientId: clients, warehouseId: warehouses.short }), [clients, warehouses.short]);
  const g = useGrid<BlockedRow>({ gridKey: BLOCKED_GRID_KEY, path: "/api/monitoring/workflow-blocked", fields });
  const [release, setRelease] = React.useState<readonly BlockedRow[] | null>(null);
  const action = useAction([["grid", BLOCKED_GRID_KEY]]);
  const COLUMNS: GridColumnDef<BlockedRow>[] = [
    { id: "orderCode", header: "Order code", size: 130, meta: { alwaysVisible: true }, cell: ({ row }) => <Link className="font-medium text-primary hover:underline" href={`/orders/${row.original.id}`} onClick={(e) => e.stopPropagation()}>{row.original.orderCode}</Link> },
    { id: "blockType", header: "Fully or partially", size: 140, cell: ({ row }) => <Badge size="sm" shape="pill" tone={row.original.blockType === "Fully" ? "danger" : "warning"}>{row.original.blockType}</Badge> },
    { id: "storeName", header: "Channel setup name", size: 180, cell: ({ row }) => row.original.storeName ?? <Muted>Manual</Muted> },
    { id: "provider", header: "Channel", size: 150, cell: ({ row }) => (row.original.provider ? <ProviderCell kind="channel" provider={row.original.provider} /> : <Muted />) },
    { id: "clientName", header: "Client", size: 170, cell: ({ row }) => row.original.clientName },
    { id: "orderDate", header: "Order date", size: 170, cell: ({ row }) => fmt.dateTime(row.original.orderDate) },
    { id: "workflowName", header: "Workflow name", size: 210, cell: ({ row }) => (row.original.workflowId ? <Link className="text-primary hover:underline" href={`/automation/workflows/${row.original.workflowId}`} onClick={(e) => e.stopPropagation()}>{row.original.workflowName}</Link> : <Muted>Not recorded</Muted>) },
    { id: "actionName", header: "Action name", size: 170, cell: ({ row }) => row.original.actionName },
    { id: "warehouseCode", header: "Warehouse", size: 100, cell: ({ row }) => row.original.warehouseCode },
  ];
  const bulk: readonly BulkAction[] = [{ key: "release", label: "Release", icon: Unlock, onSelect: (ids) => setRelease(g.rows.filter((r) => ids.includes(r.id))), disabledReason: canRelease ? null : NO_PERMISSION }];
  return (
    <ReviewShell>
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search order, store or workflow" bulkActions={bulk} bulkNoun="order" />
      <DataGrid<BlockedRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} rowActions={(r) => [{ key: "release", label: "Release / unblock", icon: Unlock, onSelect: () => setRelease([r]), disabledReason: canRelease ? null : NO_PERMISSION }]}
        emptyTitle="No orders are blocked by workflows" emptyDescription="Orders stopped by a Block Order or Partially Block Order action show here until someone releases them." />
      <ConfirmDialog open={release !== null} onOpenChange={(o) => !o && setRelease(null)} variant="attention" icon={ShieldOff}
        title={`Release ${release?.length === 1 ? `order ${release[0]?.orderCode}` : `${release?.length ?? 0} orders`}?`} description="Released orders can be allocated and picked again. The workflow won't block them again unless they're updated."
        confirmLabel="Yes, release" cancelLabel="No"
        records={{ columns: [{ key: "o", label: "Order" }, { key: "b", label: "Block" }, { key: "w", label: "Workflow" }], rows: (release ?? []).map((r) => ({ o: r.orderCode, b: r.blockType, w: r.workflowName ?? "—" })) }}
        onConfirm={async () => {
          const res = await action.run<BulkResponse>("/api/monitoring/workflow-blocked/release", "POST", { ids: (release ?? []).map((r) => r.id) });
          if (res) { toastBulk(res, "order", "released"); g.clearSelection(); }
          setRelease(null);
        }} />
    </ReviewShell>
  );
}

/* ---------------- listing exceptions ---------------- */

export function ListingExceptionsPage() {
  const fmt = useFormat();
  const clients = useClientOptions();
  const fields = React.useMemo(() => toFilterFields(LISTING_EXCEPTION_FIELDS, { provider: providerOptions("channel"), clientId: clients }), [clients]);
  const g = useGrid<ListingExceptionRow>({ gridKey: LISTING_EXCEPTIONS_GRID_KEY, path: "/api/monitoring/listing-exceptions", fields });
  const COLUMNS: GridColumnDef<ListingExceptionRow>[] = [
    { id: "sku", header: "KitStaks SKU", size: 190, meta: { alwaysVisible: true }, cell: ({ row }) => <Link className="font-medium text-primary hover:underline" href={`/products/${row.original.productId}`}>{row.original.sku}</Link> },
    { id: "sellerSkus", header: "Seller SKU", size: 240, cell: ({ row }) => <span className="truncate" title={row.original.sellerSkus}>{row.original.sellerSkus}</span> },
    { id: "storeName", header: "Channel setup name", size: 190, cell: ({ row }) => row.original.storeName },
    { id: "provider", header: "Channel", size: 150, cell: ({ row }) => <ProviderCell kind="channel" provider={row.original.provider} /> },
    { id: "clientName", header: "Client", size: 170, cell: ({ row }) => row.original.clientName },
    { id: "issueType", header: "Issue type", size: 150, cell: ({ row }) => <Badge size="sm" shape="pill" tone={row.original.issueType === "Multi Listing" ? "warning" : "info"}>{row.original.issueType}</Badge> },
    { id: "listingDate", header: "Listing date", size: 170, cell: ({ row }) => fmt.dateTime(row.original.listingDate) },
    { id: "open", header: "", size: 120, enableSorting: false, cell: ({ row }) => <Link className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline" href={`/products/listings?q=${encodeURIComponent(row.original.sku)}`}>Open listings<ExternalLink className="h-3 w-3" /></Link> },
  ];
  return (
    <ReviewShell>
      <Callout variant="info" className="mb-3" title="Why this matters">
        <span className="inline-flex items-center gap-1">Multi listings oversell (each listing gets the full quantity) and SKU differences break order downloads. Fix them in Product Listings.<InfoTip content="Multi Listing: the same KitStaks SKU is linked to several listings on one store. SKU Difference: the store's seller SKU isn't the KitStaks SKU." /></span>
      </Callout>
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search SKU or seller SKU" />
      <DataGrid<ListingExceptionRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} emptyTitle="No listing exceptions" emptyDescription="Duplicate listings and SKU mismatches show here after a product download." />
    </ReviewShell>
  );
}
