/**
 * Every exportable grid, pre-registered by foundation (BUILD_PLAN F6 `exports/`).
 *
 * `gridKey` is the id grids use for Export As Excel, grid prefs and saved views.
 * `listPath` is the list endpoint the generic fallback reads; `modulePath` is where the
 * owning module puts its dedicated provider (wired through `providers/<gridKey>.ts`).
 * PURE data.
 */
import type { GridExportDef } from "./types";

type Row = readonly [gridKey: string, title: string, listPath: string, permission: string, owner: string, prefix: string, fixed?: Readonly<Record<string, string>>];

const ROWS: readonly Row[] = [
  // Foundation — /dev/ui showcase grid (provider evaluates the grid query in memory)
  ["dev-ui-orders", "Shipment Orders", "/api/orders", "settings.screen_configuration.view", "F4", "dev-orders"],
  // M01 — orders
  ["orders-backlog", "Shipment Orders", "/api/orders", "fulfillment.shipment_orders.view", "M01", "orders"],
  ["orders-shipped", "Shipped & Canceled Orders", "/api/orders", "fulfillment.shipment_orders.view", "M01", "orders", { tab: "shipped" }],
  // M02 — shipping
  ["shipments", "Carrier Shipment Details", "/api/shipments", "fulfillment.carrier_shipment_details.view", "M02", "shipping"],
  ["end-of-day", "End Of The Day", "/api/end-of-day", "fulfillment.end_of_day.view", "M02", "end-of-day"],
  ["shipment-history", "Shipment History", "/api/shipments/history", "fulfillment.shipment_history.view", "M02", "shipping"],
  ["shipment-plans", "Shipment Plan", "/api/shipment-plans", "fulfillment.shipment_plan.view", "M02", "shipment-plans"],
  ["shipment-plan-orders", "Shipment Plan Orders", "/api/shipment-plans/orders", "fulfillment.shipment_plan.view", "M02", "shipment-plans"],
  ["shipment-plan-lps", "Shipment Plan LPs", "/api/shipment-plans/lps", "fulfillment.shipment_plan.view", "M02", "shipment-plans"],
  // M03 — jobs
  ["jobs", "Job Management", "/api/jobs", "fulfillment.job_management.view", "M03", "jobs"],
  ["wave-rules", "Wave Rules", "/api/wave-rules", "automation.wave_rules.view", "M03", "wave-rules"],
  ["wave-log", "Wave Log Report", "/api/waves", "reports.wave_log_report.view", "M03", "waves"],
  ["allocation-exceptions", "Allocation Exceptions", "/api/allocation-exceptions", "reports.wave_exceptions.view", "M03", "allocation-exceptions"],
  ["shortages", "Shortage Report", "/api/shortages", "reports.shortage_report.view", "M03", "shortages"],
  ["tasks-order-operations", "Order Operations Task Details", "/api/tasks", "fulfillment.task_details.view", "M03", "tasks", { kind: "order" }],
  ["tasks-count", "Count Task Details", "/api/tasks", "fulfillment.task_details.view", "M03", "tasks", { kind: "count" }],
  ["tasks-replenishment", "Replenishment Task Details", "/api/tasks", "fulfillment.task_details.view", "M03", "tasks", { kind: "replenishment" }],
  ["job-types", "Job Types", "/api/job-types", "settings.job_types.view", "M03", "job-types"],
  // M04 — returns
  ["return-orders", "Return Orders", "/api/returns", "inventory.return_orders.view", "M04", "returns"],
  // M05 — inbound
  ["purchase-orders", "Purchase Orders", "/api/purchase-orders", "inventory.purchase_orders.view", "M05", "purchase-orders"],
  ["receiving-history", "Receiving History", "/api/receipts", "inventory.receiving_history.view", "M05", "receipts"],
  ["vendors", "Vendors", "/api/vendors", "settings.vendors.view", "M05", "vendors"],
  // M06 — inventory
  ["inventory-total", "Total Inventory", "/api/inventory", "inventory.total_inventory.view", "M06", "inventory"],
  ["inventory-by-location", "Inventory by Location", "/api/inventory/by-location", "inventory.inventory_by_location.view", "M06", "inventory"],
  ["inventory-atp", "Available To Promise", "/api/inventory/atp", "inventory.atp.view", "M06", "inventory"],
  // M07 — counts
  ["count-plans", "Count Plans", "/api/counts", "inventory.count_plans.view", "M07", "counts"],
  ["count-locations", "Count Location Details", "/api/counts/locations", "inventory.count_location_details.view", "M07", "counts"],
  ["count-skus", "Count SKU Details", "/api/counts/skus", "inventory.count_sku_details.view", "M07", "counts"],
  // M08 — work orders and kits
  ["work-orders", "Work Orders", "/api/work-orders", "inventory.work_orders.view", "M08", "work-orders"],
  ["kit-inventory", "Kit Inventory", "/api/kits", "reports.kit_inventory.view", "M08", "kits"],
  ["kit-components", "Kit Component Inventory Availability", "/api/kits/components", "reports.kit_component_availability_report.view", "M08", "kits"],
  // M09 — catalog
  ["products", "Products", "/api/products", "settings.products.view", "M09", "products"],
  ["product-listings", "Product Listings", "/api/listings", "settings.product_listing.view", "M09", "listings"],
  // M10 — facility
  ["locations", "Locations", "/api/locations", "settings.locations.view", "M10", "locations"],
  ["warehouses", "Warehouses", "/api/warehouses", "settings.warehouse.view", "M10", "warehouses"],
  ["mobile-carts", "Mobile Carts", "/api/mobile-carts", "settings.mobile_carts.view", "M10", "mobile-carts"],
  ["lp-types", "LP Types", "/api/lp-types", "settings.lp_types.view", "M10", "lp-types"],
  ["lp-numbers", "LP Numbers", "/api/lp-numbers", "settings.lp_numbers.view", "M10", "lp-numbers"],
  ["shipment-packages", "Shipment Packages", "/api/shipment-packages", "settings.shipment_packages.view", "M10", "shipment-packages"],
  // M11 — organization and billing
  ["clients", "Clients", "/api/clients", "settings.clients.view", "M11", "clients"],
  ["customers", "Customers", "/api/customers", "settings.customers.view", "M11", "customers"],
  ["retailers", "Retailers", "/api/retailers", "settings.retailers.view", "M11", "retailers"],
  ["billing-contracts", "3PL Billing", "/api/billing", "settings.billing.view", "M11", "billing"],
  ["billing-reports", "Billing Report", "/api/billing-reports", "settings.billing_report.view", "M11", "billing"],
  ["vas-operations", "VAS Operations", "/api/vas-operations", "settings.vas_operations.view", "M11", "vas-operations"],
  // `{reportId}` is filled from the export query (see generic `resolveListPath`).
  ["billing-report-lines", "Billing Report Lines", "/api/billing-reports/{reportId}/lines", "settings.billing_report.view", "M11", "billing-lines"],
  // M12 — integrations
  ["integration-logs", "Channel History", "/api/integration-logs/history", "integrations.integration_logs.view", "M12", "integration-logs"],
  ["integration-monitoring", "Channel Monitoring", "/api/monitoring/missing-orders", "integrations.integration_monitoring.view", "M12", "monitoring"],
  ["carrier-errors", "Carrier Errors", "/api/carriers/call-logs", "integrations.carrier_monitoring.view", "M12", "carriers", { step: "LabelGeneration" }],
  ["algorithms-putaway", "Putaway Algorithms", "/api/algorithms", "automation.algorithms.view", "M12", "algorithms", { kind: "putaway" }],
  ["algorithms-allocation", "Allocation Algorithms", "/api/algorithms", "automation.algorithms.view", "M12", "algorithms", { kind: "allocation" }],
  ["workflows", "Workflows", "/api/workflows", "automation.workflows.view", "M12", "workflows"],
  ["rate-shopping-presets", "Rate Shopping Presets", "/api/rate-shopping-presets", "automation.rate_shopping.view", "M12", "rate-shopping"],
  ["channel-methods", "Channel Methods", "/api/integration-logs/methods", "integrations.integration_logs.view", "M12", "integration-logs"],
  ["integration-orders", "Orders and Shipments", "/api/integration-logs/items", "integrations.integration_logs.view", "M12", "integration-logs", { kind: "orders" }],
  ["integration-products", "Products and Inventory", "/api/integration-logs/items", "integrations.integration_logs.view", "M12", "integration-logs", { kind: "products" }],
  ["monitoring-health", "Channel Health Overview", "/api/monitoring/health", "integrations.integration_monitoring.view", "M12", "monitoring"],
  ["monitoring-recent-errors", "Recent Errors", "/api/monitoring/recent-errors", "integrations.integration_monitoring.view", "M12", "monitoring"],
  ["monitoring-workflow-blocked", "Workflow Blocked Shipment Orders", "/api/monitoring/workflow-blocked", "integrations.integration_monitoring.view", "M12", "monitoring"],
  ["monitoring-listing-exceptions", "Product Listing Exceptions", "/api/monitoring/listing-exceptions", "integrations.integration_monitoring.view", "M12", "monitoring"],
  ["carrier-errors-rate-call", "Carrier Errors · Rate Call", "/api/carriers/call-logs", "integrations.carrier_monitoring.view", "M12", "carriers", { step: "RateCall" }],
  ["carrier-errors-void-label", "Carrier Errors · Void/Cancel Label", "/api/carriers/call-logs", "integrations.carrier_monitoring.view", "M12", "carriers", { step: "VoidLabel" }],
  // M13 — reports
  ["report-channel-sales", "Channel Sales Report", "/api/reports/channel-sales", "reports.channel_sales_report.view", "M13", "reports"],
  ["report-serial-numbers", "Serial Number Report", "/api/reports/serial-numbers", "reports.serial_number_tracking_report.view", "M13", "reports"],
  ["report-order-inventory", "Order Inventory", "/api/reports/order-inventory", "reports.order_inventory_report.view", "M13", "reports"],
  ["report-replenishment", "Dynamic Replenishment Report", "/api/reports/replenishment", "reports.dynamic_replenishment_report.view", "M13", "reports"],
  ["report-inventory-snapshot", "Inventory Snapshot Report", "/api/reports/inventory-snapshot", "reports.inventory_snapshot_report.view", "M13", "reports"],
  ["report-change-log", "Change Log", "/api/reports/change-log", "reports.change_log.view", "M13", "reports"],
  ["report-transaction-history", "Transaction History", "/api/reports/transaction-history", "reports.transaction_history.view", "M13", "reports"],
  ["report-serial-transactions", "Serial Number Transaction History", "/api/reports/transaction-history/serial", "reports.serial_number_transaction_history.view", "M13", "reports"],
  ["report-missing-log", "Missing Log", "/api/reports/missing-log", "reports.inventory_missing_log.view", "M13", "reports"],
  ["report-export-history", "Excel Export History", "/api/background-tasks", "reports.excel_export_history.view", "M13", "reports", { kind: "export" }],
  ["report-po-receiving", "PO Receiving Report", "/api/reports/po-receiving", "reports.po_receiving_report.view", "M13", "reports"],
  ["report-user-performance", "User Performance Report", "/api/reports/user-performance", "reports.user_performance_report.view", "M13", "reports"],
  // M14 — admin
  ["users", "Users", "/api/users", "settings.users.view", "M14", "users"],
  ["roles", "Roles", "/api/roles", "settings.roles.view", "M14", "roles"],
  ["audit-log", "Audit Log", "/api/audit", "settings.users.view", "M14", "audit"],
  ["printouts", "Printouts & Labels", "/api/printouts", "settings.printouts_labels.view", "M14", "printouts"],
  ["screen-configs", "Screen Configurations", "/api/screen-configs", "settings.screen_configuration.view", "M14", "screen-configs"],
];

export const GRID_EXPORTS: readonly GridExportDef[] = Object.freeze(ROWS.map(
  ([gridKey, title, listPath, permission, owner, prefix, fixedParams]): GridExportDef => ({
    gridKey,
    title,
    listPath,
    permission,
    owner,
    modulePath: `src/server/repositories/${prefix}-export.ts`,
    ...(fixedParams ? { fixedParams } : {}),
  }),
));

export const GRID_KEYS: readonly string[] = Object.freeze(GRID_EXPORTS.map((def) => def.gridKey));

const BY_KEY: ReadonlyMap<string, GridExportDef> = new Map(GRID_EXPORTS.map((def) => [def.gridKey, def]));

export function getGridExportDef(gridKey: string): GridExportDef | undefined {
  return BY_KEY.get(gridKey);
}

export function isGridKey(value: unknown): value is string {
  return typeof value === "string" && BY_KEY.has(value);
}
