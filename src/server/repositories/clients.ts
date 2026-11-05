import { and, asc, count, eq, like, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { BACKLOG_STATUSES } from "./orders";
import { likePattern, offsetOf, type ListResult } from "./shared";

const { clients, products, shipmentOrders } = schema;

export type ClientStatus = (typeof clients.$inferSelect)["status"];

export interface ClientListParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: ClientStatus;
}

export interface ClientListRow {
  id: string;
  code: string;
  name: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  billingPlan: string;
  status: ClientStatus;
  createdAt: string;
  productCount: number;
  totalOrders: number;
  openOrders: number;
}

export function listClients(params: ClientListParams): ListResult<ClientListRow> {
  const conds: Array<SQL | undefined> = [];
  if (params.status) conds.push(eq(clients.status, params.status));
  if (params.search) {
    const p = likePattern(params.search);
    conds.push(or(like(clients.name, p), like(clients.code, p), like(clients.contactName, p)));
  }
  const where = and(...conds);
  const backlogList = sql.join(
    BACKLOG_STATUSES.map((s) => sql`${s}`),
    sql`, `
  );

  const productAgg = db
    .select({
      clientId: products.clientId,
      productCount: count().as("product_count"),
    })
    .from(products)
    .groupBy(products.clientId)
    .as("product_agg");

  const orderAgg = db
    .select({
      clientId: shipmentOrders.clientId,
      totalOrders: count().as("total_orders"),
      openOrders:
        sql<number>`sum(case when ${shipmentOrders.status} in (${backlogList}) then 1 else 0 end)`.as(
          "open_orders"
        ),
    })
    .from(shipmentOrders)
    .groupBy(shipmentOrders.clientId)
    .as("order_agg");

  const rows = db
    .select({
      id: clients.id,
      code: clients.code,
      name: clients.name,
      contactName: clients.contactName,
      contactEmail: clients.contactEmail,
      phone: clients.phone,
      billingPlan: clients.billingPlan,
      status: clients.status,
      createdAt: clients.createdAt,
      productCount: sql<number>`coalesce(${productAgg.productCount}, 0)`,
      totalOrders: sql<number>`coalesce(${orderAgg.totalOrders}, 0)`,
      openOrders: sql<number>`coalesce(${orderAgg.openOrders}, 0)`,
    })
    .from(clients)
    .leftJoin(productAgg, eq(productAgg.clientId, clients.id))
    .leftJoin(orderAgg, eq(orderAgg.clientId, clients.id))
    .where(where)
    .orderBy(asc(clients.name))
    .limit(params.pageSize)
    .offset(offsetOf(params.page, params.pageSize))
    .all();
  const total = db.select({ n: count() }).from(clients).where(where).get()?.n ?? 0;
  return { rows, total };
}
