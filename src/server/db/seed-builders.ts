/**
 * Inventory, purchase-order, job and audit-log generation for the seed
 * script (pure functions, no DB).
 */
import type {
  auditLog,
  inventory,
  jobs,
  purchaseOrderLines,
  purchaseOrders,
} from "./schema";
import { Rng, VENDORS_BY_CATEGORY } from "./seed-data";
import { isoDaysAgo, isoShift, type ProductRef } from "./seed-orders";

export type InventoryInsert = typeof inventory.$inferInsert;
export type PurchaseOrderInsert = typeof purchaseOrders.$inferInsert;
export type PurchaseOrderLineInsert = typeof purchaseOrderLines.$inferInsert;
export type JobInsert = typeof jobs.$inferInsert;
export type AuditInsert = typeof auditLog.$inferInsert;

/* ============ inventory ============ */

export interface LocationRef {
  id: string;
  type: string;
}

export interface SeedProductRef extends ProductRef {
  category: string;
}

export function buildInventoryRows(
  rng: Rng,
  warehouseId: string,
  products: readonly SeedProductRef[],
  locations: readonly LocationRef[]
): InventoryInsert[] {
  const bins = locations.filter((l) => l.type === "Picking" || l.type === "Reserve");
  const docks = locations.filter((l) => l.type === "Receiving" || l.type === "Returns");
  const rows: InventoryInsert[] = [];
  let seq = 0;

  const push = (productId: string, loc: LocationRef, isCoffee: boolean): void => {
    seq += 1;
    const isReserve = loc.type === "Reserve";
    const onHand = isReserve ? rng.int(40, 240) : rng.int(4, 60);
    rows.push({
      id: `inv-${String(seq).padStart(4, "0")}`,
      warehouseId,
      productId,
      locationId: loc.id,
      lotNumber: isCoffee ? `LOT-26${String(rng.int(1, 10)).padStart(2, "0")}-${rng.digits(3)}` : null,
      onHand,
      allocated: rng.chance(0.3) ? Math.min(onHand, rng.int(1, 8)) : 0,
      damaged: rng.chance(0.05) ? rng.int(1, 3) : 0,
      receivedAt: isoDaysAgo(rng.int(1, 90), rng.int(7, 17), rng.int(0, 59)),
    });
  };

  for (const p of products) {
    const isCoffee = p.category === "Coffee";
    const locCount = rng.int(12, 19);
    const used = new Set<number>();
    while (used.size < locCount) {
      const idx = rng.int(0, bins.length - 1);
      if (used.has(idx)) continue;
      used.add(idx);
      push(p.id, bins[idx], isCoffee);
    }
  }

  // A handful of pallets sitting on receiving/returns docks.
  for (let i = 0; i < 18; i += 1) {
    const p = rng.pick(products);
    push(p.id, rng.pick(docks), p.category === "Coffee");
  }

  return rows;
}

/* ============ purchase orders ============ */

export interface PoClientRef {
  id: string;
  category: "apparel" | "electronics" | "coffee";
}

export interface PoBundle {
  purchaseOrders: PurchaseOrderInsert[];
  lines: PurchaseOrderLineInsert[];
}

type PoStatus = PurchaseOrderInsert["status"];

export function buildPurchaseOrders(
  rng: Rng,
  warehouseId: string,
  clients: readonly PoClientRef[],
  productsByClient: ReadonlyMap<string, readonly SeedProductRef[]>
): PoBundle {
  const pos: PurchaseOrderInsert[] = [];
  const lines: PurchaseOrderLineInsert[] = [];
  const statuses: readonly PoStatus[] = [
    ...Array<PoStatus>(13).fill("Completed"),
    ...Array<PoStatus>(5).fill("Receiving"),
    ...Array<PoStatus>(4).fill("Started"),
    ...Array<PoStatus>(7).fill("Pending"),
    "Cancelled",
  ];

  for (let i = 0; i < statuses.length; i += 1) {
    const status = statuses[i];
    const client = rng.pick(clients);
    const catalog = productsByClient.get(client.id) ?? [];
    if (catalog.length === 0) continue;
    const poId = `po-${String(i + 1).padStart(3, "0")}`;
    const createdDays =
      status === "Completed" ? rng.int(12, 45) : status === "Pending" ? rng.int(0, 6) : rng.int(2, 14);
    const createdAt = isoDaysAgo(createdDays, rng.int(7, 16), rng.int(0, 59));

    const lineCount = rng.int(2, 5);
    const used = new Set<number>();
    let totalQuantity = 0;
    let receivedQuantity = 0;
    let purchasePrice = 0;
    for (let li = 0; li < Math.min(lineCount, catalog.length); li += 1) {
      let idx = rng.int(0, catalog.length - 1);
      while (used.has(idx)) idx = (idx + 1) % catalog.length;
      used.add(idx);
      const p = catalog[idx];
      const ordered = rng.int(40, 400);
      const received =
        status === "Completed"
          ? ordered
          : status === "Receiving"
            ? rng.int(Math.floor(ordered * 0.2), Math.floor(ordered * 0.9))
            : status === "Started"
              ? rng.int(0, Math.floor(ordered * 0.2))
              : 0;
      const unitCost = Math.round(p.price * 0.42 * 100) / 100;
      totalQuantity += ordered;
      receivedQuantity += received;
      purchasePrice += ordered * unitCost;
      lines.push({
        id: `pol-${String(i + 1).padStart(3, "0")}-${li + 1}`,
        purchaseOrderId: poId,
        productId: p.id,
        orderedQuantity: ordered,
        receivedQuantity: received,
        unitCost,
      });
    }

    pos.push({
      id: poId,
      code: `PO-${30200 + i}`,
      warehouseId,
      clientId: client.id,
      vendorName: rng.pick(VENDORS_BY_CATEGORY[client.category]),
      referenceNumber: rng.chance(0.7) ? `REF-${rng.digits(6)}` : null,
      status,
      poType: rng.chance(0.1) ? "Transfer Order" : "Purchase Order",
      totalQuantity,
      receivedQuantity,
      purchasePrice: Math.round(purchasePrice * 100) / 100,
      expectedDate: isoShift(createdAt, rng.int(72, 336)),
      receivedAt: status === "Completed" ? isoShift(createdAt, rng.int(96, 280)) : null,
      createdAt,
    });
  }

  return { purchaseOrders: pos, lines };
}

/* ============ jobs ============ */

type JobType = JobInsert["jobType"];
type JobStatus = JobInsert["status"];

const JOB_PLAN: ReadonlyArray<readonly [JobType, JobStatus]> = [
  ["Single Unit Orders", "Completed"], ["Single Unit Orders", "Completed"],
  ["Single Unit Orders", "Completed"], ["Single Unit Orders", "Completed"],
  ["Single Unit Orders", "In Progress"], ["Single Unit Orders", "In Progress"],
  ["Single Unit Orders", "Pending"], ["Single Unit Orders", "Pending"],
  ["Multi Item Orders", "Completed"], ["Multi Item Orders", "Completed"],
  ["Multi Item Orders", "Completed"], ["Multi Item Orders", "In Progress"],
  ["Multi Item Orders", "In Progress"], ["Multi Item Orders", "Pending"],
  ["Multi Item Orders", "Pending"], ["Multi Item Orders", "Cancelled"],
  ["B2B Order Picking", "Completed"], ["B2B Order Picking", "In Progress"],
  ["B2B Order Picking", "Pending"],
  ["Cycle Count", "Completed"], ["Cycle Count", "Completed"],
  ["Cycle Count", "In Progress"], ["Cycle Count", "Pending"], ["Cycle Count", "Pending"],
  ["Dynamic Replenishment", "Completed"], ["Dynamic Replenishment", "Completed"],
  ["Dynamic Replenishment", "In Progress"], ["Dynamic Replenishment", "Pending"],
];

const RULE_NAMES: Record<string, string> = {
  "Single Unit Orders": "Single Unit Express",
  "Multi Item Orders": "Multi Item Standard",
  "B2B Order Picking": "B2B Pallet Pick",
  "Cycle Count": "Weekly Cycle Count — Zone Rotation",
  "Dynamic Replenishment": "Min/Max Replenishment",
};

export function buildJobs(
  rng: Rng,
  warehouseId: string,
  clientIds: readonly string[],
  operatorIds: readonly string[]
): JobInsert[] {
  return JOB_PLAN.map(([jobType, status], i) => {
    const isPick = jobType !== "Cycle Count" && jobType !== "Dynamic Replenishment";
    const orderCount = isPick ? (jobType === "Single Unit Orders" ? rng.int(12, 48) : rng.int(6, 24)) : 0;
    const unitCount = isPick ? orderCount * rng.int(1, 4) : rng.int(60, 420);
    const completedUnits =
      status === "Completed" ? unitCount : status === "In Progress" ? rng.int(Math.floor(unitCount * 0.25), Math.floor(unitCount * 0.85)) : 0;
    const createdDays = status === "Completed" ? rng.int(0, 10) : rng.int(0, 2);
    const createdAt = isoDaysAgo(createdDays, rng.int(6, 15), rng.int(0, 59));
    const d = new Date(createdAt);
    const wave = `W-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}-${String((i % 6) + 1).padStart(2, "0")}`;
    return {
      id: `job-${String(i + 1).padStart(3, "0")}`,
      code: `JOB-${7001 + i}`,
      warehouseId,
      clientId: isPick && rng.chance(0.65) ? rng.pick(clientIds) : null,
      jobType,
      status,
      priority: rng.weighted([["None", 86], ["High", 10], ["Urgent", 4]]),
      assignedToUserId: status === "Pending" ? null : rng.pick(operatorIds),
      orderCount,
      unitCount,
      completedUnits,
      waveNumber: isPick ? wave : null,
      ruleName: RULE_NAMES[jobType] ?? null,
      createdAt,
      completedAt: status === "Completed" ? isoShift(createdAt, rng.int(2, 9)) : null,
    };
  });
}

/* ============ audit log ============ */

export function buildAuditRows(rng: Rng, userIds: readonly string[]): AuditInsert[] {
  const events: ReadonlyArray<readonly [string, string, string, string]> = [
    ["auth.login", "user", "usr-01", "Signed in from 10.0.4.18"],
    ["order.status_update", "shipment_order", "so-0012", "Open → Ready to Pick"],
    ["order.status_update", "shipment_order", "so-0031", "Picking Started → Ready to Pack"],
    ["inventory.adjustment", "inventory", "inv-0210", "Cycle count variance: -2 units"],
    ["po.receive", "purchase_order", "po-014", "Received 120 units against PO-30213"],
    ["auth.login", "user", "usr-02", "Signed in from 10.0.4.22"],
    ["job.assign", "job", "job-012", "Assigned to Thao Nguyen"],
    ["order.hold", "shipment_order", "so-0288", "Placed on hold: payment verification"],
    ["user.invite", "user", "usr-10", "Viewer invite sent to cs.team@kitstak.io"],
    ["inventory.adjustment", "inventory", "inv-0544", "Damaged write-off: 1 unit"],
    ["order.cancel", "shipment_order", "so-0154", "Cancelled at customer request"],
    ["po.create", "purchase_order", "po-028", "Created PO-30227 (Pending)"],
    ["job.complete", "job", "job-003", "Wave completed — 96/96 units"],
    ["auth.login", "user", "usr-04", "Signed in from 10.0.5.11"],
    ["settings.update", "warehouse", "wh-mlt1", "Default carrier changed to FedEx Ground"],
    ["order.ship", "shipment_order", "so-0301", "Label purchased — USPS Ground Advantage"],
  ];
  return events.map(([action, entity, entityId, detail], i) => ({
    id: `aud-${String(i + 1).padStart(3, "0")}`,
    userId: rng.pick(userIds),
    action,
    entity,
    entityId,
    detail,
    at: isoDaysAgo(rng.int(0, 3), rng.int(6, 19), rng.int(0, 59)),
  }));
}
