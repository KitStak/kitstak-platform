/** Client-side shapes for the returns APIs (mirror `src/server/repositories/returns*.ts`). PURE. */
import type { ReturnStatus } from "@/lib/enums";

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
  readonly warehouseCode: string;
  readonly clientName: string;
  readonly tagNames: string | null;
  readonly disposition: string | null;
  readonly customerReturnReason: string | null;
  readonly actualReturnReason: string | null;
  readonly version: number;
}

export interface TransitionOption {
  readonly status: ReturnStatus;
  readonly ok: boolean;
  readonly reason: string | null;
  readonly eligible?: number;
}

export interface SelectionTransitions {
  readonly returns: readonly { readonly id: string; readonly rmaCode: string; readonly status: ReturnStatus }[];
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
  readonly clientId: string;
  readonly clientName: string;
  readonly customerName: string | null;
  readonly fromCountry: string | null;
  readonly note: string | null;
  readonly createdAt: string;
  readonly createdByName: string;
  readonly updatedAt: string;
  readonly expectedReturnDate: string | null;
  readonly actualReturnDate: string | null;
  readonly carrierCode: string | null;
  readonly carrierServiceName: string | null;
  readonly trackingNumber: string | null;
  readonly order: { readonly id: string; readonly code: string; readonly storeOrderNumber: string | null; readonly channel: string; readonly status: string; readonly orderDate: string; readonly shippedAt: string | null; readonly deliveredAt: string | null; readonly shipTo: string } | null;
  readonly label: { readonly shipmentId: string; readonly trackingNumber: string; readonly labelFileId: string | null; readonly labelStatus: string; readonly serviceName: string | null; readonly carrierCode: string | null; readonly shippingCost: number; readonly createdAt: string } | null;
  readonly lines: readonly {
    readonly id: string; readonly productId: string; readonly sku: string; readonly name: string; readonly imageUrl: string | null; readonly packType: string;
    readonly requestedQty: number; readonly returnedQty: number; readonly lineStatus: ReturnStatus; readonly disposition: string | null;
    readonly customerReturnReason: string | null; readonly actualReturnReason: string | null; readonly shippedQty: number | null;
  }[];
  readonly receipts: readonly {
    readonly id: string; readonly receiptNo: number; readonly sku: string; readonly quantity: number; readonly locationCode: string; readonly lpNumber: string | null;
    readonly damageReason: string | null; readonly actualReturnReason: string | null; readonly note: string | null; readonly receivedBy: string; readonly receivedAt: string; readonly cancelledAt: string | null;
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
}

export interface BulkOutcome {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
}

/** "3 of 4 returns updated · 1 failed". */
export function bulkMessage(result: BulkOutcome, verb: string): string {
  const total = result.succeeded.length + result.failed.length;
  const noun = total === 1 ? "return" : "returns";
  const base = `${result.succeeded.length} of ${total} ${noun} ${verb}`;
  return result.failed.length > 0 ? `${base} · ${result.failed.length} failed: ${result.failed[0]?.message ?? ""}` : base;
}
