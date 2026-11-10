/**
 * Import key -> required permission, as a leaf module with no handler imports. Readers that
 * only need the permission (file downloads of an import batch in `platform-files`) use this so
 * notes / attachments routes do not pull every module's import handler into their bundle: one
 * broken handler must not take Notes and Documents down. Kept equal to the registry by a unit test.
 */
export const IMPORT_PERMISSIONS: Readonly<Record<string, string>> = Object.freeze(
{
    "shipment-orders": "fulfillment.shipment_orders.import_file",
    "shipment-orders-update": "fulfillment.shipment_orders.import_file",
    "so-serials": "fulfillment.shipment_orders.import_serial_numbers",
    "purchase-orders": "inventory.purchase_orders.import_file",
    "po-serials": "inventory.purchase_orders.import_serial_numbers",
    "inventory": "inventory.inventory_by_location.import_file",
    "count-location": "inventory.count_plans.import_file",
    "count-sku": "inventory.count_plans.import_file",
    "work-orders": "inventory.work_orders.import_file",
    "products": "settings.products.import_file",
    "products-update": "settings.products.import_file",
    "pack-types": "settings.products.import_file",
    "replenishment-levels": "settings.products.import_file",
    "sku-allocation": "settings.products.import_file",
    "kit-components": "settings.products.import_file",
    "listings": "settings.product_listing.import_file",
    "locations": "settings.locations.import_file",
    "locations-update": "settings.locations.import_file",
    "product-capacity": "settings.locations.import_file",
    "product-capacity-update": "settings.locations.import_file",
    "lp-capacity": "settings.locations.import_file",
    "lp-capacity-update": "settings.locations.import_file",
    "lp-numbers": "settings.lp_numbers.import_file",
    "clients": "settings.clients.import_file",
    "vas-operations": "settings.vas_operations.import_file",
    "users": "settings.users.import_file",
    "user-roles": "settings.users.import_file",
    "user-warehouses": "settings.users.import_file",
    "user-clients": "settings.users.import_file"
  }
);
