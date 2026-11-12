/** Permission keys used by the inventory pages and APIs (catalog: Inventory › Inventory). */
export const INVENTORY_PERMISSIONS = {
  totalView: "inventory.total_inventory.view",
  byLocationView: "inventory.inventory_by_location.view",
  atpView: "inventory.atp.view",
  importFile: "inventory.inventory_by_location.import_file",
  addLine: "inventory.inventory_by_location.add_inventory_by_line",
  adjustLine: "inventory.inventory_by_location.adjust_inventory_by_line",
  removeLine: "inventory.inventory_by_location.remove_inventory_by_line",
  changeAttributes: "inventory.inventory_by_location.change_attributes",
  transferLpLocation: "inventory.inventory_by_location.transfer_lp_location",
  transferProduct: "inventory.inventory_by_location.transfer_product",
  addByAttributes: "inventory.inventory_by_location.add_inventory_by_attributes",
} as const;
