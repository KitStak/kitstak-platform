/**
 * Carrier Shipment Details grid (`/shipments`, gridKey `shipments`): one row per package /
 * label. 41 Logiwa columns plus package position; 28 filter fields (Logiwa has 22).
 */
import { LABEL_STATUSES, LABEL_TYPES, SO_STATUSES } from "@/lib/enums";
import { optionsOf, type ShippingField } from "./common";

export const SHIPMENTS_GRID_KEY = "shipments";
export const SHIPMENTS_LIST_PATH = "/api/shipments";

/** Logiwa parity: the page opens on "Label Create Date: Last 30 days". */
export const SHIPMENTS_DEFAULT_FILTER = { field: "labelCreatedAt", param: "f.labelCreatedAt", value: "date:last30d" } as const;

export const SHIPMENT_CURRENCIES = ["USD", "CAD", "EUR", "GBP"] as const;

/** Tracking states the Refresh tracking action records (carrier_call_logs, step Tracking). */
export const TRACKING_STATUSES = ["Label created", "Picked up", "In transit", "Delivered"] as const;

export const SHIPMENT_FIELDS: readonly ShippingField[] = [
  { field: "labelCreatedAt", label: "Label create date", type: "date", group: "Dates" },
  { field: "actualShipmentAt", label: "Actual shipment date", type: "date", group: "Dates" },
  { field: "carrierExpectedDeliveryAt", label: "Carrier expected delivery date", type: "date", group: "Dates" },
  { field: "deliveredAt", label: "Delivery date", type: "date", group: "Dates" },
  { field: "voidedAt", label: "Void date/time", type: "date", group: "Dates" },
  { field: "scheduledPickupAt", label: "Scheduled pickup date", type: "date", group: "Dates" },
  { field: "actualPickupAt", label: "Actual pickup date", type: "date", group: "Dates" },
  { field: "manifestShipDate", label: "Manifest ship date", type: "date", description: "End of the day ship date in the warehouse's time zone", group: "Dates" },
  { field: "orderCode", label: "Order code", type: "text", group: "Order" },
  { field: "orderStatus", label: "Order status", type: "enum", options: optionsOf(SO_STATUSES), group: "Order" },
  { field: "customerName", label: "Customer", type: "text", group: "Order" },
  { field: "clientName", label: "Client", type: "text", facet: "clients", group: "Order" },
  { field: "warehouseCode", label: "Warehouse", type: "text", facet: "warehouses", group: "Order" },
  { field: "locationCode", label: "Location", type: "text", description: "Inventory location the package was packed from", group: "Order" },
  { field: "parentLpNumber", label: "Inventory parent LPN", type: "text", group: "Order" },
  { field: "carrier", label: "Carrier", type: "text", facet: "carriers", group: "Carrier" },
  { field: "carrierPrefix", label: "Carrier account", type: "text", facet: "carrierAccounts", group: "Carrier" },
  { field: "serviceName", label: "Shipment method", type: "text", facet: "services", group: "Carrier" },
  { field: "trackingNumber", label: "Tracking number", type: "text", group: "Carrier" },
  { field: "masterTrackingNumber", label: "Master tracking number", type: "text", group: "Carrier" },
  { field: "zone", label: "Zone", type: "text", group: "Carrier" },
  { field: "isRateShopped", label: "Rate shopping", type: "boolean", group: "Carrier" },
  { field: "labelType", label: "Label type", type: "enum", options: optionsOf(LABEL_TYPES), group: "Label" },
  { field: "labelStatus", label: "Label status", type: "enum", options: optionsOf(LABEL_STATUSES), group: "Label" },
  { field: "isVoided", label: "Voided", type: "boolean", group: "Label" },
  { field: "isReturnLabel", label: "Return label", type: "boolean", group: "Label" },
  { field: "syncedToStore", label: "Sync to store", type: "boolean", group: "Label", description: "Tracking was sent back to the sales channel (Send Shipment Info succeeded for this order)" },
  { field: "hasCarrierError", label: "Carrier errors", type: "boolean", group: "Carrier activity", description: "The carrier returned an error for this package or its order (label, void, tracking or pickup call)" },
  { field: "lastCarrierError", label: "Last carrier error", type: "text", group: "Carrier activity" },
  { field: "trackingStatus", label: "Tracking status", type: "enum", options: optionsOf(TRACKING_STATUSES), group: "Carrier activity", description: "Last Refresh tracking result" },
  { field: "shipmentMailSent", label: "Shipment mail sent", type: "boolean", group: "Customer notification", description: "The customer was emailed the shipment (tracking) notification" },
  { field: "deliveryMailSent", label: "Delivery mail sent", type: "boolean", group: "Customer notification", description: "The customer was emailed the delivery notification" },
  { field: "packageCode", label: "Package", type: "text", description: "Shipment package type code", group: "Package" },
  { field: "weight", label: "Weight", type: "number", decimals: 2, group: "Package" },
  { field: "rate", label: "Rate", type: "number", decimals: 2, group: "Cost" },
  { field: "shippingCost", label: "Shipping cost", type: "number", decimals: 2, group: "Cost" },
  { field: "otherCost", label: "Other cost", type: "number", decimals: 2, group: "Cost" },
  { field: "currency", label: "Currency", type: "enum", options: optionsOf(SHIPMENT_CURRENCIES), group: "Cost" },
];

export const SHIPMENT_SORT_FIELDS = [
  "warehouseCode", "locationCode", "clientName", "orderCode", "orderStatus", "customerName", "labelCreatedAt",
  "carrierExpectedDeliveryAt", "carrier", "serviceName", "isRateShopped", "rateShoppingName", "rate", "labelType",
  "masterTrackingNumber", "trackingNumber", "actualShipmentAt", "deliveredAt", "voidedAt", "insuranceType",
  "insuranceValue", "confirmationType", "weight", "height", "width", "length", "dimensionUnit", "packageCode",
  "weightUnit", "shippingCost", "zone", "otherCost", "currency", "allowSaturdayDelivery", "labelStatus",
  "scheduledPickupAt", "actualPickupAt", "parentLpNumber", "externalReference", "packageSeq", "syncedToStore",
  "hasCarrierError", "lastCarrierError", "trackingStatus", "shipmentMailSentAt", "deliveryMailSentAt",
] as const;

/** Quick search (Equal / Starts With) targets. */
export const SHIPMENT_SEARCH_FIELDS = ["orderCode", "trackingNumber", "masterTrackingNumber", "customerName"] as const;

/** Labels older than this cannot be voided with the carrier (USPS-style window). */
export const CARRIER_VOID_WINDOW_DAYS = 30;

/** Public tracking pages per carrier code (Track row action). */
export const TRACKING_URL_PATTERNS: Readonly<Record<string, string>> = {
  UPS: "https://www.ups.com/track?loc=en_US&tracknum={tracking}",
  USPS: "https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking}",
  FEDEX: "https://www.fedex.com/fedextrack/?trknbr={tracking}",
  DHL: "https://www.dhl.com/us-en/home/tracking/tracking-express.html?tracking-id={tracking}",
  ONTRAC: "https://www.ontrac.com/tracking/?number={tracking}",
};

export function trackingUrl(carrierCode: string | null | undefined, trackingNumber: string | null | undefined): string | null {
  if (!carrierCode || !trackingNumber) return null;
  const pattern = TRACKING_URL_PATTERNS[carrierCode.toUpperCase().replace(/[^A-Z]/g, "")];
  return pattern ? pattern.replace("{tracking}", encodeURIComponent(trackingNumber)) : null;
}

export interface VoidGuardInput {
  readonly labelStatus: string;
  readonly actualShipmentAt: string | null;
  readonly labelCreatedAt: string;
}

/** Why a label can't be voided, or null. Mirrors the server guard (domain + carrier window). */
export function voidBlockReason(row: VoidGuardInput, now: Date = new Date()): string | null {
  if (row.labelStatus === "Voided") return "This label is already voided";
  if (row.actualShipmentAt) return "Labels of shipped packages can't be voided";
  const ageDays = (now.getTime() - new Date(row.labelCreatedAt).getTime()) / 86_400_000;
  if (ageDays > CARRIER_VOID_WINDOW_DAYS) return `Past the ${CARRIER_VOID_WINDOW_DAYS}-day carrier void window`;
  return null;
}

/** "2 labels voided (1 shipment)" — the real package count, master-tracking siblings included. */
export function voidSummary(labels: number, shipments: number): string {
  const l = `${labels} ${labels === 1 ? "label" : "labels"} voided`;
  return labels === shipments ? l : `${l} (${shipments} ${shipments === 1 ? "shipment" : "shipments"})`;
}
