/** Channel Monitoring grids (M12, spec 06 §12–§16b). PURE. */
import { CHANNEL_MISSING_ORDER_STATUSES } from "@/lib/enums";
import { INTEGRATION_ERROR_CODES } from "@/lib/integration-errors";
import type { IntegrationField } from "./common";

export const HEALTH_GRID_KEY = "monitoring-health";
export const MISSING_GRID_KEY = "integration-monitoring";
export const RECENT_ERRORS_GRID_KEY = "monitoring-recent-errors";
export const BLOCKED_GRID_KEY = "monitoring-workflow-blocked";
export const LISTING_EXCEPTIONS_GRID_KEY = "monitoring-listing-exceptions";

/** A setup is "low performing" below this 24h success rate. */
export const LOW_PERFORMING_PCT = 80;

export const HEALTH_FIELDS: readonly IntegrationField[] = [
  { field: "provider", label: "Channel", type: "enum" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "downloadStatus", label: "Download order status", type: "enum", options: ["Active", "Passive"] },
  { field: "successRate", label: "Success rate", type: "number" },
  { field: "orders24h", label: "Num. of orders", type: "number" },
];
export const HEALTH_SORT_FIELDS = ["provider", "storeName", "clientName", "downloadStatus", "successRate", "orders24h", "lines24h", "lastSuccessAt"] as const;

export const MISSING_FIELDS: readonly IntegrationField[] = [
  { field: "provider", label: "Channel", type: "enum" },
  { field: "connectionId", label: "Channel setup name", type: "enum" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "lastUpdated", label: "Created date", type: "date" },
  { field: "lastErrorCode", label: "Last error code", type: "enum", options: INTEGRATION_ERROR_CODES },
  { field: "orderCode", label: "Order code", type: "text" },
  { field: "orderDate", label: "Order date", type: "date" },
  { field: "channelOrderNumber", label: "Store order number", type: "text" },
  { field: "status", label: "Status", type: "enum", options: CHANNEL_MISSING_ORDER_STATUSES },
];
export const MISSING_SORT_FIELDS = ["orderCode", "channelOrderNumber", "storeName", "provider", "clientName", "orderDate", "lastUpdated", "lastErrorCode", "status"] as const;

export const RECENT_ERROR_FIELDS: readonly IntegrationField[] = [
  { field: "provider", label: "Channel", type: "enum" },
  { field: "connectionId", label: "Channel setup name", type: "enum" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "errorReason", label: "Error reason", type: "enum", options: INTEGRATION_ERROR_CODES },
];
export const RECENT_ERROR_SORT_FIELDS = ["errorReason", "storeName", "provider", "clientName", "occurrences", "affectedOrders", "lastOccurrence"] as const;

export const BLOCKED_FIELDS: readonly IntegrationField[] = [
  { field: "actionName", label: "Action name", type: "enum", options: ["Block Order", "Partially Block Order"] },
  { field: "blockType", label: "Block type", type: "enum", options: ["Fully", "Partially"] },
  { field: "provider", label: "Channel", type: "enum" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "orderDate", label: "Order date", type: "date" },
  { field: "orderCode", label: "SO code", type: "text" },
  { field: "storeName", label: "Store name", type: "text" },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "workflowName", label: "Workflow name", type: "text" },
];
export const BLOCKED_SORT_FIELDS = ["orderCode", "blockType", "storeName", "provider", "clientName", "orderDate", "workflowName", "actionName", "warehouseCode"] as const;

export const LISTING_EXCEPTION_FIELDS: readonly IntegrationField[] = [
  { field: "provider", label: "Channel", type: "enum" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "listingDate", label: "Created date", type: "date" },
  { field: "issueType", label: "Exception issue type", type: "enum", options: ["Multi Listing", "SKU Difference"] },
  { field: "sellerSkus", label: "Seller SKU", type: "text" },
  { field: "sku", label: "SKU", type: "text" },
  { field: "storeName", label: "Store name", type: "text" },
];
export const LISTING_EXCEPTION_SORT_FIELDS = ["sku", "sellerSkus", "storeName", "provider", "clientName", "issueType", "listingDate"] as const;
