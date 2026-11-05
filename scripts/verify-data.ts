/** Temporary verification script — counts rows per table and smoke-tests repositories. */
import { count } from "drizzle-orm";
import { db, schema } from "../src/server/db";
import { getDashboardData } from "../src/server/repositories/dashboard";
import { listAtp, listInventoryByLocation, listTotalInventory } from "../src/server/repositories/inventory";
import { getOrderDetail, listOrders } from "../src/server/repositories/orders";
import { getPurchaseOrderDetail, listPurchaseOrders } from "../src/server/repositories/purchase-orders";
import { getTransactionHistory } from "../src/server/repositories/reports";
import { listClients } from "../src/server/repositories/clients";
import { getZoneSummary, listLocations } from "../src/server/repositories/locations";
import { listJobs } from "../src/server/repositories/jobs";
import { listUsers } from "../src/server/repositories/users";
import { listAuditLog } from "../src/server/repositories/audit";
import { listProducts } from "../src/server/repositories/products";

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

const tables = [
  ["users", schema.users],
  ["warehouses", schema.warehouses],
  ["clients", schema.clients],
  ["products", schema.products],
  ["locations", schema.locations],
  ["inventory", schema.inventory],
  ["shipment_orders", schema.shipmentOrders],
  ["order_lines", schema.orderLines],
  ["purchase_orders", schema.purchaseOrders],
  ["purchase_order_lines", schema.purchaseOrderLines],
  ["jobs", schema.jobs],
  ["audit_log", schema.auditLog],
] as const;

out("Row counts:");
for (const [name, table] of tables) {
  const n = db.select({ n: count() }).from(table).get()?.n ?? 0;
  out(`  ${name.padEnd(22)} ${n}`);
}

const base = { page: 1, pageSize: 5 };
const backlog = listOrders({ ...base, tab: "backlog" });
const shipped = listOrders({ ...base, tab: "shipped" });
const returns = listOrders({ ...base, tab: "returns" });
out(`orders: backlog=${backlog.total} shipped=${shipped.total} returns=${returns.total}`);
const detail = getOrderDetail(backlog.rows[0]?.id ?? "so-0001");
out(`order detail: ${detail?.order.code} lines=${detail?.lines.length} timeline=${detail?.timeline.length} client=${detail?.order.clientName}`);
out(`products: total=${listProducts(base).total} search(TEE)=${listProducts({ ...base, search: "TEE" }).total}`);
out(`inventory: total=${listTotalInventory(base).total} byLoc=${listInventoryByLocation(base).total} atp=${listAtp(base).total}`);
const po = listPurchaseOrders(base);
out(`POs: total=${po.total} detail(${po.rows[0]?.code})=${getPurchaseOrderDetail(po.rows[0]?.id ?? "")?.lines.length} lines`);
out(`jobs: total=${listJobs(base).total} inProgress=${listJobs({ ...base, status: "In Progress" }).total}`);
out(`clients: total=${listClients(base).total} first=${listClients(base).rows[0]?.name} openOrders=${listClients(base).rows[0]?.openOrders}`);
out(`locations: total=${listLocations(base).total} zones=${getZoneSummary().map((z) => `${z.zone}:${z.binCount}`).join(" ")}`);
out(`users: total=${listUsers(base).total}; audit: total=${listAuditLog(base).total}`);
const dash = getDashboardData();
out(`dashboard: asOf=${dash.asOf} created=${dash.progressToday.ordersCreated} shipped=${dash.progressToday.ordersShipped} open=${dash.progressToday.openOrders}`);
out(`  unfulfilled=${JSON.stringify(dash.unfulfilled)}`);
out(`  channels=${dash.channelRank.map((c) => `${c.name}:${c.count}(${c.pct}%)`).join(" ")}`);
out(`  carriers=${dash.carrierRank.map((c) => `${c.name}:${c.count}`).join(" ")} countries=${dash.countryRank.map((c) => `${c.name}:${c.count}`).join(" ")}`);
out(`  statusBreakdown=${dash.statusBreakdown.map((s) => `${s.status}:${s.count}`).join(" ")}`);
out(`  jobs=${JSON.stringify({ ...dash.jobsSummary, active: dash.jobsSummary.active.length })}`);
const txn = getTransactionHistory({ page: 1, pageSize: 5 });
out(`transactions: total=${txn.total} first=${txn.rows[0]?.type} ${txn.rows[0]?.reference} ${txn.rows[0]?.date}`);
