"use client";

/**
 * Carrier Shipment Details (`/shipments`): one row per package / label. Opens on
 * "Label create date: Last 30 days"; row ⋯ View order / Download label / Reprint / Void /
 * Track; bulk Void labels and Reprint labels; package detail drawer on row click.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Download, ExternalLink, Eye, FileBox, PackageSearch, Printer, RefreshCw, ScanBarcode, ScrollText, Undo2, XCircle } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CreateLabelDialog } from "./create-label-dialog";
import { PrintOptionsModal } from "@/components/shared/print-options-modal";
import { fetchPrintRecords } from "@/components/orders/orders-client";
import { SHIPMENTS_GRID_KEY, SHIPMENTS_LIST_PATH, SHIPMENT_FIELDS } from "@/lib/grid-defs/shipping/shipments";
import { toast } from "@/components/ui/toast";
import { DataGrid, GridToolbar, useGrid, type BulkAction, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { useHydratedPermissions, downloadFile, errorMessage, openExternal, openFileWhenReady, postJson, useFilterFields, useSeenRows } from "./shipping-client";
import { SHIPMENT_COLUMNS, SHIPMENT_EXPORT_COLUMNS, type ShipmentRow } from "./shipments-columns";
import { ShipmentDetailDrawer } from "./shipment-detail-drawer";
import { VoidLabelsDialog } from "./void-labels-dialog";
import { ExportHistoryButton } from "./export-history-button";

const PERM = { createLabel: "fulfillment.shipment_orders.create_label", void: "fulfillment.shipment_orders.void_label", reprint: "fulfillment.shipment_orders.reprint_label", returnLabel: "fulfillment.shipment_orders.create_return_label",
  retailer: "fulfillment.shipment_orders.create_retailer_label", retailerReprint: "fulfillment.shipment_orders.reprint_retailer_label", shortLabel: "fulfillment.shipment_orders.pick_pack_short_label" } as const;

interface PrintRequest { readonly typeKeys: readonly string[]; readonly records: readonly unknown[]; readonly title: string }

/** Why a return label can't be created from this package (null when it can). */
export function returnLabelReasonFor(rows: readonly ShipmentRow[]): string | null {
  if (rows.length !== 1) return "Select one package to create a return label";
  const r = rows[0];
  if (r.labelType !== "Shipping Label") return "Pick a shipping label, not a return label";
  if (!r.actualShipmentAt) return "The order hasn't shipped yet";
  if (!r.carrierConnectionId || !r.carrierServiceId) return "This label has no carrier service to reuse";
  return null;
}

interface ReprintResult {
  readonly fileId: string;
  readonly count: number;
  readonly format: "PDF" | "ZPL";
}

/**
 * Logiwa parity: "Label create date: Last 30 days" when the URL carries no grid state. The chip is
 * applied in a layout effect, i.e. before the first client paint (the streaming fallback shows the
 * same chip), and the list does not fetch until it is in place, so there is no flash of an unfiltered
 * scope. A user's default saved view still wins: the grid core applies it once views load.
 */
function useShipmentsGrid(fields: ReturnType<typeof useFilterFields>) {
  const params = useSearchParams();
  const [ready, setReady] = React.useState(() => [...params.keys()].some((k) => k === "q" || k === "sort" || k.startsWith("f.")));
  // Same URL-state instance as the list query, so the chip and the first fetch land in one render.
  const g = useGrid<ShipmentRow>({ gridKey: SHIPMENTS_GRID_KEY, path: ready ? SHIPMENTS_LIST_PATH : null, fields });
  const { grid } = g;
  React.useLayoutEffect(() => {
    if (ready) return;
    grid.setQuery({ filters: [{ field: "labelCreatedAt", op: "date", date: { kind: "fixed", preset: "last30d" } }] });
    // One-shot, before paint: the URL state (external) and the fetch gate change together.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
  }, [ready, grid]);
  return g;
}

export function reprintReasonFor(rows: readonly ShipmentRow[]): string | null {
  if (rows.some((r) => r.labelStatus === "Voided")) return "Voided labels can't be reprinted";
  if (rows.some((r) => !r.labelFileId)) return "A selected package has no stored label file";
  return null;
}

export function ShipmentsPage() {
  const permissions = useHydratedPermissions();
  const fields = useFilterFields(SHIPMENT_FIELDS);
  const g = useShipmentsGrid(fields);
  const selected = useSeenRows(g.rows, g.selectedIds);
  const [voidRows, setVoidRows] = React.useState<readonly ShipmentRow[] | null>(null);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [printing, setPrinting] = React.useState<PrintRequest | null>(null);
  const canVoid = permissions.has(PERM.void);
  const canReprint = permissions.has(PERM.reprint);
  const canCreateLabel = permissions.has(PERM.createLabel);
  const canTrack = canCreateLabel || canReprint;
  const [creating, setCreating] = React.useState(false);
  const errorsOn = g.grid.query.filters.some((f) => f.field === "hasCarrierError");
  const errorCount = useApiQuery<unknown[]>(["grid", "shipments", "carrier-errors"], `${SHIPMENTS_LIST_PATH}?f.hasCarrierError=bool:true&f.labelCreatedAt=date:last30d&pageSize=1`, { staleTime: 30_000, retry: false }).data?.meta?.total;
  const toggleErrors = () => (errorsOn ? g.grid.removeFilter("hasCarrierError") : g.grid.upsertFilter({ field: "hasCarrierError", op: "bool", value: true }));

  const refreshTracking = async (rows: readonly ShipmentRow[]) => {
    try {
      const res = await postJson<{ succeeded: readonly string[]; failed: readonly { id: string; message: string }[]; outcomes: readonly { trackingNumber: string; status: string }[] }>("/api/shipments/tracking", { ids: rows.map((r) => r.id) });
      const first = res.outcomes[0];
      if (res.failed.length === 0) toast.success("Tracking refreshed", rows.length === 1 && first ? `${first.trackingNumber}: ${first.status}` : `${res.succeeded.length} packages updated.`);
      else if (res.succeeded.length > 0) toast.warning(`${res.succeeded.length} of ${rows.length} refreshed`, res.failed[0]?.message ?? "");
      else toast.error("Couldn't refresh tracking", res.failed[0]?.message ?? "");
    } catch (error) {
      toast.error("Couldn't refresh tracking", errorMessage(error));
    }
    g.refetch();
  };

  const refresh = () => {
    g.refetch();
    g.clearSelection();
  };

  const reprint = async (rows: readonly ShipmentRow[]) => {
    try {
      const result = await openFileWhenReady(() => postJson<ReprintResult>("/api/shipments/reprint", { ids: rows.map((r) => r.id) }));
      toast.success("Success", `${result.count} ${result.count === 1 ? "label" : "labels"} ready to print (${result.format}).`);
    } catch (error) {
      toast.error("Couldn't reprint", errorMessage(error));
    }
    g.clearSelection();
  };

  const download = (row: ShipmentRow) => {
    if (row.labelFileId) downloadFile(row.labelFileId);
  };

  const createReturnLabel = async (row: ShipmentRow) => {
    try {
      const result = await postJson<{ readonly trackingNumber?: string }>("/api/ops/shipping/return-label", {
        orderId: row.orderId, carrierConnectionId: row.carrierConnectionId, carrierServiceId: row.carrierServiceId,
        package: { weightOz: Math.max(row.weight, 0.1), length: Math.max(row.length, 1), width: Math.max(row.width, 1), height: Math.max(row.height, 1) },
      });
      toast.success("Return label created", result.trackingNumber ? `Tracking ${result.trackingNumber} for ${row.orderCode}.` : `Return label created for ${row.orderCode}.`);
      refresh();
    } catch (error) {
      toast.error("Couldn't create the return label", errorMessage(error));
    }
  };
  const canReturn = permissions.has(PERM.returnLabel);
  const canRetailer = permissions.has(PERM.retailer);
  const canRetailerReprint = permissions.has(PERM.retailerReprint);
  const canShort = permissions.has(PERM.shortLabel);

  /** Logiwa Print Actions › Create / Reprint Retailer (UCC) Label, one label per case of the order. */
  const retailerLabel = (rows: readonly ShipmentRow[], reprint: boolean) => {
    const codes = [...new Set(rows.map((r) => r.orderCode))];
    setPrinting({ typeKeys: ["retailer-case-label"], records: codes.map((orderCode) => ({ orderCode })), title: reprint ? "Reprint retailer label" : "Create retailer label" });
  };
  const shortLabel = async (rows: readonly ShipmentRow[]) => {
    try {
      const res = await fetchPrintRecords("pick-short-label", [...new Set(rows.map((r) => r.orderId))]);
      if (res.records.length === 0) {
        toast.info("Nothing to print", res.ineligible[0]?.reason ?? "The selected orders have no pick or pack short.");
        return;
      }
      if (res.ineligible.length > 0) toast.info("Some orders skipped", `${res.ineligible.length} skipped: ${res.ineligible[0]?.reason}`);
      setPrinting({ typeKeys: [res.typeKey], records: res.records, title: "Print pick / pack short label" });
    } catch (error) {
      toast.error("Couldn't prepare the short label", errorMessage(error));
    }
  };
  const noPerm = (what: string) => `You don't have permission to ${what}`;

  const rowReprintReason = (row: ShipmentRow): string | null => (!canReprint ? "You don't have permission to reprint labels" : reprintReasonFor([row]));

  const rowActions = (row: ShipmentRow): readonly RowAction[] => [
    { key: "view-order", label: "View order", icon: Eye, href: `/orders/${encodeURIComponent(row.orderCode)}` },
    { key: "details", label: "Package details", icon: ScrollText, onSelect: () => setDetailId(row.id) },
    { key: "download", label: "Download label", icon: Download, disabledReason: rowReprintReason(row), onSelect: () => download(row) },
    { key: "reprint", label: "Reprint", icon: Printer, disabledReason: rowReprintReason(row), onSelect: () => void reprint([row]) },
    { key: "return-label", label: "Create return label", icon: Undo2, disabledReason: !canReturn ? "You don't have permission to create labels" : returnLabelReasonFor([row]), onSelect: () => void createReturnLabel(row) },
    { key: "retailer-label", label: "Create retailer (UCC) label", icon: FileBox, disabledReason: canRetailer ? null : noPerm("create retailer labels"), onSelect: () => retailerLabel([row], false) },
    { key: "retailer-reprint", label: "Reprint retailer (UCC) label", icon: FileBox, disabledReason: canRetailerReprint ? null : noPerm("reprint retailer labels"), onSelect: () => retailerLabel([row], true) },
    { key: "short-label", label: "Pick / pack short label", icon: ScanBarcode, disabledReason: canShort ? null : noPerm("print short labels"), onSelect: () => void shortLabel([row]) },
    { key: "refresh-tracking", label: "Refresh tracking", icon: RefreshCw, disabledReason: !canTrack ? noPerm("refresh tracking") : row.labelStatus === "Voided" ? "Voided labels have no tracking" : null, onSelect: () => void refreshTracking([row]) },
    { key: "track", label: "Track", icon: ExternalLink, disabledReason: row.trackingUrl ? null : "No public tracking page for this carrier", onSelect: () => { if (row.trackingUrl) openExternal(row.trackingUrl); } },
    { key: "void", label: "Void label", icon: XCircle, destructive: true, disabledReason: !canVoid ? "You don't have permission to void labels" : row.voidBlockedReason, onSelect: () => setVoidRows([row]) },
  ];

  // Mutation controls are hidden for roles without the permission; the destructive (red) style
  // only applies once something is selected, so an idle toolbar reads neutral.
  const bulkActions: readonly BulkAction[] = [
    ...(canVoid ? [{
      key: "void", label: "Void labels", icon: XCircle, destructive: selected.length > 0 && !selected.some((r) => r.voidBlockedReason), emptyReason: "Select at least one label",
      eligibility: () => selected.find((r) => r.voidBlockedReason)?.voidBlockedReason ?? null,
      onSelect: () => setVoidRows(selected),
    } satisfies BulkAction] : []),
    ...(canTrack ? [{
      key: "refresh-tracking", label: "Refresh tracking", icon: RefreshCw, emptyReason: "Select at least one label",
      eligibility: () => (selected.every((r) => r.labelStatus === "Voided") ? "Voided labels have no tracking" : null),
      onSelect: () => void refreshTracking(selected.filter((r) => r.labelStatus !== "Voided")),
    } satisfies BulkAction] : []),
    ...(canReprint ? [{
      key: "reprint", label: "Reprint labels", icon: Printer, emptyReason: "Select at least one label",
      eligibility: () => reprintReasonFor(selected),
      onSelect: () => void reprint(selected),
    } satisfies BulkAction] : []),
    ...(canReturn ? [{
      key: "return-label", label: "Create return label", icon: Undo2, emptyReason: "Select one shipped package",
      eligibility: () => returnLabelReasonFor(selected),
      onSelect: () => { const r = selected[0]; if (r) void createReturnLabel(r); },
    } satisfies BulkAction] : []),
    ...(canRetailer ? [{
      key: "retailer-label", label: "Retailer label", icon: FileBox, emptyReason: "Select at least one package", eligibility: () => null,
      onSelect: () => retailerLabel(selected, false),
    } satisfies BulkAction] : []),
    ...(canShort ? [{
      key: "short-label", label: "Short label", icon: ScanBarcode, emptyReason: "Select at least one package", eligibility: () => null,
      onSelect: () => void shortLabel(selected),
    } satisfies BulkAction] : []),
  ];

  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Carrier Shipment Details" helper="Every label and package your carriers created — track, reprint or void them in one place." tabs="shipments" />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Order code, tracking or master tracking, customer" onRefresh={refresh} bulkActions={bulkActions} selectedIds={g.selectedIds} bulkNoun="label" trailing={(
        <span className="flex items-center gap-2">
          <button type="button" aria-pressed={errorsOn} onClick={toggleErrors} data-testid="carrier-errors-filter"
            className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
              errorsOn ? "border-primary bg-primary text-white" : typeof errorCount === "number" && errorCount > 0 ? "border-danger/40 bg-danger-soft text-danger hover:brightness-95" : "border-border bg-surface text-body hover:bg-surface-sunken")}>
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />Carrier errors{typeof errorCount === "number" ? <span className="tabular-nums">{errorCount}</span> : null}
          </button>
          {canCreateLabel ? <Button size="sm" onClick={() => setCreating(true)} data-testid="create-label"><ScanBarcode className="h-3.5 w-3.5" aria-hidden />Create label</Button> : null}
          <ExportHistoryButton gridKey="shipments" />
        </span>
      )} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<ShipmentRow>
          {...g.gridProps}
          columns={SHIPMENT_COLUMNS}
          exportColumns={SHIPMENT_EXPORT_COLUMNS}
          getRowId={(r) => r.id}
          rowActions={rowActions}
          onRowClick={(r) => setDetailId(r.id)}
          emptyTitle={hasState ? "No labels match this view" : "No carrier labels yet"}
          emptyDescription={hasState ? "Widen the label create date or clear the filters." : "Labels appear here as soon as an order gets a carrier label from the packing station or the order screen."}
          emptyAction={hasState ? undefined : canCreateLabel ? <Button size="sm" onClick={() => setCreating(true)}><PackageSearch className="h-3.5 w-3.5" aria-hidden />Create label</Button> : undefined}
        />
      </div>
      <ShipmentDetailDrawer id={detailId} onClose={() => setDetailId(null)} actions={{ canVoid, canReprint, canTrack, onDownload: download, onReprint: (r) => void reprint([r]), onVoid: (r) => setVoidRows([r]), onRefreshTracking: (r) => refreshTracking([r]) }} />
      <CreateLabelDialog open={creating} onOpenChange={setCreating} onDone={() => { g.refetch(); }} />
      <VoidLabelsDialog ids={voidRows ? voidRows.map((r) => r.id) : null} onClose={() => setVoidRows(null)} onVoided={() => { refresh(); setDetailId(null); }} />
      {printing ? <PrintOptionsModal open onOpenChange={(o) => { if (!o) setPrinting(null); }} typeKeys={printing.typeKeys} records={printing.records} title={printing.title} clientId={null} /> : null}
      <span className="sr-only" aria-live="polite">{g.isFetching ? "Loading labels" : `${g.total} labels`}</span>
    </div>
  );
}
