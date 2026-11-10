/** Billing: contracts, fees, tiers, bills (reports), bill lines, VAS operations. */
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { RuleCondition } from "../../../lib/domain-types";
import {
  BILL_STATUSES,
  BILLING_APPROVAL_STATUSES,
  BILLING_CALC_STATUSES,
  BILLING_CALCULATION_TYPES,
  BILLING_FREQUENCIES,
  BILLING_INTEGRATION_STATUSES,
  BILLING_OPERATION_TYPES,
  VAS_CALCULATION_TYPES,
  VAS_REFERENCE_ORDER_TYPES,
} from "../../../lib/enums";
import { bool, EMPTY_JSON_ARRAY, json, pk, stamps } from "../columns";
import { clients, warehouses } from "./org";

export const billingContracts = sqliteTable("billing_contracts", {
  id: pk(),
  name: text("name").notNull(),
  clientId: text("client_id").notNull().references(() => clients.id),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  calcStartDate: text("calc_start_date").notNull(),
  frequency: text("frequency", { enum: BILLING_FREQUENCIES }).notNull(),
  approvalStatus: text("approval_status", { enum: BILLING_APPROVAL_STATUSES }).notNull().default("Draft"),
  lastCalculatedAt: text("last_calculated_at"),
  nextPeriodStart: text("next_period_start"),
  ...stamps(),
}, (t) => [index("billing_contracts_client_idx").on(t.clientId, t.warehouseId)]);

export const billingFees = sqliteTable("billing_fees", {
  id: pk(),
  contractId: text("contract_id").notNull().references(() => billingContracts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  operationType: text("operation_type", { enum: BILLING_OPERATION_TYPES }).notNull(),
  calculationType: text("calculation_type", { enum: BILLING_CALCULATION_TYPES }),
  feeBy: text("fee_by").notNull(),
  chargeBy: text("charge_by").notNull(),
  vasTypeId: text("vas_type_id"),
  useMinPrice: bool("use_min_price").notNull().default(false),
  minPrice: real("min_price"),
  useMaxPrice: bool("use_max_price").notNull().default(false),
  maxPrice: real("max_price"),
  splitDay: integer("split_day"),
  standardRate: real("standard_rate"),
  alternateRate: real("alternate_rate"),
  conditions: json<RuleCondition[]>("conditions").notNull().default(EMPTY_JSON_ARRAY),
  ...stamps(),
}, (t) => [index("billing_fees_contract_idx").on(t.contractId)]);

export const billingFeeTiers = sqliteTable("billing_fee_tiers", {
  id: pk(),
  feeId: text("fee_id").notNull().references(() => billingFees.id, { onDelete: "cascade" }),
  fromQty: real("from_qty"),
  toQty: real("to_qty"),
  rate: real("rate").notNull(),
  percentage: real("percentage"),
}, (t) => [index("billing_tiers_fee_idx").on(t.feeId)]);

export const billingReports = sqliteTable("billing_reports", {
  id: pk(),
  contractId: text("contract_id").notNull().references(() => billingContracts.id),
  billNumber: text("bill_number").notNull(),
  calcStatus: text("calc_status", { enum: BILLING_CALC_STATUSES }).notNull(),
  clientId: text("client_id").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  calculatedAt: text("calculated_at").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  billStatus: text("bill_status", { enum: BILL_STATUSES }).notNull().default("Draft"),
  totalPrice: real("total_price").notNull(),
  currency: text("currency").notNull().default("USD"),
  exportedToIntegration: bool("exported_to_integration").notNull().default(false),
  errorMessage: text("error_message"),
  ...stamps(), // includes created_by

}, (t) => [
  uniqueIndex("bill_number_idx").on(t.billNumber),
  index("billing_reports_contract_idx").on(t.contractId),
]);

export const billingReportLines = sqliteTable("billing_report_lines", {
  id: pk(),
  reportId: text("report_id").notNull().references(() => billingReports.id, { onDelete: "cascade" }),
  feeId: text("fee_id"),
  feeName: text("fee_name").notNull(),
  operationType: text("operation_type").notNull(),
  feeBy: text("fee_by").notNull(),
  chargeBy: text("charge_by").notNull(),
  sku: text("sku"),
  fromQty: real("from_qty"),
  toQty: real("to_qty"),
  unitPrice: real("unit_price").notNull(),
  quantity: real("quantity").notNull(),
  totalPrice: real("total_price").notNull(),
  minMaxAdjustment: real("min_max_adjustment").notNull().default(0),
  adjustedPrice: real("adjusted_price").notNull(),
  activityDate: text("activity_date"),
  referenceNumber: text("reference_number"),
  lpNumber: text("lp_number"),
  integrationStatus: text("integration_status", { enum: BILLING_INTEGRATION_STATUSES }).notNull().default("Not Sent"),
  note: text("note"),
  isDetail: bool("is_detail").notNull(), // false = consolidated row
}, (t) => [index("billing_lines_report_idx").on(t.reportId)]);

export const vasOperations = sqliteTable("vas_operations", {
  id: pk(),
  clientId: text("client_id").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  vasTypeId: text("vas_type_id").notNull(),
  operationAt: text("operation_at").notNull(),
  calculationType: text("calculation_type", { enum: VAS_CALCULATION_TYPES }).notNull(),
  value: real("value").notNull(),
  note: text("note"),
  referenceOrderType: text("reference_order_type", { enum: VAS_REFERENCE_ORDER_TYPES }),
  referenceNumber: text("reference_number"),
  ...stamps(),
}, (t) => [index("vas_ops_client_idx").on(t.clientId, t.operationAt)]);
