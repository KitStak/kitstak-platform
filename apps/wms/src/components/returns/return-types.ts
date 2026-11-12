/** Client-side shapes for the returns APIs (mirror `src/server/repositories/returns*.ts`). PURE. */
import type { ReturnStatus } from '@/lib/enums';

/** What shipped for a SKU on the order (ledger): offered as lot / date / serial choices at the station. */
export interface ShippedAttributes {
  readonly lots: readonly string[];
  readonly expiryDates: readonly string[];
  readonly productionDates: readonly string[];
  readonly packTypes: readonly string[];
  readonly serials: readonly string[];
}

export interface ReturnLineRow {
  readonly id: string;
  readonly returnOrderId: string;
  readonly rmaCode: string;
  readonly status: ReturnStatus;
  readonly lineStatus: ReturnStatus;
  readonly source: string;
  readonly shipmentOrderId: string | null;
  readonly shipmentOrderCode: string | null;
  readonly storeOrderNumber: string | null;
  readonly store: string | null;
  readonly companyName: string | null;
  readonly returnAddress: string | null;
  readonly fromCountry: string | null;
  readonly requestedQty: number;
  readonly returnedQty: number;
  readonly sku: string;
  readonly productName: string;
  readonly customerName: string | null;
  readonly carrierName: string | null;
  readonly carrierServiceName: string | null;
  readonly trackingNumber: string | null;
  readonly packType: string;
  readonly createdAt: string;
  readonly shipmentOrderDate: string | null;
  readonly deliveryDate: string | null;
  readonly expectedReturnDate: string | null;
  readonly actualReturnDate: string | null;
  readonly createdByName: string;
  readonly warehouseId: string;
  readonly clientId: string;
  readonly warehouseCode: string;
  readonly clientName: string;
  readonly tagNames: string | null;
  readonly disposition: string | null;
  readonly customerReturnReason: string | null;
  readonly actualReturnReason: string | null;
  readonly version: number;
  readonly labelShipmentId: string | null;
  readonly labelFileId: string | null;
  readonly labelStatus: string | null;
}

export interface TransitionOption {
  readonly status: ReturnStatus;
  readonly ok: boolean;
  readonly reason: string | null;
  readonly eligible?: number;
}

export interface SelectionTransitions {
  readonly returns: readonly {
    readonly id: string;
    readonly rmaCode: string;
    readonly status: ReturnStatus;
    readonly lineCount?: number;
    readonly selectedLines?: number | null;
  }[];
  readonly options: readonly TransitionOption[];
}

export interface ReturnDetail {
  readonly id: string;
  readonly rmaCode: string;
  readonly status: ReturnStatus;
  readonly source: string;
  readonly version: number;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName?: string;
  readonly returnAddress?: string | null;
  readonly clientId: string;
  readonly clientName: string;
  readonly customerName: string | null;
  readonly fromCountry: string | null;
  readonly note: string | null;
  readonly createdAt: string;
  readonly createdByName: string;
  readonly createdByEmail?: string | null;
  readonly updatedAt: string;
  readonly expectedReturnDate: string | null;
  readonly actualReturnDate: string | null;
  readonly carrierCode: string | null;
  readonly carrierServiceName: string | null;
  readonly trackingNumber: string | null;
  readonly trackingNumbers?: readonly string[];
  readonly returnShippingCost?: number | null;
  readonly returnAddressId?: string | null;
  readonly order: {
    readonly id: string;
    readonly code: string;
    readonly storeOrderNumber: string | null;
    readonly channel: string;
    readonly status: string;
    readonly orderDate: string;
    readonly shippedAt: string | null;
    readonly deliveredAt: string | null;
    readonly shipTo: string;
  } | null;
  readonly label: {
    readonly shipmentId: string;
    readonly trackingNumber: string;
    readonly labelFileId: string | null;
    readonly labelStatus: string;
    readonly serviceName: string | null;
    readonly carrierCode: string | null;
    readonly shippingCost: number;
    readonly createdAt: string;
  } | null;
  readonly lines: readonly {
    readonly id: string;
    readonly productId: string;
    readonly sku: string;
    readonly name: string;
    readonly imageUrl: string | null;
    readonly packType: string;
    readonly requestedQty: number;
    readonly returnedQty: number;
    readonly lineStatus: ReturnStatus;
    readonly disposition: string | null;
    readonly customerReturnReason: string | null;
    readonly actualReturnReason: string | null;
    readonly shippedQty: number | null;
    readonly trackLot?: boolean;
    readonly trackExpiry?: boolean;
    readonly trackProductionDate?: boolean;
    readonly trackSerial?: boolean;
    readonly shipped?: ShippedAttributes | null;
  }[];
  /** Units requested but not received (> 0 on Completed = short closed). */
  readonly shortQty?: number;
  readonly receipts: readonly {
    readonly id: string;
    readonly receiptNo: number;
    readonly sku: string;
    readonly quantity: number;
    readonly locationCode: string;
    readonly lpNumber: string | null;
    readonly damageReason: string | null;
    readonly actualReturnReason: string | null;
    readonly note: string | null;
    readonly receivedBy: string;
    readonly receivedAt: string;
    readonly cancelledAt: string | null;
  }[];
  readonly receivedQty: number;
  readonly requestedQty: number;
  readonly transitions: readonly TransitionOption[];
  readonly tagIds: readonly string[];
}

export interface CarrierServiceOption {
  readonly id: string;
  readonly name: string;
  readonly serviceCode: string;
  readonly transitDays: number | null;
}

export interface CarrierOption {
  readonly key: string;
  readonly connectionId: string;
  readonly connectionName: string;
  readonly carrierCode: string;
  readonly services: readonly CarrierServiceOption[];
}

export interface ShippableLine {
  readonly orderLineId: string;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly packType: string;
  readonly shippedQty: number;
  readonly alreadyReturned: number;
  readonly returnable: number;
  readonly isNonReturnable: boolean;
}

export interface ShippableOrder {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly warehouseId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly customerName: string;
  readonly storeOrderNumber: string | null;
  readonly shippedAt: string | null;
  readonly deliveredAt: string | null;
  readonly shipTo: string;
  readonly shipCountry: string;
  readonly eligible: boolean;
  readonly reason: string | null;
  readonly lines: readonly ShippableLine[];
  readonly returnAddresses?: readonly ReturnAddressOption[];
  readonly defaultReturnAddressId?: string | null;
}

export interface ReturnAddressOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly owner: 'warehouse' | 'client';
}

/**
 * RMAs where only some lines were selected in the grid: an RMA-level action (status, label,
 * return info) still applies to the whole RMA, so say so ("applies to RMA RMA000322 (2 lines)").
 */
export function partialRmaNotes(returns: SelectionTransitions['returns']): readonly string[] {
  return returns
    .filter(
      (r) =>
        r.selectedLines !== null &&
        r.selectedLines !== undefined &&
        r.lineCount !== undefined &&
        r.selectedLines < r.lineCount,
    )
    .map(
      (r) =>
        `Applies to RMA ${r.rmaCode} (${r.lineCount} line${r.lineCount === 1 ? '' : 's'}), not only the selected line${r.selectedLines === 1 ? '' : 's'}.`,
    );
}

export interface BulkOutcome {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
}

/** "3 of 4 returns updated · 1 failed". */
export function bulkMessage(result: BulkOutcome, verb: string): string {
  const total = result.succeeded.length + result.failed.length;
  const noun = total === 1 ? 'return' : 'returns';
  const base = `${result.succeeded.length} of ${total} ${noun} ${verb}`;
  return result.failed.length > 0
    ? `${base} · ${result.failed.length} failed: ${result.failed[0]?.message ?? ''}`
    : base;
}
