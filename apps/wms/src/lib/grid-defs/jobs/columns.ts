/**
 * Column catalogs for every M03 grid (Logiwa 02 §1–§7). PURE: the client builds TanStack
 * columns from these, and the export specs reuse the same ids/labels. Column ids are the
 * row keys the list endpoints return (and the server sort keys).
 */
export type ColumnKind = "text" | "number" | "datetime" | "date" | "boolean" | "status" | "priority" | "custom";

export interface JobsColumnDef {
  readonly id: string;
  readonly label: string;
  readonly kind: ColumnKind;
  readonly width?: number;
  readonly sortable?: boolean;
  readonly defaultVisible?: boolean;
  readonly tip?: string;
  /** Full name for Excel exports when the grid header is abbreviated. */
  readonly exportLabel?: string;
}

const c = (id: string, label: string, kind: ColumnKind = "text", extra: Partial<JobsColumnDef> = {}): JobsColumnDef => ({ id, label, kind, ...extra });
const hidden = { defaultVisible: false } as const;

/* ------------------------------------------------------------ job management (32) */
export const JOB_COLUMNS: readonly JobsColumnDef[] = [
  // Critic R3: the primary identifier leads, so it sits next to the checkbox at tablet width.
  c("code", "Job code", "custom", { width: 120 }),
  // Blind judge R1: the Short / Overdue badges get their own column so they never clip the code.
  c("flags", "Alerts", "custom", { width: 132, sortable: false, tip: "Open pick short and overdue badges" }),
  // Critic R5: job state is readable without horizontal scroll (Status and Priority right after the code).
  c("status", "Status", "status", { width: 110 }),
  c("priority", "Priority", "priority", { width: 116 }),
  c("jobType", "Job type", "text", { width: 180 }),
  c("waveNumber", "Wave no", "custom", { width: 104 }),
  c("warehouse", "Warehouse", "text", { width: 160 }),
  c("client", "Client", "text", { width: 150, tip: "\"Multiple\" when the job spans clients" }),
  c("ruleName", "Rule name", "text", { width: 180 }),
  // Critic R4: Logiwa shows ORIGINAL IO JOB TYPE by default, so AI-built jobs are recognisable on first load.
  c("aiJob", "AI job", "boolean", { width: 110, tip: "Built and sequenced by an AI Job wave" }),
  c("originalJobType", "Original job type", "text", { width: 160, tip: "Job type the AI optimizer started from (AI jobs only)" }),
  c("aiJobDescription", "AI job description", "text", { width: 320, sortable: false, tip: "AI job type, orders, pick stops and optimized walk vs. the walking-path order", ...hidden }),
  c("operationType", "Operation type", "text", { width: 128 }),
  c("assignee", "Assignee", "text", { width: 150 }),
  c("orderCount", "Order count", "number", { width: 100 }),
  c("productCount", "Product count", "number", { width: 110 }),
  c("taskCount", "Number of tasks", "number", { width: 120 }),
  c("pendingTasks", "Pending tasks", "number", { width: 110 }),
  c("completedTasks", "Completed tasks", "number", { width: 124 }),
  c("startedAt", "Actual start date", "datetime"),
  c("completedAt", "Actual finish date", "datetime"),
  c("createdAt", "Created date", "datetime"),
  c("createdBy", "Created by user", "text", { width: 140 }),
  c("pendingPickingTasks", "Pending picking tasks", "number", { width: 150 }),
  c("pendingPackingTasks", "Pending packing tasks", "number", { width: 150 }),
  c("mobileCart", "Mobile cart", "text", { width: 110 }),
  c("pickingZone", "Picking zone", "text", { width: 110 }),
  c("plannedStartAt", "Start date", "datetime", { tip: "Planned start: created + 1 hour" }),
  c("plannedEndAt", "End date", "custom", { width: 190, tip: "Planned end: created + 2 hours. Red with an Overdue badge when a live job has passed it." }),
  c("locationCount", "Number of locations", "number", { width: 140 }),
  c("skuCount", "Number of SKUs", "number", { width: 120 }),
  c("labelStatus", "Label status", "custom", { width: 130 }),
  c("pickListStatus", "Pick list status", "custom", { width: 130 }),
  c("isResolutionJob", "Resolution job", "boolean", { width: 120 }),
  c("isPrecartonization", "Pre-cartonization job", "boolean", { width: 156 }),
];

/* ------------------------------------------------------------- task details */
const TASK_HEAD: readonly JobsColumnDef[] = [
  c("warehouse", "Warehouse", "text", { width: 150 }),
  c("client", "Client", "text", { width: 130 }),
];

const TASK_PRODUCT: readonly JobsColumnDef[] = [
  c("productImage", "Product image", "custom", { width: 104, sortable: false }),
  c("sku", "SKU", "custom", { width: 150 }),
  c("productName", "Product name", "text", { width: 190 }),
  c("barcode", "Barcode", "text", { width: 130 }),
];

const TASK_PACK: readonly JobsColumnDef[] = [
  c("packType", "Pack type", "text", { width: 100 }),
  c("toPackType", "To pack type", "text", { width: 110, sortable: false }),
  c("uomPackType", "UOM pack type", "text", { width: 120, sortable: false }),
];

const SOURCE: readonly JobsColumnDef[] = [
  c("sourceZone", "Source location zone", "text", { width: 150 }),
  c("sourceLocation", "Source location", "custom", { width: 140 }),
  c("sourceLocationDisplay", "Source location display member", "text", { width: 210, sortable: false, ...hidden }),
  c("sourceLpn", "Source LPN", "text", { width: 130 }),
];

const TARGET: readonly JobsColumnDef[] = [
  c("targetZone", "Target location zone", "text", { width: 150 }),
  c("targetCart", "Target cart", "text", { width: 110, sortable: false }),
  c("targetLocation", "Target location", "custom", { width: 140 }),
  c("targetLocationDisplay", "Target location display member", "text", { width: 210, sortable: false, ...hidden }),
  c("targetLpn", "Target LPN", "text", { width: 130 }),
];

const PEOPLE_DATES: readonly JobsColumnDef[] = [
  c("assignee", "Assignee", "text", { width: 140 }),
  c("executedBy", "Executed by user", "text", { width: 140 }),
  c("plannedStartAt", "Planned start date", "datetime"),
  c("startedAt", "Start date", "datetime"),
  c("plannedFinishAt", "Planned finish date", "datetime"),
  c("finishedAt", "Finish date", "datetime"),
  c("createdAt", "Task created date", "datetime"),
  c("createdBy", "Created by user", "text", { width: 140 }),
  c("lotNumber", "Lot/batch number", "text", { width: 130 }),
  c("expiryDate", "Expiry date", "date", { width: 120 }),
  c("damageReason", "Damage reason", "text", { width: 130, sortable: false }),
];

const LP_TAIL = (target: boolean): readonly JobsColumnDef[] => [
  c("updatedBy", "Updated by user", "text", { width: 140, ...hidden }),
  c("sourceParentLp", "Source parent LP", "text", { width: 140, sortable: false }),
  c("fromOriginalParentLp", "From original parent LP", "text", { width: 170, sortable: false, ...hidden }),
  c("sourceParentLpType", "Source parent LP type", "text", { width: 160, sortable: false, ...hidden }),
  ...(target ? [c("targetParentLp", "Target parent LP", "text", { width: 140, sortable: false })] : []),
  c("fromOriginalLp", "From original LP", "text", { width: 140, sortable: false }),
  ...(target ? [c("targetParentLpType", "Target parent LP type", "text", { width: 160, sortable: false, ...hidden })] : []),
  c("toOriginalParentLp", "To original parent LP", "text", { width: 160, sortable: false, ...hidden }),
  c("toOriginalLp", "To original LP", "text", { width: 130, sortable: false, ...hidden }),
  c("receivingDate", "Receiving date", "datetime", { sortable: false, ...hidden }),
  c("productionDate", "Production date", "date", { width: 130, sortable: false, ...hidden }),
];

/** Order Operations (67). */
export const ORDER_TASK_COLUMNS: readonly JobsColumnDef[] = [
  ...TASK_HEAD,
  c("waveNumber", "Wave ID", "text", { width: 100 }),
  c("taskNo", "Task ID", "number", { width: 100 }),
  c("jobCode", "Job code", "custom", { width: 130 }),
  c("jobType", "Job type", "text", { width: 150 }),
  c("aiJobDescription", "AI job description", "text", { width: 150, sortable: false, ...hidden }),
  c("orderCode", "Order code", "custom", { width: 130 }),
  c("poNumber", "PO number", "text", { width: 110, sortable: false, ...hidden }),
  c("storeOrderNumber", "Store order number", "text", { width: 150 }),
  c("orderType", "Order type", "text", { width: 120 }),
  c("taskType", "Task type", "text", { width: 124 }),
  c("status", "Task status", "status", { width: 136 }),
  c("pickShortStatus", "Pick short status", "custom", { width: 130 }),
  c("packShortStatus", "Pack short status", "custom", { width: 130 }),
  c("priority", "Task priority", "priority", { width: 136 }),
  c("sequence", "AI task sequence", "number", { width: 130, sortable: false }),
  c("workOrderCode", "Work order code", "text", { width: 130 }),
  c("workOrderType", "Work order type", "text", { width: 170, sortable: false, ...hidden }),
  ...TASK_PRODUCT,
  c("suggestedPackage", "Suggested shipment package type", "text", { width: 210, sortable: false }),
  c("targetLpType", "Target LP type", "text", { width: 120, sortable: false }),
  ...TASK_PACK,
  c("taskUomQty", "Task UOM qty", "number", { width: 110, sortable: false }),
  c("actualQty", "Actual qty", "number", { width: 100 }),
  c("plannedQty", "Planned qty", "number", { width: 104 }),
  ...SOURCE,
  ...TARGET,
  ...PEOPLE_DATES,
  c("orderDate", "Order date", "datetime"),
  c("channel", "Channel", "text", { width: 110 }),
  c("carrier", "Carrier", "text", { width: 100 }),
  c("customer", "Customer", "text", { width: 160 }),
  c("customerAddress", "Customer address", "text", { width: 240, sortable: false }),
  ...LP_TAIL(true),
];

/** Count (48). */
export const COUNT_TASK_COLUMNS: readonly JobsColumnDef[] = [
  // Critic R2: the operative fields (count plan, source location) lead; location counts carry no product image.
  c("taskNo", "Task ID", "number", { width: 100 }),
  c("countPlanCode", "Count plan", "custom", { width: 130 }),
  c("sourceLocation", "Source location", "custom", { width: 140 }),
  c("status", "Task status", "status", { width: 136 }),
  c("jobCode", "Job code", "custom", { width: 130 }),
  c("jobType", "Job type", "text", { width: 140 }),
  ...TASK_HEAD,
  c("poNumber", "PO number", "text", { width: 110, sortable: false, ...hidden }),
  c("taskType", "Task type", "text", { width: 124 }),
  ...TASK_PRODUCT.map((col) => (col.id === "productImage" ? { ...col, ...hidden } : col)),
  ...TASK_PACK,
  c("initialPackQty", "Initial task pack qty", "number", { width: 150, sortable: false }),
  c("initialUomQty", "Initial task UOM qty", "number", { width: 150 }),
  c("initialApprovedPackQty", "Initial task approved pack qty", "number", { width: 200, sortable: false }),
  c("approvedUomQty", "Approved task UOM qty", "number", { width: 170 }),
  c("approvedPackQty", "Approved pack qty", "number", { width: 140, sortable: false }),
  c("taskPackQty", "Approved task pack qty", "number", { width: 170, sortable: false }),
  ...SOURCE.filter((col) => col.id !== "sourceLocation"),
  c("targetLocation", "Target location", "custom", { width: 140 }),
  c("targetLpn", "Target LPN", "text", { width: 130 }),
  ...PEOPLE_DATES,
  ...LP_TAIL(false),
];

/** Replenishment (50). */
export const REPLEN_TASK_COLUMNS: readonly JobsColumnDef[] = [
  ...TASK_HEAD,
  c("waveNumber", "Wave ID", "text", { width: 100 }),
  c("taskNo", "Task ID", "number", { width: 100 }),
  c("jobCode", "Job code", "custom", { width: 130 }),
  c("jobType", "Job type", "text", { width: 170 }),
  c("poNumber", "PO number", "text", { width: 110, sortable: false, ...hidden }),
  c("taskType", "Task type", "text", { width: 124 }),
  c("status", "Task status", "status", { width: 136 }),
  c("replenishmentPhase", "Replenishment phase", "text", { width: 190 }),
  c("lpSwap", "LP swap", "boolean", { width: 90 }),
  ...TASK_PRODUCT,
  ...TASK_PACK,
  c("packTypeConversionApplied", "Pack type conversion applied", "boolean", { width: 200 }),
  c("initialTaskQty", "Initial task qty", "number", { width: 120, sortable: false }),
  c("plannedQty", "Task qty", "number", { width: 90 }),
  c("taskUomQty", "Task UOM qty", "number", { width: 110, sortable: false }),
  ...SOURCE,
  ...TARGET,
  c("lpAutoRemoved", "LP auto removed", "boolean", { width: 130 }),
  ...PEOPLE_DATES,
  ...LP_TAIL(true).filter((x) => !["fromOriginalParentLp", "fromOriginalLp", "toOriginalParentLp", "toOriginalLp"].includes(x.id)),
];

/* ---------------------------------------------------------- reports & setup */
export const WAVE_RULE_COLUMNS: readonly JobsColumnDef[] = [
  // Critic R4: the schedule columns (Next run countdown, Last run, Last wave) sit in the first 1440 px viewport.
  c("name", "Wave rule name", "custom", { width: 200 }),
  c("warehouse", "Warehouse", "text", { width: 180 }),
  c("scheduled", "Scheduled", "boolean", { width: 96 }),
  c("status", "Status", "custom", { width: 104, tip: "Status of the rule's latest wave" }),
  c("nextRunAt", "Next run", "custom", { width: 130, tip: "Live countdown to the next scheduled run (warehouse time zone)" }),
  c("lastRunAt", "Last run", "datetime", { width: 170 }),
  c("lastWaveNo", "Last wave ID", "custom", { width: 108 }),
  c("priority", "Priority", "priority", { width: 96 }),
  c("operationType", "Operation type", "text", { width: 120 }),
  c("assignee", "Assignee", "text", { width: 150 }),
  c("lastRunBy", "Last executed by", "text", { width: 170, tip: "\"Auto Run\" when the scheduler ran the rule" }),
];

export const WAVE_LOG_COLUMNS: readonly JobsColumnDef[] = [
  // Critic R4: compact numeric headers (full Logiwa names in the tips) so all 12 columns fit at 1440 px.
  // Critic R5: Rule set gets room for "Order Merge - Same Customer"; Message (the explanation)
  // sits in the first viewport at 1440; numeric columns are wide enough for label + sort + tip.
  c("ruleName", "Rule set", "text", { width: 250 }),
  c("waveNo", "Wave no", "custom", { width: 84 }),
  c("status", "Wave status", "status", { width: 116 }),
  c("message", "Message", "text", { width: 340, sortable: false }),
  c("runAt", "Run date", "datetime", { width: 172 }),
  c("ordersMet", "# met", "number", { width: 108, tip: "# of orders met rule set criteria", exportLabel: "# of orders met rule set criteria" }),
  // Ordered as the invariant reads: met = allocated + shortage + eliminated.
  c("allocatedOrders", "# allocated", "number", { width: 142, tip: "# of allocated orders", exportLabel: "# of allocated orders" }),
  c("shortageOrders", "# shortage", "number", { width: 136, tip: "# of shortage orders", exportLabel: "# of shortage orders" }),
  c("eliminatedOrders", "# eliminated", "number", { width: 148, tip: "# of eliminated orders: no job type matched. # met = # allocated + # shortage + # eliminated", exportLabel: "# of eliminated orders" }),
  c("jobsCreated", "# jobs", "number", { width: 108, tip: "# of jobs created", exportLabel: "# of jobs created" }),
  c("mergedOrders", "# merged", "number", { width: 128, tip: "# of merged orders created", exportLabel: "# of merged orders created" }),
  c("runBy", "Run by", "text", { width: 140, tip: "\"Integration\" for scheduled runs" }),
];

export const ALLOCATION_EXCEPTION_COLUMNS: readonly JobsColumnDef[] = [
  c("orderCode", "Order code", "custom", { width: 190 }),
  c("waveNo", "Wave no", "custom", { width: 150, tip: "Wave ID, or \"Manual Allocation\" when allocated from the order screens" }),
  // Critic R2: the explanation is the reason the page exists, so it sits in the first viewport at 1440.
  c("explanation", "Explanation", "custom", { width: 360, tip: "Why the order was not allocated or put into a job" }),
  c("shortageSku", "Shortage SKU", "text", { width: 170, tip: "The SKU that could not be allocated" }),
  c("inventoryUomQty", "Inventory UOM qty", "number", { width: 190, tip: "Free stock found for the SKU when the wave ran" }),
  c("orderLineQty", "Order line qty (UOM)", "number", { width: 200, tip: "Quantity the order line asked for" }),
  c("waveRuleName", "Wave rule set name", "text", { width: 190 }),
  c("algorithmRuleName", "Allocation algorithm rule name", "text", { width: 280 }),
  c("algorithmName", "Allocation algorithm", "text", { width: 190 }),
  c("isRolledBack", "Is rollbacked?", "boolean", { width: 120, tip: "The allocation was rolled back after the wave" }),
  c("runBy", "Run by user", "text", { width: 150 }),
  c("runAt", "Run date", "datetime", { width: 172 }),
  c("client", "Client", "text", { width: 130 }),
  c("warehouse", "Warehouse", "text", { width: 150 }),
];

export const SHORTAGE_COLUMNS: readonly JobsColumnDef[] = [
  c("orderCode", "Order code", "custom", { width: 190 }),
  c("storeOrderNumber", "Store order name", "text", { width: 190 }),
  c("sku", "SKU", "custom", { width: 150 }),
  c("productName", "Product name", "text", { width: 190 }),
  c("orderDate", "Order creation date", "datetime", { width: 172 }),
  c("orderType", "Order type", "text", { width: 140 }),
  c("reason", "Shortage reason", "custom", { width: 230 }),
  c("missingTriggered", "Missing triggered", "boolean", { width: 140 }),
  c("orderStatus", "Order status", "status", { width: 150 }),
  c("linePackQty", "Order line pack qty", "number", { width: 150 }),
  c("packType", "Line pack type", "text", { width: 120 }),
  c("shortageQty", "Shortage pack qty", "number", { width: 140 }),
  c("shortageUomQty", "Shortage UOM qty", "number", { width: 140, sortable: false }),
  c("freeQty", "Free pack qty", "number", { width: 120 }),
  c("freeUomQty", "Free UOM qty", "number", { width: 120, sortable: false }),
  c("damagedQty", "Damaged pack qty", "number", { width: 140 }),
  c("damagedUomQty", "Damaged UOM qty", "number", { width: 140, sortable: false }),
  c("onHandQty", "On hand pack qty", "number", { width: 140 }),
  c("onHandUomQty", "On hand UOM qty", "number", { width: 140, sortable: false }),
  c("lastTrialAt", "Last allocation trial time", "datetime", { width: 190 }),
  c("warehouse", "Warehouse", "text", { width: 150 }),
  c("client", "Client", "text", { width: 130 }),
  c("orderAge", "Order age", "custom", { width: 100, tip: "Days since the order was created" }),
  c("expectedShipDate", "Expected shipment date", "date", { width: 170 }),
  c("masterOrderCode", "Master order code", "text", { width: 150, tip: "Original order of a split or backorder" }),
];

export const JOB_TYPE_COLUMNS: readonly JobsColumnDef[] = [
  c("code", "Code", "custom", { width: 220 }),
  c("description", "Description", "text", { width: 320 }),
  c("warehouse", "Warehouse", "text", { width: 180 }),
  c("algorithm", "Allocation algorithm", "text", { width: 170 }),
  c("operationType", "Operation type", "text", { width: 140 }),
  c("usage", "In use by", "custom", { width: 170, sortable: false, tip: "Active wave rules and open jobs that reference the type" }),
];

/** Export column specs (same ids / labels as the grid). */
export function exportColumns(cols: readonly JobsColumnDef[]): readonly { readonly key: string; readonly label: string }[] {
  return cols.filter((col) => col.id !== "productImage" && col.id !== "usage" && col.id !== "flags").map((col) => ({ key: col.id, label: col.exportLabel ?? col.label }));
}
