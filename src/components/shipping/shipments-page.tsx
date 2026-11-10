"use client";

/**
 * Carrier Shipment Details (`/shipments`): one row per package / label. Opens on
 * "Label create date: Last 30 days"; row ⋯ View order / Download label / Reprint / Void /
 * Track; bulk Void labels and Reprint labels; package detail drawer on row click.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Download, ExternalLink, Eye, PackageSearch, Printer, ScrollText, XCircle } from "lucide-react";
import { SHIPMENTS_GRID_KEY, SHIPMENTS_LIST_PATH, SHIPMENT_FIELDS } from "@/lib/grid-defs/shipping/shipments";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { DataGrid, GridToolbar, useGrid, type BulkAction, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { formatDateTime } from "@/lib/format";
import { bulkToast, useHydratedPermissions, downloadFile, errorMessage, openExternal, openFileWhenReady, postJson, useFilterFields, useSeenRows, type BulkOutcome } from "./shipping-client";
import { SHIPMENT_COLUMNS, SHIPMENT_EXPORT_COLUMNS, type ShipmentRow } from "./shipments-columns";
import { ShipmentDetailDrawer } from "./shipment-detail-drawer";
import { LabelStatusPill } from "./column-kit";

const PERM = { void: "fulfillment.shipment_orders.void_label", reprint: "fulfillment.shipment_orders.reprint_label" } as const;

interface ReprintResult {
  readonly fileId: string;
  readonly count: number;
  readonly format: "PDF" | "ZPL";
}

/** Logiwa parity: "Label create date: Last 30 days" when the URL carries no grid state. */
function useDefaultChip(g: ReturnType<typeof useGrid<ShipmentRow>>): void {
  const params = useSearchParams();
  const applied = React.useRef(false);
  React.useEffect(() => {
    if (applied.current || g.views.isLoading) return;
    applied.current = true;
    const hasGridState = [...params.keys()].some((k) => k === "q" || k === "sort" || k.startsWith("f."));
    if (!hasGridState && !g.views.views.some((v) => v.isDefault)) {
      g.grid.setQuery({ filters: [{ field: "labelCreatedAt", op: "date", date: { kind: "fixed", preset: "last30d" } }] });
    }
  }, [g.views.isLoading, g.views.views, g.grid, params]);
}

export function reprintReasonFor(rows: readonly ShipmentRow[]): string | null {
  if (rows.some((r) => r.labelStatus === "Voided")) return "Voided labels can't be reprinted";
  if (rows.some((r) => !r.labelFileId)) return "A selected package has no stored label file";
  return null;
}

export function ShipmentsPage() {
  const permissions = useHydratedPermissions();
  const fields = useFilterFields(SHIPMENT_FIELDS);
  const g = useGrid<ShipmentRow>({ gridKey: SHIPMENTS_GRID_KEY, path: SHIPMENTS_LIST_PATH, fields });
  useDefaultChip(g);
  const selected = useSeenRows(g.rows, g.selectedIds);
  const [voidRows, setVoidRows] = React.useState<readonly ShipmentRow[] | null>(null);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const canVoid = permissions.has(PERM.void);
  const canReprint = permissions.has(PERM.reprint);

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
  };

  const download = (row: ShipmentRow) => {
    if (row.labelFileId) downloadFile(row.labelFileId);
  };

  const rowReprintReason = (row: ShipmentRow): string | null => (!canReprint ? "You don't have permission to reprint labels" : reprintReasonFor([row]));

  const rowActions = (row: ShipmentRow): readonly RowAction[] => [
    { key: "view-order", label: "View order", icon: Eye, href: `/orders/${encodeURIComponent(row.orderCode)}` },
    { key: "details", label: "Package details", icon: ScrollText, onSelect: () => setDetailId(row.id) },
    { key: "download", label: "Download label", icon: Download, disabledReason: rowReprintReason(row), onSelect: () => download(row) },
    { key: "reprint", label: "Reprint", icon: Printer, disabledReason: rowReprintReason(row), onSelect: () => void reprint([row]) },
    { key: "track", label: "Track", icon: ExternalLink, disabledReason: row.trackingUrl ? null : "No public tracking page for this carrier", onSelect: () => { if (row.trackingUrl) openExternal(row.trackingUrl); } },
    { key: "void", label: "Void label", icon: XCircle, destructive: true, disabledReason: !canVoid ? "You don't have permission to void labels" : row.voidBlockedReason, onSelect: () => setVoidRows([row]) },
  ];

  const bulkActions: readonly BulkAction[] = [
    {
      key: "void", label: "Void labels", icon: XCircle, destructive: true, emptyReason: "Select at least one label",
      disabledReason: canVoid ? null : "You don't have permission to void labels",
      eligibility: () => selected.find((r) => r.voidBlockedReason)?.voidBlockedReason ?? null,
      onSelect: () => setVoidRows(selected),
    },
    {
      key: "reprint", label: "Reprint labels", icon: Printer, emptyReason: "Select at least one label",
      disabledReason: canReprint ? null : "You don't have permission to reprint labels",
      eligibility: () => reprintReasonFor(selected),
      onSelect: () => void reprint(selected),
    },
  ];

  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Carrier shipment details" helper="Every label and package your carriers created — track, reprint or void them in one place." tabs="shipments" />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Order code, tracking or master tracking, customer" onRefresh={refresh} bulkActions={bulkActions} selectedIds={g.selectedIds} bulkNoun="label" />
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
          emptyAction={hasState ? undefined : <span className="inline-flex items-center gap-1 text-[12px] text-secondary"><PackageSearch className="h-3.5 w-3.5" aria-hidden />Create a label from Shipment orders → Label → Create label.</span>}
        />
      </div>
      <ShipmentDetailDrawer id={detailId} onClose={() => setDetailId(null)} actions={{ canVoid, canReprint, onDownload: download, onReprint: (r) => void reprint([r]), onVoid: (r) => setVoidRows([r]) }} />
      <ConfirmDialog
        open={voidRows !== null}
        onOpenChange={(o) => (o ? undefined : setVoidRows(null))}
        variant="danger"
        icon={XCircle}
        title={voidRows && voidRows.length > 1 ? `Void ${voidRows.length} labels?` : "Void this label?"}
        description="The carrier cancels the label and the package leaves today's end of the day manifest. Multi-package shipments are voided together. This can't be undone."
        records={voidRows ? {
          columns: [{ key: "order", label: "Order" }, { key: "tracking", label: "Tracking number" }, { key: "carrier", label: "Carrier" }, { key: "created", label: "Label created" }, { key: "status", label: "Status" }],
          rows: voidRows.map((r) => ({ order: r.orderCode, tracking: r.trackingNumber, carrier: r.carrier, created: formatDateTime(r.labelCreatedAt), status: <LabelStatusPill status={r.labelStatus} /> })),
        } : undefined}
        cancelLabel="No"
        confirmLabel="Yes, void"
        onConfirm={async () => {
          const rows = voidRows ?? [];
          try {
            const result = await postJson<BulkOutcome>("/api/shipments/void", { ids: rows.map((r) => r.id) });
            bulkToast(result, "voided", ["label", "labels"], new Map(rows.map((r) => [r.id, r.trackingNumber])));
            refresh();
            setDetailId(null);
          } catch (error) {
            toast.error("Void failed", errorMessage(error));
          }
        }}
      />
      <span className="sr-only" aria-live="polite">{g.isFetching ? "Loading labels" : `${g.total} labels`}</span>
    </div>
  );
}
