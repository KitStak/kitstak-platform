/** Billing Report (M11): bill grid, detailed-line grid and Edit Info schema. PURE. */
import { z } from "zod";
import { BILL_STATUSES } from "@/lib/enums";
import { requiredText, versionField, type OrgField } from "./common";

export const BILLING_REPORTS_GRID_KEY = "billing-reports";
export const BILLING_LINES_GRID_KEY = "billing-report-lines";

export const BILLING_REPORT_FIELDS: readonly OrgField[] = [
  { field: "billNumber", label: "Billing number", type: "text" },
  { field: "contractName", label: "Name", type: "text" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "billStatus", label: "Bill status", type: "enum", options: BILL_STATUSES },
  { field: "calcStatus", label: "Calculation status", type: "enum", options: ["Successful", "Failed"] },
  { field: "createdAt", label: "Create date", type: "date" },
  { field: "periodStart", label: "Period start", type: "date" },
  { field: "totalPrice", label: "Price", type: "number", decimals: 2 },
  { field: "exportedToIntegration", label: "Exported to integration", type: "boolean" },
];
/** Logiwa Billing Report filters: Billing Number, Client, Create Date, Name, Warehouse. */
export const BILLING_REPORT_FILTER_PRESET = ["billNumber", "clientId", "createdAt", "contractName", "warehouseId"] as const;
export const BILLING_LINE_FILTER_PRESET = ["feeName", "operationType", "referenceNumber", "sku", "activityDate"] as const;
export const BILLING_REPORT_SORT_FIELDS = ["contractName", "billNumber", "calcStatus", "clientName", "warehouseCode", "calculatedAt", "createdByName", "periodStart", "periodEnd", "billStatus", "totalPrice", "createdAt"] as const;
export const BILLING_REPORT_SEARCH_FIELDS = ["contractName", "billNumber"] as const;

export const BILLING_LINE_FIELDS: readonly OrgField[] = [
  { field: "feeName", label: "Fee name", type: "text" },
  { field: "operationType", label: "Operation type", type: "enum", options: ["Shipment", "Recurring", "VAS", "Pick & Pack", "Receiving", "Storage", "Return", "Work Order"] },
  { field: "sku", label: "SKU", type: "text" },
  { field: "referenceNumber", label: "Reference number", type: "text" },
  { field: "lpNumber", label: "LP number", type: "text" },
  { field: "activityDate", label: "Activity date", type: "date" },
  { field: "quantity", label: "Quantity", type: "number" },
  { field: "adjustedPrice", label: "Adjusted price", type: "number", decimals: 2 },
];
export const BILLING_LINE_SORT_FIELDS = ["feeName", "operationType", "sku", "unitPrice", "quantity", "totalPrice", "adjustedPrice", "activityDate", "referenceNumber", "lpNumber"] as const;
export const BILLING_LINE_SEARCH_FIELDS = ["referenceNumber", "sku", "feeName", "lpNumber"] as const;

export const billInfoSchema = z.object({
  billNumber: requiredText("Bill number", 40).regex(/^[A-Za-z0-9-]+$/, "Letters, numbers or dash"),
  billStatus: z.enum(BILL_STATUSES),
  version: versionField,
  /** Explicit confirmation to approve a bill whose period has not ended yet. */
  allowOpenPeriod: z.boolean().optional(),
});
export type BillInfoInput = z.input<typeof billInfoSchema>;

/** Draft → Approved | Canceled; Approved → Draft (cancel approval) | Canceled; Canceled is final. */
export function canTransitionBill(from: (typeof BILL_STATUSES)[number], to: (typeof BILL_STATUSES)[number]): boolean {
  if (from === to) return true;
  if (from === "Canceled") return false;
  if (from === "Draft") return to === "Approved" || to === "Canceled";
  return to === "Draft" || to === "Canceled";
}
