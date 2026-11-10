/** Client-side row and API types for Inventory by Location. */
export interface BucketRow {
  readonly id: string;
  readonly version: number;
  readonly imageUrl: string | null;
  readonly productId: string;
  readonly clientId: string;
  readonly client: string;
  readonly sku: string;
  readonly barcode: string;
  readonly productName: string;
  readonly unitsPerPack: number;
  readonly totalPackQty: number;
  readonly allocatedPackQty: number;
  readonly allocatedQty: number;
  readonly freePackQty: number;
  readonly freeQty: number;
  readonly packType: string;
  readonly uomPackType: string;
  readonly totalQty: number;
  readonly damagedQty: number;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productType: string | null;
  readonly productGroup: string | null;
  readonly warehouseId: string;
  readonly warehouse: string;
  readonly warehouseCode: string;
  readonly locationId: string;
  readonly location: string;
  readonly locationGroup: string | null;
  readonly locationZone: string | null;
  readonly locationType: string | null;
  readonly areaType: string | null;
  readonly replenishmentType: string | null;
  readonly walkingPathPriority: number;
  readonly poNumber: string | null;
  readonly lpId: string | null;
  readonly lpNumber: string | null;
  readonly parentLpNumber: string | null;
  readonly originalLpNumber: string | null;
  readonly lpType: string | null;
  readonly parentLpType: string | null;
  readonly originalParentLpNumber: string | null;
  readonly mobileCart: string | null;
  readonly status: string;
  readonly damageReason: string | null;
  readonly receivedAt: string;
  readonly productionDate: string | null;
  readonly trackLot: number;
  readonly trackExpiry: number;
  readonly trackProductionDate: number;
}

export interface BucketAllocation {
  readonly id: string;
  readonly qty: number;
  readonly status: string;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly jobId: string | null;
  readonly jobCode: string | null;
  readonly workOrderId: string | null;
  readonly workOrderCode: string | null;
  readonly createdAt: string;
}

export interface BucketTransaction {
  readonly id: string;
  readonly seq: number;
  readonly type: string;
  readonly qty: number;
  readonly direction: "in" | "out" | "adjust" | "neutral";
  readonly fromLocation: string | null;
  readonly toLocation: string | null;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly reason: string | null;
  readonly note: string | null;
  readonly orderCode: string | null;
  readonly jobCode: string | null;
  readonly user: string | null;
  readonly source: string;
  readonly at: string;
}

export interface BucketDetail {
  readonly bucket: BucketRow;
  readonly allocations: readonly BucketAllocation[];
  readonly transactions: readonly BucketTransaction[];
}

export interface MovedLine {
  readonly sku: string;
  readonly qty: number;
  readonly from: string;
  readonly to: string;
}

export interface TransferResult {
  readonly moved: readonly MovedLine[];
  readonly totalQty: number;
}

export interface BulkResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
}

export type QuantityMode = "add" | "adjust" | "remove";
export type AttributeKey = "lotNumber" | "expiryDate" | "productionDate" | "damageReason";

export const ATTRIBUTE_COPY: Readonly<Record<AttributeKey, { title: string; label: string; attention: string; placeholder: string }>> = {
  lotNumber: { title: "Change Lot/Batch Number", label: "Lot/Batch Number", placeholder: "Enter lot/batch number", attention: "All inventory lot/batch numbers that you have selected will be updated with the new one." },
  expiryDate: { title: "Change Expiry Date", label: "Expiry Date", placeholder: "Enter date", attention: "All inventory expiry dates that you have selected will be updated with the new one." },
  productionDate: { title: "Change Production Date", label: "Production Date", placeholder: "Enter date", attention: "All inventory production dates that you have selected will be updated with the new one." },
  damageReason: { title: "Change Damage Reason", label: "Damage Reason", placeholder: "No damage reason", attention: "All inventory damage reasons which you have selected will be updated with the new one." },
};

/** Why a row has no ⋯ menu (Allocated / Picked / Packed … rows). */
export function lockedReason(row: Pick<BucketRow, "status">): string | null {
  if (row.status === "Stock") return null;
  return `${row.status} stock belongs to an order in progress. Add, Adjust and Remove are only available on Stock rows.`;
}
