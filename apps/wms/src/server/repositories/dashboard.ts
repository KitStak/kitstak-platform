import { and, count, eq, inArray, isNotNull, like, sql } from 'drizzle-orm';
import { desc } from '@/server/db/order';
import { schema } from '@/server/db';
import { getAppDb, type AppDb } from '@/server/api/db';
import { BACKLOG_STATUSES } from './orders';

const { shipmentOrders, orderLines, clients, jobs, users } = schema;

/** Statuses that mean an order has left the building (carrier ranking scope). */
const SHIPPED_OUT_STATUSES = ['Shipped', 'Delivered'] as const;

/** Job statuses shown in the dashboard's active jobs table. */
const ACTIVE_JOB_STATUSES = ['In Progress', 'Pending'] as const;

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
  /** "In Progress" | "Pending" — both count as active floor work. */
  status: string;
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
async function deriveToday(db: AppDb): Promise<string> {
  const row = (
    await db
      .select({ d: sql<string | null>`max(${shipmentOrders.orderDate})` })
      .from(shipmentOrders)
      .limit(1)
  )[0];
  const iso = row?.d ?? new Date().toISOString();
  return iso.slice(0, 10);
}

export async function getDashboardData(): Promise<DashboardData> {
  const db = await getAppDb();
  const today = await deriveToday(db);
  const todayPrefix = `${today}%`;

  const ordersCreated =
    (
      await db
        .select({ n: count() })
        .from(shipmentOrders)
        .where(like(shipmentOrders.orderDate, todayPrefix))
        .limit(1)
    )[0]?.n ?? 0;
  const shippedToday = (
    await db
      .select({
        n: count(),
        units: sql<number>`coalesce(sum(${shipmentOrders.totalQuantity}), 0)`,
      })
      .from(shipmentOrders)
      .where(like(shipmentOrders.shippedAt, todayPrefix))
      .limit(1)
  )[0];
  const ordersDelivered =
    (
      await db
        .select({ n: count() })
        .from(shipmentOrders)
        .where(like(shipmentOrders.deliveredAt, todayPrefix))
        .limit(1)
    )[0]?.n ?? 0;
  const openOrders =
    (
      await db
        .select({ n: count() })
        .from(shipmentOrders)
        .where(inArray(shipmentOrders.status, [...BACKLOG_STATUSES]))
        .limit(1)
    )[0]?.n ?? 0;

  const statusBreakdown = await db
    .select({ status: shipmentOrders.status, count: count() })
    .from(shipmentOrders)
    .groupBy(shipmentOrders.status)
    .orderBy(desc(count()));

  const unfulfilledAgg = (
    await db
      .select({
        orders: sql<number>`count(distinct ${shipmentOrders.id})`,
        units: sql<number>`coalesce(sum(${orderLines.quantity}), 0)`,
        pickedUnits: sql<number>`coalesce(sum(${orderLines.pickedQuantity}), 0)`,
        packedUnits: sql<number>`coalesce(sum(${orderLines.packedQuantity}), 0)`,
      })
      .from(shipmentOrders)
      .innerJoin(orderLines, eq(orderLines.orderId, shipmentOrders.id))
      .where(inArray(shipmentOrders.status, [...BACKLOG_STATUSES]))
      .limit(1)
  )[0];

  const channelRank = toRank(
    await db
      .select({ name: shipmentOrders.channel, count: count() })
      .from(shipmentOrders)
      .groupBy(shipmentOrders.channel)
      .orderBy(desc(count())),
  );
  const clientRank = toRank(
    await db
      .select({ name: clients.name, count: count() })
      .from(shipmentOrders)
      .innerJoin(clients, eq(shipmentOrders.clientId, clients.id))
      .groupBy(clients.name)
      .orderBy(desc(count())),
  );
  // Carriers rank only orders that actually went out the door (Shipped +
  // Delivered) so the card's total reconciles with Order Breakdown's
  // Shipped + Delivered counts. Orders with a carrier pre-assigned but not
  // yet shipped are deliberately excluded.
  const carrierRank = toRank(
    await db
      .select({ name: shipmentOrders.carrier, count: count() })
      .from(shipmentOrders)
      .where(
        and(isNotNull(shipmentOrders.carrier), inArray(shipmentOrders.status, [...SHIPPED_OUT_STATUSES])),
      )
      .groupBy(shipmentOrders.carrier)
      .orderBy(desc(count())),
  );
  const countryRank = toRank(
    await db
      .select({ name: shipmentOrders.shipCountry, count: count() })
      .from(shipmentOrders)
      .groupBy(shipmentOrders.shipCountry)
      .orderBy(desc(count())),
  );

  const jobTotals = (
    await db
      .select({
        total: count(),
        pending: sql<number>`sum(case when ${jobs.status} = 'Pending' then 1 else 0 end)`,
        inProgress: sql<number>`sum(case when ${jobs.status} = 'In Progress' then 1 else 0 end)`,
      })
      .from(jobs)
      .limit(1)
  )[0];
  const completedToday =
    (await db.select({ n: count() }).from(jobs).where(like(jobs.completedAt, todayPrefix)).limit(1))[0]?.n ??
    0;
  // Pending jobs are "active pick/count work across the floor" per the card's
  // subtitle, so they belong in the table alongside In Progress jobs. In
  // Progress rows sort first so live work stays at the top.
  const activeJobs = (
    await db
      .select({
        id: jobs.id,
        code: jobs.code,
        jobType: jobs.jobType,
        status: jobs.status,
        assigneeName: users.name,
        waveNumber: jobs.waveNumber,
        unitCount: jobs.unitCount,
        completedUnits: jobs.completedUnits,
      })
      .from(jobs)
      .leftJoin(users, eq(jobs.assignedToUserId, users.id))
      .where(inArray(jobs.status, [...ACTIVE_JOB_STATUSES]))
      .orderBy(sql`case when ${jobs.status} = 'In Progress' then 0 else 1 end`, desc(jobs.createdAt))
  ).map((j) => ({
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
