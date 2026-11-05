import { count, desc, eq, inArray, isNotNull, like, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { BACKLOG_STATUSES } from "./orders";

const { shipmentOrders, orderLines, clients, jobs, users } = schema;

export interface RankEntry {
  name: string;
  count: number;
  pct: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface ActiveJobRow {
  id: string;
  code: string;
  jobType: string;
  assigneeName: string | null;
  waveNumber: string | null;
  unitCount: number;
  completedUnits: number;
  pctComplete: number;
}

export interface DashboardData {
  asOf: string;
  progressToday: {
    ordersCreated: number;
    ordersShipped: number;
    unitsShipped: number;
    ordersDelivered: number;
    openOrders: number;
  };
  statusBreakdown: StatusCount[];
  unfulfilled: {
    orders: number;
    units: number;
    pickedUnits: number;
    packedUnits: number;
  };
  channelRank: RankEntry[];
  clientRank: RankEntry[];
  carrierRank: RankEntry[];
  countryRank: RankEntry[];
  jobsSummary: {
    total: number;
    pending: number;
    inProgress: number;
    completedToday: number;
    active: ActiveJobRow[];
  };
}

function toRank(rows: ReadonlyArray<{ name: string | null; count: number }>): RankEntry[] {
  const totalCount = rows.reduce((acc, r) => acc + r.count, 0);
  return rows
    .filter((r): r is { name: string; count: number } => r.name !== null)
    .map((r) => ({
      name: r.name,
      count: r.count,
      pct: totalCount > 0 ? Math.round((r.count / totalCount) * 1000) / 10 : 0,
    }));
}

/** "Today" is derived from the newest order so the seeded demo stays stable. */
function deriveToday(): string {
  const row = db
    .select({ d: sql<string | null>`max(${shipmentOrders.orderDate})` })
    .from(shipmentOrders)
    .get();
  const iso = row?.d ?? new Date().toISOString();
  return iso.slice(0, 10);
}

export function getDashboardData(): DashboardData {
  const today = deriveToday();
  const todayPrefix = `${today}%`;

  const ordersCreated =
    db.select({ n: count() }).from(shipmentOrders).where(like(shipmentOrders.orderDate, todayPrefix)).get()?.n ?? 0;
  const shippedToday = db
    .select({
      n: count(),
      units: sql<number>`coalesce(sum(${shipmentOrders.totalQuantity}), 0)`,
    })
    .from(shipmentOrders)
    .where(like(shipmentOrders.shippedAt, todayPrefix))
    .get();
  const ordersDelivered =
    db.select({ n: count() }).from(shipmentOrders).where(like(shipmentOrders.deliveredAt, todayPrefix)).get()?.n ?? 0;
  const openOrders =
    db
      .select({ n: count() })
      .from(shipmentOrders)
      .where(inArray(shipmentOrders.status, [...BACKLOG_STATUSES]))
      .get()?.n ?? 0;

  const statusBreakdown = db
    .select({ status: shipmentOrders.status, count: count() })
    .from(shipmentOrders)
    .groupBy(shipmentOrders.status)
    .orderBy(desc(count()))
    .all();

  const unfulfilledAgg = db
    .select({
      orders: sql<number>`count(distinct ${shipmentOrders.id})`,
      units: sql<number>`coalesce(sum(${orderLines.quantity}), 0)`,
      pickedUnits: sql<number>`coalesce(sum(${orderLines.pickedQuantity}), 0)`,
      packedUnits: sql<number>`coalesce(sum(${orderLines.packedQuantity}), 0)`,
    })
    .from(shipmentOrders)
    .innerJoin(orderLines, eq(orderLines.orderId, shipmentOrders.id))
    .where(inArray(shipmentOrders.status, [...BACKLOG_STATUSES]))
    .get();

  const channelRank = toRank(
    db
      .select({ name: shipmentOrders.channel, count: count() })
      .from(shipmentOrders)
      .groupBy(shipmentOrders.channel)
      .orderBy(desc(count()))
      .all()
  );
  const clientRank = toRank(
    db
      .select({ name: clients.name, count: count() })
      .from(shipmentOrders)
      .innerJoin(clients, eq(shipmentOrders.clientId, clients.id))
      .groupBy(clients.name)
      .orderBy(desc(count()))
      .all()
  );
  const carrierRank = toRank(
    db
      .select({ name: shipmentOrders.carrier, count: count() })
      .from(shipmentOrders)
      .where(isNotNull(shipmentOrders.carrier))
      .groupBy(shipmentOrders.carrier)
      .orderBy(desc(count()))
      .all()
  );
  const countryRank = toRank(
    db
      .select({ name: shipmentOrders.shipCountry, count: count() })
      .from(shipmentOrders)
      .groupBy(shipmentOrders.shipCountry)
      .orderBy(desc(count()))
      .all()
  );

  const jobTotals = db
    .select({
      total: count(),
      pending: sql<number>`sum(case when ${jobs.status} = 'Pending' then 1 else 0 end)`,
      inProgress: sql<number>`sum(case when ${jobs.status} = 'In Progress' then 1 else 0 end)`,
    })
    .from(jobs)
    .get();
  const completedToday =
    db.select({ n: count() }).from(jobs).where(like(jobs.completedAt, todayPrefix)).get()?.n ?? 0;
  const activeJobs = db
    .select({
      id: jobs.id,
      code: jobs.code,
      jobType: jobs.jobType,
      assigneeName: users.name,
      waveNumber: jobs.waveNumber,
      unitCount: jobs.unitCount,
      completedUnits: jobs.completedUnits,
    })
    .from(jobs)
    .leftJoin(users, eq(jobs.assignedToUserId, users.id))
    .where(eq(jobs.status, "In Progress"))
    .orderBy(desc(jobs.createdAt))
    .all()
    .map((j) => ({
      ...j,
      pctComplete: j.unitCount > 0 ? Math.round((j.completedUnits / j.unitCount) * 100) : 0,
    }));

  return {
    asOf: today,
    progressToday: {
      ordersCreated,
      ordersShipped: shippedToday?.n ?? 0,
      unitsShipped: shippedToday?.units ?? 0,
      ordersDelivered,
      openOrders,
    },
    statusBreakdown,
    unfulfilled: {
      orders: unfulfilledAgg?.orders ?? 0,
      units: unfulfilledAgg?.units ?? 0,
      pickedUnits: unfulfilledAgg?.pickedUnits ?? 0,
      packedUnits: unfulfilledAgg?.packedUnits ?? 0,
    },
    channelRank,
    clientRank,
    carrierRank,
    countryRank,
    jobsSummary: {
      total: jobTotals?.total ?? 0,
      pending: jobTotals?.pending ?? 0,
      inProgress: jobTotals?.inProgress ?? 0,
      completedToday,
      active: activeJobs,
    },
  };
}
