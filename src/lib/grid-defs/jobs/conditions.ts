/**
 * Order condition catalog shared by the wave-rule Selection step and the job-type
 * Conditions step (Logiwa 02 §2/§6). Field keys are the `orderFacts()` keys the domain
 * evaluates (`src/server/domain/facts.ts`); values are stored as `FilterCondition[]`.
 */
import type { FilterFieldDef } from "@/components/grid/grid-types";
import { ORDER_CHANNELS, PRIORITIES } from "@/lib/enums";
import { JOB_ORDER_SCOPES, JOB_TEMPLATES, type JobTypeSettings } from "@/lib/domain-types";
import { field, opts } from "./shared";

/** 36 order fields. Lookup-backed enums (order type, product group…) get options at runtime. */
export const ORDER_CONDITION_FIELDS: readonly FilterFieldDef[] = [
  field("carrier", "Carrier", "text"),
  field("carrierRate", "Carrier rate", "number", { decimals: 2 }),
  field("channel", "Channel", "enum", { options: opts(ORDER_CHANNELS) }),
  field("city", "City", "text"),
  field("client", "Client", "enum", { description: "Client of the order" }),
  field("country", "Country", "text"),
  field("expectedShipmentDate", "Expected shipment date", "date"),
  field("fraud", "Fraud", "text"),
  field("isBackOrder", "Is back order", "boolean"),
  field("isGift", "Is gift", "boolean"),
  field("isOversized", "Is oversized", "boolean"),
  field("isPartial", "Is partial", "boolean"),
  field("numberOfBoxes", "Number of boxes", "number"),
  field("orderPrice", "Order price", "number", { decimals: 2 }),
  field("orderQuantity", "Order quantity", "number"),
  field("orderTag", "Order tag", "text"),
  field("orderType", "Order type", "enum", { description: "Shipment order type" }),
  field("plannedShipmentDate", "Planned shipment date", "date"),
  field("precartonizationType", "Precartonization type", "text"),
  field("priority", "Priority", "enum", { options: opts(PRIORITIES) }),
  field("productGroup", "Product group", "enum"),
  field("productPackType", "Product pack type", "text"),
  field("retailer", "Retailer", "text"),
  field("shipmentMethod", "Shipment method", "text"),
  field("shipmentOrderDate", "Shipment order date", "date"),
  field("shipmentPackage", "Shipment package", "text"),
  field("sku", "SKU", "text"),
  field("customField.date1", "SO custom field date time 1", "date", { group: "Custom fields" }),
  field("customField.date2", "SO custom field date time 2", "date", { group: "Custom fields" }),
  field("customField.dropDown1", "SO custom field drop down 1", "text", { group: "Custom fields" }),
  field("customField.dropDown2", "SO custom field drop down 2", "text", { group: "Custom fields" }),
  field("customField.textBox1", "SO custom field text box 1", "text", { group: "Custom fields" }),
  field("customField.textBox2", "SO custom field text box 2", "text", { group: "Custom fields" }),
  field("customField.textBox3", "SO custom field text box 3", "text", { group: "Custom fields" }),
  field("customField.toggle1", "SO custom field toggle 1", "boolean", { group: "Custom fields" }),
  field("store", "Store", "text"),
];

export interface OrderByOption {
  readonly value: string;
  readonly label: string;
}

/** Wave rule "Order By" (order release sort). */
export const WAVE_ORDER_BY_OPTIONS: readonly OrderByOption[] = [
  { value: "shipmentOrderDate", label: "Shipment order date" },
  { value: "expectedShipmentDate", label: "Expected shipment date" },
  { value: "carrierRate", label: "Carrier rate" },
  { value: "priority", label: "Priority" },
  { value: "orderQuantity", label: "Order quantity" },
  { value: "orderPrice", label: "Order price" },
  { value: "customField.date1", label: "Custom field date time 1" },
  { value: "customField.date2", label: "Custom field date time 2" },
  { value: "customField.toggle1", label: "Custom field toggle 1" },
  { value: "customField.dropDown1", label: "Custom field drop down 1" },
  { value: "customField.textBox1", label: "Custom field text box 1" },
];

/** Job type "Order by Picking Method" (task sequence). Keys are `bucketFacts()` keys. */
export const PICKING_METHOD_OPTIONS: readonly OrderByOption[] = [
  { value: "walkingPathPriority", label: "Walking path priority" },
  { value: "location", label: "Location code" },
  { value: "aisle", label: "Location aisle" },
  { value: "column", label: "Location column" },
  { value: "level", label: "Location level" },
  { value: "zone", label: "Location zone" },
  { value: "expiryDate", label: "Expiry date" },
  { value: "lotBatchNumber", label: "Lot / batch number" },
  { value: "receivingDate", label: "Receiving date" },
  { value: "freeInventory", label: "Free inventory" },
];

export const COUNT_METHOD_OPTIONS: readonly OrderByOption[] = [
  { value: "walkingPathPriority", label: "Walking path priority" },
  { value: "aisle", label: "Location aisle" },
  { value: "level", label: "Location level" },
  { value: "zone", label: "Location zone" },
  { value: "sku", label: "SKU" },
];

export const GROUPING_OPTIONS: readonly OrderByOption[] = [
  { value: "locationZone", label: "Location zone" },
  { value: "productGroup", label: "Product group" },
  { value: "carrier", label: "Carrier" },
  { value: "areaType", label: "Area type" },
  { value: "client", label: "Client" },
  { value: "orderTag", label: "Order tag" },
];

/** Location / LP / product condition fields for count and replenishment job types. */
export const LOCATION_CONDITION_FIELDS: readonly FilterFieldDef[] = [
  field("location", "Location code", "text"),
  field("zone", "Location zone", "text"),
  field("aisle", "Aisle", "text"),
  field("level", "Level", "text"),
  field("areaType", "Area type", "enum", { options: opts(["Storage", "Picking", "Receiving", "Packing", "Shipment", "Returns"]) }),
  field("abcCode", "ABC code", "text"),
  field("replenishmentType", "Replenishment type", "enum", { options: opts(["Source", "Target", "None"]) }),
];

export const PRODUCT_CONDITION_FIELDS: readonly FilterFieldDef[] = [
  field("sku", "SKU", "text"),
  field("productGroup", "Product group", "text"),
  field("productType", "Product type", "text"),
  field("inventoryPackType", "Pack type", "text"),
];

export const LP_CONDITION_FIELDS: readonly FilterFieldDef[] = [
  field("lpNumber", "LP number", "text"),
  field("inventoryLotBatchNumber", "Lot / batch number", "text"),
  field("inventoryExpiryDate", "Expiry date", "date"),
];

/* ------------------------------------------------------------- templates */

export interface TemplateDef {
  readonly key: (typeof JOB_TEMPLATES)[number];
  readonly badge?: "NEW" | "BETA";
  readonly description: string;
  readonly orderScope: (typeof JOB_ORDER_SCOPES)[number];
  readonly picking: Partial<JobTypeSettings["picking"]>;
  readonly batch?: Partial<JobTypeSettings["batch"]>;
}

export const JOB_TEMPLATE_DEFS: readonly TemplateDef[] = [
  { key: "Custom", description: "Proceed without using a template.", orderScope: "All Orders", picking: {} },
  { key: "Single Item Order", description: "One unit per order: pick in a batch, pack straight from the cart.", orderScope: "Single Item Orders", picking: { onlyPick: false }, batch: { method: "Nof Order", min: 1, max: 50 } },
  { key: "Multi-Item Orders", description: "Several items per order: pick to totes and sort before packing.", orderScope: "Multi-Item Orders", picking: { createSortingTask: true }, batch: { method: "Nof Order", min: 1, max: 20 } },
  { key: "Identical Item Orders", description: "Orders with the same lines are batched together.", orderScope: "Identical Item Orders", picking: {}, batch: { method: "Nof Order", min: 2, max: 100 } },
  { key: "Pre-Cartonization", badge: "NEW", description: "Cartons are suggested before picking; pick straight into the box.", orderScope: "All Orders", picking: { onlyPick: true } },
  { key: "Single SKU Cluster Pick", description: "One SKU per cluster, consolidated pick across orders.", orderScope: "Identical Item Orders", picking: { autoCompletePickingTasks: true } },
  { key: "Putwall Process", description: "Pick in bulk, then sort orders into putwall cells.", orderScope: "Multi-Item Orders", picking: { createSortingTask: true, oneByOneSorting: true } },
  { key: "Retailer Compliance", badge: "BETA", description: "B2B retailer orders with compliance labels and a loading step.", orderScope: "All Orders", picking: { createLoadingTask: true } },
  { key: "Identical Kit to Order", badge: "NEW", description: "Kits with identical components picked and assembled together.", orderScope: "Identical Kit to Order", picking: {} },
];

/** The 10 Yes/No picking flags with their tooltips (Logiwa 02 §6 step 3). */
export const PICKING_FLAG_DEFS: readonly { readonly key: keyof JobTypeSettings["picking"]; readonly label: string; readonly tip: string; readonly requires?: keyof JobTypeSettings["picking"] }[] = [
  { key: "overrideForLastJob", label: "Override for last job", tip: "Orders that arrive while the last job of this type is open are added to it." },
  { key: "onlyPick", label: "Only pick", tip: "Jobs stop after picking: no packing tasks are created." },
  { key: "onlyPack", label: "Only pack", tip: "Picking is done outside the system; jobs only contain packing tasks." },
  { key: "createLoadingTask", label: "Create loading task", tip: "Adds a loading task per order after packing." },
  { key: "disableFullLpPicking", label: "Disable full LP picking", tip: "Pickers must scan items, even when a whole LP is allocated." },
  { key: "autoCompletePickingTasks", label: "Auto complete picking tasks", tip: "Picking tasks complete automatically when the order is packed." },
  { key: "createSortingTask", label: "Create sorting task", tip: "Adds a sorting step between picking and packing." },
  { key: "oneByOneSorting", label: "One by one sorting", tip: "Each unit is scanned during sorting.", requires: "createSortingTask" },
  { key: "disableToteScanning", label: "Disable tote scanning", tip: "Pickers do not have to scan a tote before picking.", requires: "createSortingTask" },
  { key: "enablePickerSelfAssign", label: "Enable picker self-assign", tip: "Pickers can assign pool jobs to themselves on the handheld." },
];
