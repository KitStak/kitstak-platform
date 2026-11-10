/** Returns: return orders (RMA) and lines. */
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { RETURN_DISPOSITIONS, RETURN_SOURCES, RETURN_STATUSES } from "../../../lib/enums";
import { pk, stamps } from "../columns";
import { shipmentOrders } from "./outbound";

export const returnOrders = sqliteTable("return_orders", {
  id: pk(),
  rmaCode: text("rma_code").notNull(),
  shipmentOrderId: text("shipment_order_id").references(() => shipmentOrders.id),
  warehouseId: text("warehouse_id").notNull(),
  clientId: text("client_id").notNull(),
  source: text("source", { enum: RETURN_SOURCES }).notNull().default("RMA"),
  status: text("status", { enum: RETURN_STATUSES }).notNull().default("Pending"),
  returnAddressId: text("return_address_id"),
  fromCountry: text("from_country"),
  customerName: text("customer_name"),
  carrierCode: text("carrier_code"),
  carrierServiceName: text("carrier_service_name"),
  trackingNumber: text("tracking_number"),
  returnLabelShipmentId: text("return_label_shipment_id"),
  expectedReturnDate: text("expected_return_date"),
  actualReturnDate: text("actual_return_date"),
  note: text("note"),
  ...stamps(),
}, (t) => [
  uniqueIndex("rma_code_idx").on(t.rmaCode),
  index("return_orders_so_idx").on(t.shipmentOrderId),
]);

export const returnOrderLines = sqliteTable("return_order_lines", {
  id: pk(),
  returnOrderId: text("return_order_id").notNull().references(() => returnOrders.id, { onDelete: "cascade" }),
  orderLineId: text("order_line_id"),
  productId: text("product_id").notNull(),
  packType: text("pack_type").notNull(),
  requestedQty: integer("requested_qty").notNull(),
  returnedQty: integer("returned_qty").notNull().default(0),
  customerReturnReasonId: text("customer_return_reason_id"),
  actualReturnReasonId: text("actual_return_reason_id"),
  disposition: text("disposition", { enum: RETURN_DISPOSITIONS }),
  lineStatus: text("line_status", { enum: RETURN_STATUSES }).notNull().default("Pending"),
  ...stamps(),
}, (t) => [index("return_lines_return_idx").on(t.returnOrderId)]);
