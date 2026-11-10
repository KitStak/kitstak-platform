/**
 * Order Line Progress (M13 round 9): the line-level grid behind the dashboard's
 * "Order Lines" progress row. Each line of a backlog order, or of an order shipped today,
 * is in exactly one Line State, so a dashboard part opens a grid whose Total equals it.
 * PURE TS (client + server).
 */
import { SO_STATUSES } from "@/lib/enums";
import { CLIENT_FIELD, WAREHOUSE_FIELD, col, date, enumOf, num, text, type ReportDef } from "./types";

export const LINE_STATES = ["Packed", "Picked, not packed", "Not picked"] as const;
export type LineState = (typeof LINE_STATES)[number];

/** Which half of the dashboard predicate the line's order belongs to. */
export const LINE_PROGRESS_SCOPES = ["Backlog", "Shipped Today"] as const;

/**
 * SQL CASE for the line state over an `order_lines` alias. Packed wins over picked, so a
 * line counts once even when packed data runs ahead of picked data.
 */
export function lineStateCaseSql(alias: string): string {
  const need = `(${alias}.quantity - COALESCE(${alias}.cancelled_quantity, 0))`;
  return `CASE WHEN ${alias}.packed_quantity >= ${need} THEN 'Packed' WHEN ${alias}.picked_quantity >= ${need} THEN 'Picked, not packed' ELSE 'Not picked' END`;
}

export const ORDER_LINES_DEF: ReportDef = {
  gridKey: "report-order-lines",
  title: "Order Line Progress",
  path: "/api/reports/order-lines",
  permission: "fulfillment.shipment_orders.view",
  helper: "Every line of the open backlog and of the orders shipped today, with its pick and pack progress. The dashboard's Order Lines numbers open this grid, and its Total always equals the number you clicked.",
  fields: [
    enumOf("lineState", "Line State", LINE_STATES),
    enumOf("progressScope", "Order Group", LINE_PROGRESS_SCOPES, { description: "Backlog = open orders; Shipped Today = orders shipped since midnight (UTC, as the dashboard counts them)." }),
    WAREHOUSE_FIELD,
    CLIENT_FIELD,
    text("orderCode", "Order Code"),
    enumOf("orderStatus", "Order Status", SO_STATUSES),
    text("sku", "SKU"),
    text("productName", "Product Name"),
    num("requiredQty", "Required Qty"),
    num("remainingToPick", "Remaining To Pick"),
    num("remainingToPack", "Remaining To Pack"),
    date("orderDate", "Order Date"),
    date("expectedShipDate", "Expected Ship Date"),
  ],
  columns: [
    col("orderCode", "Order Code", { width: 140, kind: "strong", hrefKey: "orderHref", alwaysVisible: true }),
    col("lineState", "Line State", { kind: "pill", width: 150 }),
    col("sku", "SKU", { width: 160, hrefKey: "productHref" }),
    col("productName", "Product Name", { width: 220 }),
    col("requiredQty", "Required Qty", { kind: "number", width: 120, tip: "Ordered quantity minus the cancelled quantity of the line." }),
    col("pickedQty", "Picked Qty", { kind: "number", width: 110 }),
    col("packedQty", "Packed Qty", { kind: "number", width: 110 }),
    col("remainingToPick", "To Pick", { kind: "number", width: 100, tip: "Required Qty − Picked Qty (never below 0)." }),
    col("remainingToPack", "To Pack", { kind: "number", width: 100, tip: "Required Qty − Packed Qty (never below 0)." }),
    col("orderStatus", "Order Status", { kind: "pill", pill: "shipmentOrder", width: 150 }),
    col("progressScope", "Order Group", { width: 120 }),
    col("warehouse", "Warehouse", { width: 170 }),
    col("client", "Client", { width: 170 }),
    col("packType", "Pack Type", { width: 100, defaultHidden: true }),
    col("orderDate", "Order Date", { kind: "datetime", width: 164 }),
    col("expectedShipDate", "Expected Ship Date", { kind: "date", width: 150 }),
  ],
  search: ["orderCode", "sku"],
  searchPlaceholder: "Search by order code or SKU",
  defaultSort: ["orderCode", "sku"],
  rowKey: "rowId",
};
