/**
 * Return Orders grid (BUILD_PLAN M04 §6): one row per RMA line. Pure TS shared by the
 * client filter builder, the `/api/returns` grid-grammar path and the export provider.
 * Keys are the `f.<field>` / `sort=<field>` names.
 */
import { ORDER_CHANNELS, RETURN_DISPOSITIONS, RETURN_SOURCES, RETURN_STATUSES } from "@/lib/enums";

export const RETURN_ORDERS_GRID_KEY = "return-orders";

export type ReturnGridFieldType = "enum" | "text" | "number" | "date";

export interface ReturnGridField {
  readonly field: string;
  readonly label: string;
  readonly type: ReturnGridFieldType;
  readonly options?: readonly string[];
  readonly group?: string;
}

/** The 23 Logiwa filters (01 §5), in Logiwa's alphabetical order. */
export const RETURN_GRID_FIELDS: readonly ReturnGridField[] = [
  { field: "actualReturnDate", label: "Actual Return Date", type: "date", group: "Dates" },
  { field: "returnedQty", label: "Actual Return Quantity", type: "number", group: "Quantities" },
  { field: "carrierName", label: "Carrier", type: "text", group: "Shipping" },
  { field: "carrierServiceName", label: "Carrier Shipping Option Service", type: "text", group: "Shipping" },
  { field: "clientName", label: "Client", type: "text", group: "Organization" },
  { field: "createdByName", label: "Created By User", type: "text", group: "Organization" },
  { field: "customerName", label: "Customer Name", type: "text", group: "Customer" },
  { field: "deliveryDate", label: "Delivery Date", type: "date", group: "Dates" },
  { field: "expectedReturnDate", label: "Expected Return Date", type: "date", group: "Dates" },
  { field: "fromCountry", label: "From Country Code", type: "text", group: "Customer" },
  { field: "lineStatus", label: "Line Status", type: "enum", options: RETURN_STATUSES, group: "Status" },
  { field: "requestedQty", label: "Requested Quantity", type: "number", group: "Quantities" },
  { field: "rmaCode", label: "RMA Code", type: "text", group: "Return" },
  { field: "createdAt", label: "RMA Create Date", type: "date", group: "Dates" },
  { field: "shipmentOrderCode", label: "Shipment Order Code", type: "text", group: "Shipment order" },
  { field: "shipmentOrderDate", label: "Shipment Order Date", type: "date", group: "Dates" },
  { field: "sku", label: "SKU", type: "text", group: "Return" },
  { field: "status", label: "Status", type: "enum", options: RETURN_STATUSES, group: "Status" },
  { field: "store", label: "Store", type: "enum", options: ORDER_CHANNELS, group: "Shipment order" },
  { field: "storeOrderNumber", label: "Store Order Number", type: "text", group: "Shipment order" },
  { field: "tagName", label: "Tag", type: "text", group: "Return" },
  { field: "trackingNumber", label: "Tracking Number", type: "text", group: "Shipping" },
  { field: "warehouseCode", label: "Warehouse", type: "text", group: "Organization" },
  { field: "source", label: "Source", type: "enum", options: RETURN_SOURCES, group: "Return" },
  { field: "disposition", label: "Disposition", type: "enum", options: RETURN_DISPOSITIONS, group: "Return" },
];

/** Sortable grid columns (column id = sort field). */
export const RETURN_SORT_FIELDS = [
  "shipmentOrderCode", "rmaCode", "storeOrderNumber", "store", "companyName", "fromCountry", "status", "lineStatus",
  "requestedQty", "returnedQty", "sku", "customerName", "carrierName", "carrierServiceName", "trackingNumber", "packType",
  "createdAt", "shipmentOrderDate", "deliveryDate", "expectedReturnDate", "actualReturnDate", "createdByName",
  "warehouseCode", "clientName", "source", "disposition",
] as const;

/** Quick search (Equal / Starts With) targets. */
export const RETURN_SEARCH_FIELDS = ["rmaCode", "shipmentOrderCode", "storeOrderNumber", "trackingNumber", "sku", "customerName"] as const;

/** Export columns (sheet order = Logiwa grid order, then KitStaks extras). */
export const RETURN_EXPORT_COLUMNS = [
  { key: "shipmentOrderCode", label: "Shipment Order Code" },
  { key: "rmaCode", label: "RMA Code" },
  { key: "storeOrderNumber", label: "Store Order Number" },
  { key: "store", label: "Store" },
  { key: "companyName", label: "Company Name" },
  { key: "returnAddress", label: "Return Address" },
  { key: "fromCountry", label: "From Country Name" },
  { key: "status", label: "Status" },
  { key: "requestedQty", label: "Requested Quantity", type: "integer" },
  { key: "returnedQty", label: "Returned Quantity", type: "integer" },
  { key: "sku", label: "SKU" },
  { key: "customerName", label: "Customer Name" },
  { key: "carrierName", label: "Carrier Name" },
  { key: "carrierServiceName", label: "Carrier Shipping Option Name" },
  { key: "trackingNumber", label: "Tracking Number" },
  { key: "packType", label: "Pack Type" },
  { key: "createdAt", label: "Return Order Created Date", type: "datetime" },
  { key: "shipmentOrderDate", label: "Shipment Order Date", type: "datetime" },
  { key: "deliveryDate", label: "Shipment Order Delivery Date", type: "datetime" },
  { key: "expectedReturnDate", label: "Expected Return Date", type: "date" },
  { key: "actualReturnDate", label: "Actual Return Date", type: "datetime" },
  { key: "createdByName", label: "Created By" },
  { key: "warehouseCode", label: "Warehouse" },
  { key: "clientName", label: "Client" },
  { key: "tagNames", label: "Tags" },
  { key: "lineStatus", label: "Line Status" },
  { key: "source", label: "Source" },
  { key: "disposition", label: "Disposition" },
  { key: "customerReturnReason", label: "Customer Return Reason" },
  { key: "actualReturnReason", label: "Actual Return Reason" },
] as const satisfies readonly { key: string; label: string; type?: "integer" | "datetime" | "date" }[];

export const RETURN_STATUS_HELP: Readonly<Record<(typeof RETURN_STATUSES)[number], string>> = {
  "Pending": "Created; waiting for the customer to ship it back.",
  "In Transit": "The return label was scanned by the carrier.",
  "Started": "Receiving began at the return station.",
  "Completed": "Every line was received.",
  "Cancelled": "Closed without receiving. Can't be received.",
};
