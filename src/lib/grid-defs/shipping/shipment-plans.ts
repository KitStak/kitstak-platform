/**
 * Shipment Plan grids: plans (`shipment-plans`), plan orders (`shipment-plan-orders`) and
 * plan LPs (`shipment-plan-lps`), plus the pure plan rules shared by the drawer and the API.
 */
import { SHIPMENT_PLAN_STATUSES, SO_STATUSES } from "@/lib/enums";
import { optionsOf, type ShippingField } from "./common";

export const SHIPMENT_PLANS_GRID_KEY = "shipment-plans";
export const SHIPMENT_PLAN_ORDERS_GRID_KEY = "shipment-plan-orders";
export const SHIPMENT_PLAN_LPS_GRID_KEY = "shipment-plan-lps";

/** Orders that can be added to a plan (not yet shipped, cancelled or on hold). */
export const PLAN_ELIGIBLE_ORDER_STATUSES = [
  "Open", "Ready to Pick", "Picking Started", "Ready to Pack", "Packing Started", "Ready to Sort", "Sorting Started",
  "Ready to Load", "Loading Started", "Ready to Ship",
] as const;

/** Plan statuses that still own their orders (an order can sit in only one active plan). */
export const ACTIVE_PLAN_STATUSES = ["Open", "In Progress", "Loading Started", "Loading Completed"] as const;

/** Statuses a plan may be created in. */
export const PLAN_CREATE_STATUSES = ["Open", "In Progress"] as const;

/** Order statuses counted as "loaded" for the plan's loading progress. */
export const LOADED_ORDER_STATUSES = ["Ready to Ship", "Shipped", "Partially Shipped", "Delivered"] as const;

export const SHIPMENT_PLAN_FIELDS: readonly ShippingField[] = [
  { field: "code", label: "Code", type: "text" },
  { field: "status", label: "Plan status", type: "enum", options: optionsOf(SHIPMENT_PLAN_STATUSES) },
  { field: "warehouseCode", label: "Warehouse", type: "text", facet: "warehouses" },
  { field: "clientName", label: "Client", type: "text", facet: "clients" },
  { field: "carrierName", label: "Carrier", type: "text", facet: "carrierAccounts" },
  { field: "truckPlateNumber", label: "Truck plate number", type: "text" },
  { field: "loadingGate", label: "Loading gate", type: "text" },
  { field: "customerName", label: "Customer", type: "text" },
  { field: "retailerName", label: "Retailer", type: "text" },
  { field: "orderCount", label: "Orders", type: "number" },
  { field: "createdAt", label: "Created date", type: "date" },
  { field: "plannedShipmentAt", label: "Planned shipment date", type: "date" },
  { field: "actualShipmentAt", label: "Actual shipment date", type: "date" },
  { field: "truckDepartedAt", label: "Truck departed date", type: "date" },
];

export const SHIPMENT_PLAN_SORT_FIELDS = [
  "code", "status", "warehouseCode", "clientName", "customerName", "customerAddress", "createdAt", "plannedShipmentAt",
  "actualShipmentAt", "carrierName", "truckPlateNumber", "loadingGate", "retailerName", "loadingStartedAt",
  "loadingCompletedAt", "truckDepartedAt", "orderCount", "loadedPercent", "expectedTotalWeight",
] as const;
export const SHIPMENT_PLAN_SEARCH_FIELDS = ["code", "truckPlateNumber"] as const;

export const PLAN_ORDER_FIELDS: readonly ShippingField[] = [
  { field: "planCode", label: "Shipment plan", type: "text" },
  { field: "orderCode", label: "Order code", type: "text" },
  { field: "orderStatus", label: "Order status", type: "enum", options: optionsOf(SO_STATUSES) },
  { field: "planStatus", label: "Status", type: "enum", options: optionsOf(SHIPMENT_PLAN_STATUSES) },
  { field: "carrierName", label: "Carrier", type: "text", facet: "carrierAccounts" },
  { field: "clientName", label: "Client", type: "text", facet: "clients" },
  { field: "loadingGate", label: "Loading gate", type: "text" },
  { field: "plannedShipmentAt", label: "Planned shipment date", type: "date" },
  { field: "shippingService", label: "Shipping service", type: "text", facet: "services" },
  { field: "truckDepartedAt", label: "Truck departed date", type: "date" },
  { field: "truckPlateNumber", label: "Truck plate number", type: "text" },
  { field: "warehouseCode", label: "Warehouse", type: "text", facet: "warehouses" },
];

export const PLAN_ORDER_SORT_FIELDS = [
  "planCode", "orderCode", "orderStatus", "planStatus", "warehouseCode", "customerName", "customerAddress", "carrierName",
  "lpShippingOption", "clientName", "truckPlateNumber", "orderCarrier", "loadingGate", "plannedShipmentAt", "truckDepartedAt",
] as const;
export const PLAN_ORDER_SEARCH_FIELDS = ["planCode", "orderCode"] as const;

export const PLAN_LP_FIELDS: readonly ShippingField[] = [
  { field: "planCode", label: "Shipment plan", type: "text" },
  { field: "lpNumber", label: "LP number", type: "text" },
  { field: "carrierName", label: "Carrier", type: "text", facet: "carrierAccounts" },
  { field: "clientName", label: "Client", type: "text", facet: "clients" },
  { field: "loadingGate", label: "Loading gate", type: "text" },
  { field: "plannedShipmentAt", label: "Planned shipment date", type: "date" },
  { field: "shippingService", label: "Shipping service", type: "text", facet: "services" },
  { field: "truckDepartedAt", label: "Truck departed date", type: "date" },
  { field: "truckPlateNumber", label: "Truck plate number", type: "text" },
  { field: "volume", label: "Volume", type: "number", decimals: 2 },
  { field: "warehouseCode", label: "Warehouse", type: "text", facet: "warehouses" },
  { field: "weight", label: "Weight", type: "number", decimals: 2 },
];

export const PLAN_LP_SORT_FIELDS = [
  "planCode", "orderCode", "orderStatus", "lpNumber", "parentLpNumber", "planStatus", "warehouseCode", "customerName",
  "customerAddress", "carrierName", "shippingService", "clientName", "truckPlateNumber", "lpCarrier", "originalLpNumber",
  "loadingGate", "plannedShipmentAt", "truckDepartedAt", "weight", "volume",
] as const;
export const PLAN_LP_SEARCH_FIELDS = ["planCode", "lpNumber", "orderCode"] as const;

/** Why an order can't join a plan, or null. */
export function orderEligibilityReason(order: { readonly status: string; readonly warehouseId: string; readonly clientId: string }, plan: { readonly warehouseId: string; readonly clientId: string | null }): string | null {
  if (order.warehouseId !== plan.warehouseId) return "is in another warehouse";
  if (plan.clientId && order.clientId !== plan.clientId) return "belongs to another client";
  if (!(PLAN_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(order.status)) return `is ${order.status}`;
  return null;
}

export function planDeleteBlockReason(status: string): string | null {
  return status === "Open" ? null : "Only Open shipment plans can be deleted";
}

export function planEditBlockReason(status: string): string | null {
  return status === "Shipped" || status === "Cancelled" ? `${status} plans can't be edited` : null;
}

export function planShipBlockReason(status: string, orderCount: number): string | null {
  if (status === "Shipped") return "This plan is already shipped";
  if (status === "Cancelled") return "Cancelled plans can't be shipped";
  if (orderCount === 0) return "Add at least one order before shipping";
  return null;
}

/** Weight lb from oz; volume ft³ from in³ (both rounded to 2 dp). */
export const ozToLb = (oz: number): number => Math.round((oz / 16) * 100) / 100;
export const in3ToFt3 = (in3: number): number => Math.round((in3 / 1728) * 100) / 100;

/** Filter fields of the plan order picker (`/api/shipment-plans/eligible-orders`). */
export const PLAN_ELIGIBLE_ORDER_FIELDS: readonly ShippingField[] = [
  { field: "status", label: "Status", type: "enum", options: PLAN_ELIGIBLE_ORDER_STATUSES.map((s) => ({ value: s, label: s })) },
  { field: "orderType", label: "Order type", type: "text" },
  { field: "storeName", label: "Store", type: "text" },
  { field: "clientName", label: "Client", type: "text" },
  { field: "customerName", label: "Customer", type: "text" },
  { field: "sku", label: "SKU", type: "text" },
  { field: "createdAt", label: "Created date", type: "date" },
  { field: "totalQuantity", label: "Total quantity", type: "number" },
];
