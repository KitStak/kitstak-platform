/** Client shapes of the packing APIs (mirror `src/server/repositories/packing*.ts`). PURE. */
import type { CarrierOption } from "@/components/returns/return-types";
import type { PackLine, PackPackageType } from "./pack-model";

export const PACK_MODES = ["tote", "location", "order", "putwall"] as const;
export type PackMode = (typeof PACK_MODES)[number];

export const MODE_LABELS: Readonly<Record<PackMode, { readonly tab: string; readonly scan: string; readonly placeholder: string }>> = {
  tote: { tab: "Tote", scan: "Scan tote", placeholder: "Tote / LP number" },
  location: { tab: "Location", scan: "Scan location", placeholder: "Location code or barcode" },
  order: { tab: "Order", scan: "Scan order", placeholder: "Order code, store order # or tracking" },
  putwall: { tab: "Putwall", scan: "Scan putwall / mobile cart", placeholder: "Putwall or cart code" },
};

export function isPackMode(v: string): v is PackMode {
  return (PACK_MODES as readonly string[]).includes(v);
}

export interface PackOrderSummary {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly clientName: string;
  readonly customerName: string;
  readonly unitsToPack: number;
  readonly packable: boolean;
  readonly packShortStatus: string;
}

export interface ScanResponse {
  readonly mode: PackMode;
  readonly code: string;
  readonly sourceLabel: string;
  readonly job: { readonly id: string; readonly code: string; readonly jobType: string } | null;
  readonly orders: readonly PackOrderSummary[];
  readonly totalOrders: number;
  readonly packedOrders: number;
}

export interface PackContext {
  readonly order: {
    readonly id: string; readonly code: string; readonly status: string; readonly version: number; readonly warehouseId: string; readonly clientId: string;
    readonly clientName: string; readonly customerName: string; readonly storeOrderNumber: string | null; readonly channel: string;
    readonly shipTo: string; readonly isAutoShip: boolean; readonly packShortStatus: string; readonly packingInstructions: string | null;
    readonly giftNote: string | null; readonly carrierServiceId: string | null; readonly carrierConnectionId: string | null;
    readonly defaultPackageId: string | null; readonly jobCode: string | null; readonly priority: string;
  };
  readonly lines: readonly PackLine[];
  readonly packages: readonly PackPackageType[];
  readonly carriers: readonly CarrierOption[];
  readonly settings: { readonly disablePackingWithoutLabel?: boolean; readonly disallowMultipleShipmentPackages?: boolean; readonly [k: string]: unknown };
  readonly activeLabels: readonly { readonly trackingNumber: string; readonly labelFileId: string | null }[];
  readonly hospitalLocationId: string | null;
}

export interface CompleteResult {
  readonly orderId: string;
  readonly orderCode: string;
  readonly status: string;
  readonly packedUnits: number;
  readonly shipments: readonly { readonly trackingNumber: string; readonly masterTrackingNumber: string | null; readonly labelFileId: string | null; readonly packageSeq: number; readonly shippingCost: number }[];
  readonly masterTrackingNumber: string | null;
  readonly packingSlipFileId: string | null;
  readonly labelError: string | null;
  readonly shipped: boolean;
  readonly warnings: readonly string[];
}

export interface ReadyOrderRow {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly clientName: string;
  readonly customerName: string;
  readonly jobCode: string | null;
  readonly expectedShipDate: string | null;
  readonly note: string | null;
  readonly unitsToPack: number;
  readonly priority: string;
}

export interface RateQuote {
  readonly carrierServiceId: string;
  readonly serviceName: string;
  readonly carrierCode: string;
  readonly price: number;
  readonly amount: number;
  readonly currency: string;
  readonly transitDays: number;
  readonly carrierConnectionId: string;
}
