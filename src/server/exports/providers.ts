/**
 * gridKey -> module export provider (BUILD_PLAN F6 `exports/`). GENERATED from
 * `grid-keys.ts`: one stub file per grid in `./providers/`, owned by the grid owner (0.6).
 * A `null` entry means "not provided yet": the runner falls back to the generic provider.
 */
import type { ExportProvider } from "./types";
import { exportProvider as devUiOrders } from "./providers/dev-ui-orders";
import { exportProvider as ordersBacklog } from "./providers/orders-backlog";
import { exportProvider as ordersShipped } from "./providers/orders-shipped";
import { exportProvider as shipments } from "./providers/shipments";
import { exportProvider as endOfDay } from "./providers/end-of-day";
import { exportProvider as shipmentHistory } from "./providers/shipment-history";
import { exportProvider as shipmentPlans } from "./providers/shipment-plans";
import { exportProvider as shipmentPlanOrders } from "./providers/shipment-plan-orders";
import { exportProvider as shipmentPlanLps } from "./providers/shipment-plan-lps";
import { exportProvider as jobs } from "./providers/jobs";
import { exportProvider as waveRules } from "./providers/wave-rules";
import { exportProvider as waveLog } from "./providers/wave-log";
import { exportProvider as allocationExceptions } from "./providers/allocation-exceptions";
import { exportProvider as shortages } from "./providers/shortages";
import { exportProvider as tasksOrderOperations } from "./providers/tasks-order-operations";
import { exportProvider as tasksCount } from "./providers/tasks-count";
import { exportProvider as tasksReplenishment } from "./providers/tasks-replenishment";
import { exportProvider as jobTypes } from "./providers/job-types";
import { exportProvider as returnOrders } from "./providers/return-orders";
import { exportProvider as purchaseOrders } from "./providers/purchase-orders";
import { exportProvider as receivingHistory } from "./providers/receiving-history";
import { exportProvider as vendors } from "./providers/vendors";
import { exportProvider as inventoryTotal } from "./providers/inventory-total";
import { exportProvider as inventoryByLocation } from "./providers/inventory-by-location";
import { exportProvider as inventoryAtp } from "./providers/inventory-atp";
import { exportProvider as countPlans } from "./providers/count-plans";
import { exportProvider as countLocations } from "./providers/count-locations";
import { exportProvider as countSkus } from "./providers/count-skus";
import { exportProvider as workOrders } from "./providers/work-orders";
import { exportProvider as kitInventory } from "./providers/kit-inventory";
import { exportProvider as kitComponents } from "./providers/kit-components";
import { exportProvider as products } from "./providers/products";
import { exportProvider as productListings } from "./providers/product-listings";
import { exportProvider as locations } from "./providers/locations";
import { exportProvider as warehouses } from "./providers/warehouses";
import { exportProvider as mobileCarts } from "./providers/mobile-carts";
import { exportProvider as lpTypes } from "./providers/lp-types";
import { exportProvider as lpNumbers } from "./providers/lp-numbers";
import { exportProvider as shipmentPackages } from "./providers/shipment-packages";
import { exportProvider as clients } from "./providers/clients";
import { exportProvider as customers } from "./providers/customers";
import { exportProvider as retailers } from "./providers/retailers";
import { exportProvider as billingContracts } from "./providers/billing-contracts";
import { exportProvider as billingReports } from "./providers/billing-reports";
import { exportProvider as vasOperations } from "./providers/vas-operations";
import { exportProvider as integrationLogs } from "./providers/integration-logs";
import { exportProvider as integrationMonitoring } from "./providers/integration-monitoring";
import { exportProvider as carrierErrors } from "./providers/carrier-errors";
import { exportProvider as reportChannelSales } from "./providers/report-channel-sales";
import { exportProvider as reportSerialNumbers } from "./providers/report-serial-numbers";
import { exportProvider as reportOrderInventory } from "./providers/report-order-inventory";
import { exportProvider as reportReplenishment } from "./providers/report-replenishment";
import { exportProvider as reportInventorySnapshot } from "./providers/report-inventory-snapshot";
import { exportProvider as reportChangeLog } from "./providers/report-change-log";
import { exportProvider as reportTransactionHistory } from "./providers/report-transaction-history";
import { exportProvider as reportSerialTransactions } from "./providers/report-serial-transactions";
import { exportProvider as reportMissingLog } from "./providers/report-missing-log";
import { exportProvider as reportExportHistory } from "./providers/report-export-history";
import { exportProvider as reportPoReceiving } from "./providers/report-po-receiving";
import { exportProvider as reportUserPerformance } from "./providers/report-user-performance";
import { exportProvider as users } from "./providers/users";
import { exportProvider as roles } from "./providers/roles";
import { exportProvider as auditLog } from "./providers/audit-log";
import { exportProvider as printouts } from "./providers/printouts";
import { exportProvider as screenConfigs } from "./providers/screen-configs";
import { exportProvider as billingReportLines } from "./providers/billing-report-lines";
import { exportProvider as algorithmsPutaway } from "./providers/algorithms-putaway";
import { exportProvider as algorithmsAllocation } from "./providers/algorithms-allocation";
import { exportProvider as workflows } from "./providers/workflows";
import { exportProvider as rateShoppingPresets } from "./providers/rate-shopping-presets";
import { exportProvider as channelMethods } from "./providers/channel-methods";
import { exportProvider as integrationOrders } from "./providers/integration-orders";
import { exportProvider as integrationProducts } from "./providers/integration-products";
import { exportProvider as monitoringHealth } from "./providers/monitoring-health";
import { exportProvider as monitoringRecentErrors } from "./providers/monitoring-recent-errors";
import { exportProvider as monitoringWorkflowBlocked } from "./providers/monitoring-workflow-blocked";
import { exportProvider as monitoringListingExceptions } from "./providers/monitoring-listing-exceptions";
import { exportProvider as carrierErrorsRateCall } from "./providers/carrier-errors-rate-call";
import { exportProvider as carrierErrorsVoidLabel } from "./providers/carrier-errors-void-label";

const PROVIDERS: ReadonlyMap<string, ExportProvider | null> = new Map<string, ExportProvider | null>([
  ["dev-ui-orders", devUiOrders],
  ["orders-backlog", ordersBacklog],
  ["orders-shipped", ordersShipped],
  ["shipments", shipments],
  ["end-of-day", endOfDay],
  ["shipment-history", shipmentHistory],
  ["shipment-plans", shipmentPlans],
  ["shipment-plan-orders", shipmentPlanOrders],
  ["shipment-plan-lps", shipmentPlanLps],
  ["jobs", jobs],
  ["wave-rules", waveRules],
  ["wave-log", waveLog],
  ["allocation-exceptions", allocationExceptions],
  ["shortages", shortages],
  ["tasks-order-operations", tasksOrderOperations],
  ["tasks-count", tasksCount],
  ["tasks-replenishment", tasksReplenishment],
  ["job-types", jobTypes],
  ["return-orders", returnOrders],
  ["purchase-orders", purchaseOrders],
  ["receiving-history", receivingHistory],
  ["vendors", vendors],
  ["inventory-total", inventoryTotal],
  ["inventory-by-location", inventoryByLocation],
  ["inventory-atp", inventoryAtp],
  ["count-plans", countPlans],
  ["count-locations", countLocations],
  ["count-skus", countSkus],
  ["work-orders", workOrders],
  ["kit-inventory", kitInventory],
  ["kit-components", kitComponents],
  ["products", products],
  ["product-listings", productListings],
  ["locations", locations],
  ["warehouses", warehouses],
  ["mobile-carts", mobileCarts],
  ["lp-types", lpTypes],
  ["lp-numbers", lpNumbers],
  ["shipment-packages", shipmentPackages],
  ["clients", clients],
  ["customers", customers],
  ["retailers", retailers],
  ["billing-contracts", billingContracts],
  ["billing-reports", billingReports],
  ["vas-operations", vasOperations],
  ["integration-logs", integrationLogs],
  ["integration-monitoring", integrationMonitoring],
  ["carrier-errors", carrierErrors],
  ["billing-report-lines", billingReportLines],
  ["algorithms-putaway", algorithmsPutaway],
  ["algorithms-allocation", algorithmsAllocation],
  ["workflows", workflows],
  ["rate-shopping-presets", rateShoppingPresets],
  ["channel-methods", channelMethods],
  ["integration-orders", integrationOrders],
  ["integration-products", integrationProducts],
  ["monitoring-health", monitoringHealth],
  ["monitoring-recent-errors", monitoringRecentErrors],
  ["monitoring-workflow-blocked", monitoringWorkflowBlocked],
  ["monitoring-listing-exceptions", monitoringListingExceptions],
  ["carrier-errors-rate-call", carrierErrorsRateCall],
  ["carrier-errors-void-label", carrierErrorsVoidLabel],
  ["report-channel-sales", reportChannelSales],
  ["report-serial-numbers", reportSerialNumbers],
  ["report-order-inventory", reportOrderInventory],
  ["report-replenishment", reportReplenishment],
  ["report-inventory-snapshot", reportInventorySnapshot],
  ["report-change-log", reportChangeLog],
  ["report-transaction-history", reportTransactionHistory],
  ["report-serial-transactions", reportSerialTransactions],
  ["report-missing-log", reportMissingLog],
  ["report-export-history", reportExportHistory],
  ["report-po-receiving", reportPoReceiving],
  ["report-user-performance", reportUserPerformance],
  ["users", users],
  ["roles", roles],
  ["audit-log", auditLog],
  ["printouts", printouts],
  ["screen-configs", screenConfigs],
]);

/** The module provider for `gridKey`, or null when the grid still uses the generic fallback. */
export function getModuleExportProvider(gridKey: string): ExportProvider | null {
  return PROVIDERS.get(gridKey) ?? null;
}

export function registeredProviderKeys(): readonly string[] {
  return [...PROVIDERS.keys()];
}
