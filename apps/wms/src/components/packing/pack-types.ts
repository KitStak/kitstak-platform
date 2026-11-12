/** Client shapes of the packing APIs (mirror `src/server/repositories/packing*.ts`). PURE. */
import type { CarrierOption } from '@/components/returns/return-types';
import type { PackDraftSnapshot, PackLine, PackPackageType } from './pack-model';
import type { PackWarningInfo } from './pack-warning-model';

export const PACK_MODES = ['tote', 'location', 'order', 'putwall'] as const;
export type PackMode = (typeof PACK_MODES)[number];

export const MODE_LABELS: Readonly<
  Record<PackMode, { readonly tab: string; readonly scan: string; readonly placeholder: string }>
> = {
  tote: { tab: 'Tote', scan: 'Scan tote', placeholder: 'Tote / LP number' },
  location: { tab: 'Location', scan: 'Scan location', placeholder: 'Location code or barcode' },
  order: { tab: 'Order', scan: 'Scan order', placeholder: 'Order code, store order # or tracking' },
  putwall: { tab: 'Putwall', scan: 'Scan putwall / mobile cart', placeholder: 'Putwall or cart code' },
};

/** URL aliases for a pack mode ("list" → order list, "cart" / "mobile-cart" → putwall); anything else → tote. */
export function canonicalPackMode(v: string): PackMode {
  const k = v.trim().toLowerCase();
  if (isPackMode(k)) return k;
  if (k === 'list' || k === 'orders' || k === 'select') return 'order';
  if (k === 'cart' || k === 'mobile-cart' || k === 'mobilecart' || k === 'wall') return 'putwall';
  if (k === 'loc') return 'location';
  return 'tote';
}

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
  readonly countLock?: CountLockSummary | null;
}

/** Count-plan lock that would stop Complete Packing (station or the staged stock). */
export interface CountLockSummary {
  readonly planCode: string;
  readonly planId?: string | null;
  readonly locationCode: string;
  readonly reason: string;
}

export interface ScanResponse {
  readonly mode: PackMode;
  readonly code: string;
  readonly sourceLabel: string;
  readonly job: { readonly id: string; readonly code: string; readonly jobType: string } | null;
  readonly orders: readonly PackOrderSummary[];
  readonly totalOrders: number;
  readonly packedOrders: number;
  /** Order mode only: the scanned order exists but cannot be packed, and why. */
  readonly blocked?: {
    readonly orderId: string;
    readonly orderCode: string;
    readonly status: string;
    readonly message: string;
  };
}

/** `GET /api/packing/scan` expected miss (200, no console error). */
export interface ScanMissResponse {
  readonly miss: {
    readonly code: string;
    readonly message: string;
    readonly kind: 'NOT_FOUND' | 'INVALID_STATE';
    readonly orderId?: string;
    readonly orderCode?: string;
  };
}

export function isScanMiss(r: ScanResponse | ScanMissResponse): r is ScanMissResponse {
  return 'miss' in r && Boolean((r as ScanMissResponse).miss);
}

export interface PackContext {
  readonly order: {
    readonly id: string;
    readonly code: string;
    readonly status: string;
    readonly version: number;
    readonly warehouseId: string;
    readonly clientId: string;
    readonly clientName: string;
    readonly customerName: string;
    readonly storeOrderNumber: string | null;
    readonly channel: string;
    /** Retailer (B2B): enables Create / Reprint Retailer Label. */
    readonly retailerName?: string | null;
    readonly retailerLabelPrinted?: boolean;
    readonly shipTo: string;
    readonly isAutoShip: boolean;
    readonly packShortStatus: string;
    readonly packingInstructions: string | null;
    readonly giftNote: string | null;
    readonly carrierServiceId: string | null;
    readonly carrierConnectionId: string | null;
    readonly defaultPackageId: string | null;
    readonly jobCode: string | null;
    readonly priority: string;
  };
  readonly lines: readonly PackLine[];
  readonly packages: readonly PackPackageType[];
  readonly carriers: readonly CarrierOption[];
  readonly settings: {
    readonly disablePackingWithoutLabel?: boolean;
    readonly disallowMultipleShipmentPackages?: boolean;
    readonly [k: string]: unknown;
  };
  readonly activeLabels: readonly { readonly trackingNumber: string; readonly labelFileId: string | null }[];
  readonly hospitalLocationId: string | null;
  /** Default hospital (code shown before the Report Issue option list loads). */
  readonly hospital?: {
    readonly id: string;
    readonly code: string;
    readonly detail: string;
    readonly isDefault: boolean;
  } | null;
  /** Packing Warning Type of the order (Data Setup), shown at its trigger. */
  readonly packingWarning?: PackWarningInfo | null;
  /** Count-plan lock on the station or staged stock: packing is blocked before any scan. */
  readonly countLock?: CountLockSummary | null;
  /** In-progress pack state saved on the server; the screen resumes from it. */
  readonly draft?: {
    readonly state: PackDraftSnapshot;
    readonly stationId: string | null;
    readonly updatedAt: string;
    readonly updatedByName: string | null;
  } | null;
}

export interface CompleteResult {
  readonly orderId: string;
  readonly orderCode: string;
  readonly status: string;
  readonly packedUnits: number;
  readonly shipments: readonly {
    readonly trackingNumber: string;
    readonly masterTrackingNumber: string | null;
    readonly labelFileId: string | null;
    readonly packageSeq: number;
    readonly shippingCost: number;
  }[];
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
  readonly countLock?: CountLockSummary | null;
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
