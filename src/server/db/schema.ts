import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

/* ============ identity & tenancy ============ */

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", {
      enum: ["admin", "manager", "operator", "viewer"],
    }).notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)]
);

export const warehouses = sqliteTable("warehouses", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  addressLine: text("address_line").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
});

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  phone: text("phone").notNull(),
  billingPlan: text("billing_plan", {
    enum: ["per-order", "per-unit", "monthly"],
  }).notNull(),
  status: text("status", { enum: ["Active", "Inactive"] }).notNull(),
  createdAt: text("created_at").notNull(),
});

/* ============ catalog ============ */

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    sku: text("sku").notNull(),
    barcode: text("barcode").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    uom: text("uom").notNull().default("Each"),
    weightOz: real("weight_oz").notNull(),
    lengthIn: real("length_in").notNull(),
    widthIn: real("width_in").notNull(),
    heightIn: real("height_in").notNull(),
    price: real("price").notNull(),
    isKit: integer("is_kit", { mode: "boolean" }).notNull().default(false),
    isFragile: integer("is_fragile", { mode: "boolean" }).notNull().default(false),
    isHazmat: integer("is_hazmat", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["Active", "Inactive"] }).notNull(),
    reorderPoint: integer("reorder_point").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("products_sku_idx").on(t.clientId, t.sku)]
);

/* ============ facility ============ */

export const locations = sqliteTable(
  "locations",
  {
    id: text("id").primaryKey(),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    code: text("code").notNull(),
    zone: text("zone").notNull(),
    aisle: text("aisle").notNull(),
    bay: text("bay").notNull(),
    level: text("level").notNull(),
    type: text("type", {
      enum: ["Picking", "Reserve", "Receiving", "Shipping", "Returns", "Damaged"],
    }).notNull(),
    capacityUnits: integer("capacity_units").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [uniqueIndex("locations_code_idx").on(t.warehouseId, t.code)]
);

export const inventory = sqliteTable(
  "inventory",
  {
    id: text("id").primaryKey(),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id),
    lotNumber: text("lot_number"),
    onHand: integer("on_hand").notNull(),
    allocated: integer("allocated").notNull().default(0),
    damaged: integer("damaged").notNull().default(0),
    receivedAt: text("received_at").notNull(),
  },
  (t) => [
    index("inventory_product_idx").on(t.productId),
    index("inventory_location_idx").on(t.locationId),
  ]
);

/* ============ outbound ============ */

export const shipmentOrders = sqliteTable(
  "shipment_orders",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    channel: text("channel", {
      enum: ["Shopify", "Amazon", "TikTok Shop", "Walmart", "Wholesale", "Manual"],
    }).notNull(),
    storeName: text("store_name"),
    storeOrderNumber: text("store_order_number"),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    shipAddress: text("ship_address").notNull(),
    shipCity: text("ship_city").notNull(),
    shipState: text("ship_state").notNull(),
    shipZip: text("ship_zip").notNull(),
    shipCountry: text("ship_country").notNull().default("United States"),
    status: text("status", {
      enum: [
        "Open",
        "Ready to Pick",
        "Picking Started",
        "Ready to Pack",
        "Packing Started",
        "Ready to Ship",
        "Shipped",
        "Delivered",
        "Cancelled",
        "Shortage",
        "On Hold",
      ],
    }).notNull(),
    orderType: text("order_type", { enum: ["D2C", "B2B"] }).notNull().default("D2C"),
    priority: text("priority", { enum: ["None", "High", "Urgent"] })
      .notNull()
      .default("None"),
    carrier: text("carrier"),
    shippingService: text("shipping_service"),
    trackingNumber: text("tracking_number"),
    totalQuantity: integer("total_quantity").notNull(),
    totalWeightOz: real("total_weight_oz").notNull(),
    salesPrice: real("sales_price").notNull(),
    jobId: text("job_id"),
    orderDate: text("order_date").notNull(),
    expectedShipDate: text("expected_ship_date"),
    shippedAt: text("shipped_at"),
    deliveredAt: text("delivered_at"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("orders_code_idx").on(t.code),
    index("orders_status_idx").on(t.status),
    index("orders_client_idx").on(t.clientId),
    index("orders_date_idx").on(t.orderDate),
  ]
);

export const orderLines = sqliteTable(
  "order_lines",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => shipmentOrders.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
    pickedQuantity: integer("picked_quantity").notNull().default(0),
    packedQuantity: integer("packed_quantity").notNull().default(0),
    unitPrice: real("unit_price").notNull(),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId)]
);

/* ============ inbound ============ */

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    vendorName: text("vendor_name").notNull(),
    referenceNumber: text("reference_number"),
    status: text("status", {
      enum: ["Pending", "Started", "Receiving", "Completed", "Cancelled"],
    }).notNull(),
    poType: text("po_type", { enum: ["Purchase Order", "Transfer Order"] })
      .notNull()
      .default("Purchase Order"),
    totalQuantity: integer("total_quantity").notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    purchasePrice: real("purchase_price").notNull(),
    expectedDate: text("expected_date"),
    receivedAt: text("received_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("po_code_idx").on(t.code)]
);

export const purchaseOrderLines = sqliteTable(
  "purchase_order_lines",
  {
    id: text("id").primaryKey(),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    orderedQuantity: integer("ordered_quantity").notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    unitCost: real("unit_cost").notNull(),
  },
  (t) => [index("po_lines_po_idx").on(t.purchaseOrderId)]
);

/* ============ work ============ */

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    clientId: text("client_id").references(() => clients.id),
    jobType: text("job_type", {
      enum: [
        "Single Unit Orders",
        "Multi Item Orders",
        "B2B Order Picking",
        "Cycle Count",
        "Dynamic Replenishment",
      ],
    }).notNull(),
    status: text("status", {
      enum: ["Pending", "In Progress", "Completed", "Cancelled"],
    }).notNull(),
    priority: text("priority", { enum: ["None", "High", "Urgent"] })
      .notNull()
      .default("None"),
    assignedToUserId: text("assigned_to_user_id").references(() => users.id),
    orderCount: integer("order_count").notNull().default(0),
    unitCount: integer("unit_count").notNull().default(0),
    completedUnits: integer("completed_units").notNull().default(0),
    waveNumber: text("wave_number"),
    ruleName: text("rule_name"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [uniqueIndex("jobs_code_idx").on(t.code)]
);

/* ============ governance ============ */

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    detail: text("detail"),
    at: text("at").notNull(),
  },
  (t) => [index("audit_at_idx").on(t.at)]
);
