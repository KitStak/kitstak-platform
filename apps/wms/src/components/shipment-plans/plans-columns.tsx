"use client";

/** Shipment Plan grid columns: the 15 Logiwa columns plus client, orders and loading progress. */
import type { ShipmentPlanStatus } from "@/lib/enums";
import { LinkCell } from "@/components/grid/cells";
import { ProgressBar } from "@/components/ui/progress-bar";
import { buildColumns, exportColumnsOf, type ColumnSpec } from "@/components/shipping/column-kit";
import { PlanStatusPopover, type PlanStatusExtra } from "./plan-status-popover";
import { PlanInlineCell, type InlineField } from "./plan-inline-cell";
import type { PlanRow } from "./plans-client";

export interface PlanColumnHandlers {
  readonly statusDisabledReason: (row: PlanRow) => string | null;
  readonly onStatus: (row: PlanRow, status: ShipmentPlanStatus) => void;
  /** False hides the change-status icon (the user lacks change_status). */
  readonly canChangeStatus?: boolean;
  /** Inline edit of truck plate, gate and loading times (needs edit permission). */
  readonly canEdit?: boolean;
  readonly onInlineSaved?: () => void;
  /** Extra popover step for a row (Truck departed). */
  readonly extrasFor?: (row: PlanRow) => PlanStatusExtra | null;
}

export const planHref = (row: Pick<PlanRow, "id">): string => `/shipment-plans/${encodeURIComponent(row.id)}`;

export function planColumnSpecs(h: PlanColumnHandlers): readonly ColumnSpec<PlanRow>[] {
  const inline = (field: InlineField) => (r: PlanRow) => <PlanInlineCell row={r} field={field} canEdit={Boolean(h.canEdit)} onSaved={h.onInlineSaved ?? (() => undefined)} />;
  return [
    { id: "code", label: "Plan code", width: 170, minWidth: 120, always: true, cell: (r) => <span className="block min-w-0 truncate" title={r.code}><LinkCell href={planHref(r)}>{r.code}</LinkCell></span> },
    { id: "status", label: "Status", width: 190, minWidth: 150, exportKey: "status", cell: (r) => <PlanStatusPopover status={r.status} nextStatuses={r.nextStatuses} disabledReason={h.statusDisabledReason(r)} canChange={h.canChangeStatus ?? true} blocked={r.statusBlocks} extras={h.extrasFor ? [h.extrasFor(r)].filter((x): x is PlanStatusExtra => x !== null) : []} onPick={(s) => h.onStatus(r, s)} /> },
    { id: "warehouseCode", label: "Warehouse", width: 120 },
    { id: "clientName", label: "Client", width: 150 },
    { id: "customerName", label: "Customer", width: 160 },
    { id: "customerAddress", label: "Customer address", width: 220 },
    { id: "createdAt", label: "Created date", kind: "datetime" },
    { id: "plannedShipmentAt", label: "Planned shipment date", kind: "datetime" },
    { id: "actualShipmentAt", label: "Actual shipment date", kind: "datetime" },
    { id: "carrierName", label: "Carrier", width: 170 },
    { id: "truckPlateNumber", label: "Truck plate number", width: 150, exportKey: "truckPlateNumber", cell: inline("truckPlateNumber") },
    { id: "loadingGate", label: "Loading gate", width: 140, exportKey: "loadingGate", cell: inline("loadingGateLocationId") },
    { id: "retailerName", label: "Retailer", width: 140 },
    { id: "loadingStartedAt", label: "Loading start date", kind: "datetime", width: 190, exportKey: "loadingStartedAt", cell: inline("loadingStartedAt") },
    { id: "loadingCompletedAt", label: "Loading complete date", kind: "datetime", width: 200, exportKey: "loadingCompletedAt", cell: inline("loadingCompletedAt") },
    { id: "truckDepartedAt", label: "Truck depart date", kind: "datetime", width: 190, exportKey: "truckDepartedAt", cell: inline("truckDepartedAt") },
    { id: "orderCount", label: "Orders", kind: "integer", width: 84 },
    {
      id: "loadedPercent", label: "Loaded", width: 150, exportKey: "loadedPercent",
      cell: (r) => (
        <span className="flex w-full items-center gap-2" title={`${r.loadedCount} of ${r.orderCount} orders ready to ship or shipped`}>
          <ProgressBar value={r.loadedPercent} size="sm" tone={r.loadedPercent === 100 ? "success" : "primary"} className="flex-1" label={`${r.loadedPercent}% loaded`} />
          <span className="w-9 text-right text-2xs tabular-nums text-secondary">{r.loadedPercent}%</span>
        </span>
      ),
    },
  ];
}

export const planColumns = (h: PlanColumnHandlers) => buildColumns(planColumnSpecs(h));
export const PLAN_EXPORT_COLUMNS = exportColumnsOf(planColumnSpecs({ statusDisabledReason: () => null, onStatus: () => undefined }));
