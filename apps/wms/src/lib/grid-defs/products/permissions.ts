/**
 * Catalog read permissions (M09). Product lookup (SKU, barcodes, pack-type dims) is baseline
 * for floor roles, as in Logiwa: anyone who can view inventory can read the products that
 * inventory is made of. Reads therefore accept either the catalog's own view key or the
 * Total Inventory view key (held by the default operator and viewer roles). Every mutation
 * stays gated by its own `settings.products.*` / `settings.product_listing.*` key.
 */
export const PRODUCT_READ_PERMISSIONS = ['settings.products.view', 'inventory.total_inventory.view'] as const;
export const LISTING_READ_PERMISSIONS = [
  'settings.product_listing.view',
  'inventory.total_inventory.view',
] as const;
