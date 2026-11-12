/**
 * Import registry (BUILD_PLAN F6 `imports/`): import key -> page copy, template columns,
 * permission and handler. Page route: `/imports/<key>`. Handlers are 0.6 stubs owned by
 * the modules; columns and permissions are foundation-owned.
 */
import type { ImportColumn, ImportDefinition, ImportHandler } from "./types";
import * as ops from "./columns/operations";
import * as master from "./columns/master-data";
import { handler as shipmentOrders } from "./handlers/shipment-orders";
import { handler as shipmentOrdersUpdate } from "./handlers/shipment-orders-update";
import { handler as soSerials } from "./handlers/so-serials";
import { handler as purchaseOrders } from "./handlers/purchase-orders";
import { handler as poSerials } from "./handlers/po-serials";
import { handler as inventory } from "./handlers/inventory";
import { handler as countLocation } from "./handlers/count-location";
import { handler as countSku } from "./handlers/count-sku";
import { handler as workOrders } from "./handlers/work-orders";
import { handler as products } from "./handlers/products";
import { handler as productsUpdate } from "./handlers/products-update";
import { handler as packTypes } from "./handlers/pack-types";
import { handler as replenishmentLevels } from "./handlers/replenishment-levels";
import { handler as skuAllocation } from "./handlers/sku-allocation";
import { handler as kitComponents } from "./handlers/kit-components";
import { handler as listings } from "./handlers/listings";
import { handler as locations } from "./handlers/locations";
import { handler as locationsUpdate } from "./handlers/locations-update";
import { handler as productCapacity } from "./handlers/product-capacity";
import { handler as productCapacityUpdate } from "./handlers/product-capacity-update";
import { handler as lpCapacity } from "./handlers/lp-capacity";
import { handler as lpCapacityUpdate } from "./handlers/lp-capacity-update";
import { handler as lpNumbers } from "./handlers/lp-numbers";
import { handler as clients } from "./handlers/clients";
import { handler as vasOperations } from "./handlers/vas-operations";
import { handler as users } from "./handlers/users";
import { handler as userRoles } from "./handlers/user-roles";
import { handler as userWarehouses } from "./handlers/user-warehouses";
import { handler as userClients } from "./handlers/user-clients";

interface Entry {
  readonly key: string;
  readonly title: string;
  /** Plural noun used in the helper text ("shipment orders"). */
  readonly noun: string;
  readonly backHref: string;
  readonly backLabel: string;
  readonly permission: string;
  readonly columns: readonly ImportColumn[];
  readonly handler: ImportHandler;
  readonly update?: boolean;
}

const ENTRIES: readonly Entry[] = [
  { key: "shipment-orders", title: "Bulk Import Shipment Orders", noun: "shipment orders", backHref: "/orders", backLabel: "shipment orders", permission: "fulfillment.shipment_orders.import_file", columns: ops.SHIPMENT_ORDER_COLUMNS, handler: shipmentOrders },
  { key: "shipment-orders-update", title: "Bulk Update Shipment Orders", noun: "shipment orders", backHref: "/orders", backLabel: "shipment orders", permission: "fulfillment.shipment_orders.import_file", columns: ops.SHIPMENT_ORDER_UPDATE_COLUMNS, handler: shipmentOrdersUpdate, update: true },
  { key: "so-serials", title: "Import Serial Numbers", noun: "shipment order serial numbers", backHref: "/orders", backLabel: "shipment orders", permission: "fulfillment.shipment_orders.import_serial_numbers", columns: ops.SO_SERIAL_COLUMNS, handler: soSerials },
  { key: "purchase-orders", title: "Import Purchase Order", noun: "purchase orders", backHref: "/receiving", backLabel: "purchase orders", permission: "inventory.purchase_orders.import_file", columns: ops.PURCHASE_ORDER_COLUMNS, handler: purchaseOrders },
  { key: "po-serials", title: "Import PO Serial Numbers", noun: "purchase order serial numbers", backHref: "/receiving", backLabel: "purchase orders", permission: "inventory.purchase_orders.import_serial_numbers", columns: ops.PO_SERIAL_COLUMNS, handler: poSerials },
  { key: "inventory", title: "Import Inventory", noun: "inventory", backHref: "/inventory/by-location", backLabel: "inventory", permission: "inventory.inventory_by_location.import_file", columns: ops.INVENTORY_COLUMNS, handler: inventory },
  { key: "count-location", title: "Import Location Count Plan", noun: "location count plans", backHref: "/counts", backLabel: "count plans", permission: "inventory.count_plans.import_file", columns: ops.COUNT_LOCATION_COLUMNS, handler: countLocation },
  { key: "count-sku", title: "Import SKU Count Plan", noun: "SKU count plans", backHref: "/counts", backLabel: "count plans", permission: "inventory.count_plans.import_file", columns: ops.COUNT_SKU_COLUMNS, handler: countSku },
  { key: "work-orders", title: "Bulk Import Work Orders", noun: "work orders", backHref: "/work-orders", backLabel: "work orders", permission: "inventory.work_orders.import_file", columns: ops.WORK_ORDER_COLUMNS, handler: workOrders },
  { key: "products", title: "Bulk Import Products", noun: "products", backHref: "/products", backLabel: "products", permission: "settings.products.import_file", columns: master.PRODUCT_COLUMNS, handler: products },
  { key: "products-update", title: "Bulk Update Products", noun: "products", backHref: "/products", backLabel: "products", permission: "settings.products.import_file", columns: master.PRODUCT_UPDATE_COLUMNS, handler: productsUpdate, update: true },
  { key: "pack-types", title: "Bulk Import Pack Types & Barcodes", noun: "pack types and barcodes", backHref: "/products", backLabel: "products", permission: "settings.products.import_file", columns: master.PACK_TYPE_COLUMNS, handler: packTypes },
  { key: "replenishment-levels", title: "Bulk Import Warehouse Replenishment Levels", noun: "replenishment levels", backHref: "/products", backLabel: "products", permission: "settings.products.import_file", columns: master.REPLENISHMENT_LEVEL_COLUMNS, handler: replenishmentLevels },
  { key: "sku-allocation", title: "Bulk Import SKU Based Inventory Allocation", noun: "SKU allocations", backHref: "/products", backLabel: "products", permission: "settings.products.import_file", columns: master.SKU_ALLOCATION_COLUMNS, handler: skuAllocation },
  { key: "kit-components", title: "Bulk Update Kit Components", noun: "kit components", backHref: "/products", backLabel: "products", permission: "settings.products.import_file", columns: master.KIT_COMPONENT_COLUMNS, handler: kitComponents, update: true },
  { key: "listings", title: "Bulk Import Product Listings", noun: "product listings", backHref: "/products/listings", backLabel: "product listings", permission: "settings.product_listing.import_file", columns: master.LISTING_COLUMNS, handler: listings },
  { key: "locations", title: "Bulk Import Locations", noun: "locations", backHref: "/locations", backLabel: "locations", permission: "settings.locations.import_file", columns: master.LOCATION_COLUMNS, handler: locations },
  { key: "locations-update", title: "Bulk Update Locations", noun: "locations", backHref: "/locations", backLabel: "locations", permission: "settings.locations.import_file", columns: master.LOCATION_UPDATE_COLUMNS, handler: locationsUpdate, update: true },
  { key: "product-capacity", title: "Bulk Import Product Capacity", noun: "product capacities", backHref: "/locations", backLabel: "locations", permission: "settings.locations.import_file", columns: master.PRODUCT_CAPACITY_COLUMNS, handler: productCapacity },
  { key: "product-capacity-update", title: "Bulk Update Product Capacity", noun: "product capacities", backHref: "/locations", backLabel: "locations", permission: "settings.locations.import_file", columns: master.PRODUCT_CAPACITY_COLUMNS, handler: productCapacityUpdate, update: true },
  { key: "lp-capacity", title: "Bulk Import LP Capacity", noun: "LP capacities", backHref: "/locations", backLabel: "locations", permission: "settings.locations.import_file", columns: master.LP_CAPACITY_COLUMNS, handler: lpCapacity },
  { key: "lp-capacity-update", title: "Bulk Update LP Capacity", noun: "LP capacities", backHref: "/locations", backLabel: "locations", permission: "settings.locations.import_file", columns: master.LP_CAPACITY_COLUMNS, handler: lpCapacityUpdate, update: true },
  { key: "lp-numbers", title: "Import LP Number", noun: "LP numbers", backHref: "/settings/lp-numbers", backLabel: "LP numbers", permission: "settings.lp_numbers.import_file", columns: master.LP_NUMBER_COLUMNS, handler: lpNumbers },
  { key: "clients", title: "Bulk Import Clients", noun: "clients", backHref: "/clients", backLabel: "clients", permission: "settings.clients.import_file", columns: master.CLIENT_COLUMNS, handler: clients },
  { key: "vas-operations", title: "Bulk Import VAS Operations", noun: "VAS operations", backHref: "/billing/vas", backLabel: "VAS operations", permission: "settings.vas_operations.import_file", columns: master.VAS_OPERATION_COLUMNS, handler: vasOperations },
  { key: "users", title: "Bulk Import Users", noun: "users", backHref: "/settings/users", backLabel: "users", permission: "settings.users.import_file", columns: master.USER_COLUMNS, handler: users },
  { key: "user-roles", title: "Import User-Role", noun: "user roles", backHref: "/settings/users", backLabel: "users", permission: "settings.users.import_file", columns: master.USER_ROLE_COLUMNS, handler: userRoles },
  { key: "user-warehouses", title: "Assign/Unassign User-Warehouse", noun: "user warehouse assignments", backHref: "/settings/users", backLabel: "users", permission: "settings.users.import_file", columns: master.USER_WAREHOUSE_COLUMNS, handler: userWarehouses },
  { key: "user-clients", title: "Assign/Unassign User-Client", noun: "user client assignments", backHref: "/settings/users", backLabel: "users", permission: "settings.users.import_file", columns: master.USER_CLIENT_COLUMNS, handler: userClients },
];

function toDefinition(entry: Entry): ImportDefinition {
  const verb = entry.update ? "bulk update" : "bulk import";
  return {
    key: entry.key,
    title: entry.title,
    description: `You can ${verb} ${entry.noun} by using an Excel file. Excel file import history will be listed below. You can reach old import files there.`,
    backHref: entry.backHref,
    backLabel: `Go back to ${entry.backLabel}`,
    permission: entry.permission,
    templateColumns: entry.columns,
    handler: entry.handler,
  };
}

export const IMPORT_DEFINITIONS: readonly ImportDefinition[] = Object.freeze(ENTRIES.map(toDefinition));
export const IMPORT_KEYS: readonly string[] = Object.freeze(IMPORT_DEFINITIONS.map((def) => def.key));

const BY_KEY: ReadonlyMap<string, ImportDefinition> = new Map(IMPORT_DEFINITIONS.map((def) => [def.key, def]));

export function getImportDefinition(key: string): ImportDefinition | undefined {
  return BY_KEY.get(key);
}

/** Client-safe summary for the import page (no handler). */
export interface ImportDefinitionSummary {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly backHref: string;
  readonly backLabel: string;
  readonly permission: string;
  readonly configured: boolean;
  readonly columns: readonly ImportColumn[];
}

export function summarizeImport(def: ImportDefinition): ImportDefinitionSummary {
  return {
    key: def.key,
    title: def.title,
    description: def.description,
    backHref: def.backHref,
    backLabel: def.backLabel,
    permission: def.permission,
    configured: def.handler.configured,
    columns: def.templateColumns,
  };
}
