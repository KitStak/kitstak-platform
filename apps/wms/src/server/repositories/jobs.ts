/**
 * Job Management repository (M03): grid list (32 columns), detail, and the job-metadata
 * commands (priority, assign, cancel) that wrap `domain/jobs`.
 */
import { aiJobFacts } from './jobs-ai-read';
import { phaseProgress } from './jobs-progress';
import { settleJob } from './jobs-settle';
import { and, count, eq, sql, type SQL } from 'drizzle-orm';
import { JOBS_GRID } from '@/lib/grid-defs/jobs/jobs';
import type { AppDb } from '@/server/api/db';
import { AppError, notFoundError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { assertInScope, scopedWhere } from '@/server/auth/scope';
import * as schema from '@/server/db/schema';
import { jobs as jobsDomain, runBulk } from '@/server/domain';
import type { BulkResult, DomainCtx } from '@/server/domain/types';
import type { GridQuery } from '@/server/query/grid-query';
import { pageOffset } from '@/server/query/paginate';
import { asBool, compileGrid, n0, type FieldSqlMap, qc } from './jobs-grid';
import { dbAll, dbGet, mapSeq, withWriteTx } from '@/server/db/sql';
import { modifiedMessage } from '@/lib/change-log-text';

const j = schema.jobs;

/** AI jobs carry their AI job type in the job-type snapshot; the original type stays on job_type_id. */
const IS_AI = sql`(${qc(j.jobType)} ILIKE 'AI-%')`;
/** Live (Pending / Started) job whose stored planned finish is in the past. */
export const OVERDUE = sql`(${qc(j.status)} IN ('Pending','Started','In Progress') AND ${qc(j.plannedEndAt)} IS NOT NULL AND ${qc(j.plannedEndAt)} < to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`;
const taskCountWhere = (cond: SQL): SQL =>
  sql`(SELECT COUNT(*) FROM tasks t WHERE t.job_id = ${qc(j.id)} AND ${cond})`;

export const JOB_SQL: FieldSqlMap = {
  warehouse: sql`(SELECT w.name FROM warehouses w WHERE w.id = ${qc(j.warehouseId)})`,
  client: sql`COALESCE((SELECT c.name FROM clients c WHERE c.id = ${qc(j.clientId)}), CASE WHEN ${qc(j.orderCount)} > 0 THEN 'Multiple' END)`,
  waveNumber: sql`${qc(j.waveNumber)}`,
  ruleName: sql`${qc(j.ruleName)}`,
  code: sql`${qc(j.code)}`,
  jobType: sql`${qc(j.jobType)}`,
  status: sql`(CASE WHEN ${qc(j.status)} = 'In Progress' THEN 'Started' ELSE ${qc(j.status)} END)`,
  priority: sql`${qc(j.priority)}`,
  operationType: sql`${qc(j.operationType)}`,
  assignee: sql`(SELECT u.name FROM users u WHERE u.id = ${qc(j.assignedToUserId)})`,
  orderCount: sql`${qc(j.orderCount)}`,
  productCount: sql`(SELECT COUNT(DISTINCT t.product_id) FROM tasks t WHERE t.job_id = ${qc(j.id)} AND t.status <> 'Cancelled')`,
  taskCount: sql`${qc(j.taskCount)}`,
  pendingTasks: taskCountWhere(sql`t.status IN ('Pending','Started')`),
  completedTasks: sql`${qc(j.completedTaskCount)}`,
  // Critic R5: a job completed without a stamped start (e.g. instant counts) shows the first task start.
  startedAt: sql`COALESCE(${qc(j.startedAt)}, (SELECT MIN(COALESCE(t.started_at, t.finished_at)) FROM tasks t WHERE t.job_id = ${qc(j.id)}), CASE WHEN ${qc(j.status)} = 'Completed' THEN ${qc(j.completedAt)} END)`,
  completedAt: sql`${qc(j.completedAt)}`,
  createdAt: sql`${qc(j.createdAt)}`,
  createdBy: sql`COALESCE((SELECT u.name FROM users u WHERE u.id = ${qc(j.createdBy)}), 'Integration')`,
  pendingPickingTasks: taskCountWhere(sql`t.task_type = 'Picking' AND t.status IN ('Pending','Started')`),
  pendingPackingTasks: taskCountWhere(sql`t.task_type = 'Packing' AND t.status IN ('Pending','Started')`),
  mobileCart: sql`(SELECT m.code FROM mobile_carts m WHERE m.id = ${qc(j.mobileCartId)})`,
  // Stored zone wins; otherwise the zone(s) of the job's source locations (Logiwa shows the zone list).
  pickingZone: sql`COALESCE(${qc(j.pickingZone)}, (SELECT string_agg((z)::text, ', ') FROM (SELECT DISTINCT COALESCE(lv.name, ll.zone) AS z FROM tasks t JOIN locations ll ON ll.id = t.source_location_id LEFT JOIN lookup_values lv ON lv.id = ll.location_zone_id WHERE t.job_id = ${qc(j.id)} AND t.status <> 'Cancelled' AND COALESCE(lv.name, ll.zone) IS NOT NULL ORDER BY z)))`,
  // Stored SLA window (created + 1h / + 2h), stable across reloads (critic R3).
  plannedStartAt: sql`${qc(j.plannedStartAt)}`,
  plannedEndAt: sql`${qc(j.plannedEndAt)}`,
  locationCount: n0(
    sql`SELECT COUNT(DISTINCT t.source_location_id) FROM tasks t WHERE t.job_id = ${qc(j.id)} AND t.status <> 'Cancelled'`,
  ),
  skuCount: n0(
    sql`SELECT COUNT(DISTINCT t.product_id) FROM tasks t WHERE t.job_id = ${qc(j.id)} AND t.status <> 'Cancelled' AND t.task_type IN ('Count','Replenishment','Picking')`,
  ),
  labelStatus: sql`${qc(j.labelStatus)}`,
  pickListStatus: sql`${qc(j.pickListStatus)}`,
  isResolutionJob: sql`${qc(j.isResolutionJob)}`,
  isPrecartonization: sql`${qc(j.isPrecartonization)}`,
  aiJob: asBool(IS_AI),
  originalJobType: sql`(CASE WHEN ${IS_AI} THEN (SELECT jt.code FROM job_types jt WHERE jt.id = ${qc(j.jobTypeId)}) END)`,
  executedBy: sql`(SELECT string_agg(DISTINCT (u.name)::text, ',') FROM tasks t JOIN users u ON u.id = t.executed_by_user_id WHERE t.job_id = ${qc(j.id)})`,
  pickingAssignment: sql`(CASE WHEN ${qc(j.assignedToUserId)} IS NULL THEN 'Unassigned' ELSE 'Assigned' END)`,
  // Critic R5 (beats Logiwa): a live job whose planned finish has passed is overdue.
  overdue: asBool(OVERDUE),
};

export interface JobListRow {
  readonly id: string;
  readonly warehouseId: string;
  readonly clientId: string | null;
  readonly assignedToUserId: string | null;
  readonly waveId: string | null;
  readonly mobileCartId: string | null;
  readonly hasPickShort: number;
  readonly version: number;
  readonly [key: string]: unknown;
}

const LIST_COLUMNS = Object.keys(JOB_SQL).filter((k) => !['executedBy', 'pickingAssignment'].includes(k));

function selection(): Record<string, SQL> {
  const out: Record<string, SQL> = {
    id: sql`${qc(j.id)}`,
    warehouseId: sql`${qc(j.warehouseId)}`,
    clientId: sql`${qc(j.clientId)}`,
    assignedToUserId: sql`${qc(j.assignedToUserId)}`,
    waveId: sql`${qc(j.waveId)}`,
    mobileCartId: sql`${qc(j.mobileCartId)}`,
    version: sql`${qc(j.version)}`,
    hasPickShort: asBool(
      sql`EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = ${qc(j.id)} AND t.pick_short_status = 'Open')`,
    ),
  };
  for (const key of LIST_COLUMNS) out[key] = JOB_SQL[key] as SQL;
  return out;
}

export async function listJobs(
  db: AppDb,
  auth: AuthContext,
  query: GridQuery,
): Promise<{ rows: JobListRow[]; total: number }> {
  const { where, orderBy } = compileGrid(query, JOBS_GRID, JOB_SQL, {
    defaultSort: [{ field: 'createdAt', dir: 'desc' }],
    tiebreaker: sql`${qc(j.id)}`,
    extra: [scopedWhere(j, auth.viewScope)],
  });
  const rows = (await db
    .select(selection())
    .from(j)
    .where(where)
    .orderBy(...orderBy)
    .limit(query.pageSize)
    .offset(pageOffset(query))) as unknown as JobListRow[];
  const total = (await db.select({ n: count() }).from(j).where(where).limit(1))[0]?.n ?? 0;
  const ai = await aiJobFacts(db, rows as unknown as { id: string; jobType: unknown; orderCount: unknown }[]);
  return {
    rows: rows.map((r) => ({ ...normalizeBools(r), aiJobDescription: ai.get(r.id)?.description ?? null })),
    total,
  };
}

function normalizeBools(row: JobListRow): JobListRow {
  return {
    ...row,
    aiJob: Boolean(row.aiJob),
    isResolutionJob: Boolean(row.isResolutionJob),
    isPrecartonization: Boolean(row.isPrecartonization),
    hasPickShort: Number(row.hasPickShort),
  };
}

/* ------------------------------------------------------------------ detail */

export async function loadJob(
  db: AppDb,
  auth: AuthContext,
  id: string,
): Promise<typeof schema.jobs.$inferSelect> {
  const job = (await db.select().from(j).where(eq(j.id, id)).limit(1))[0];
  if (!job) throw notFoundError('Job');
  assertInScope(auth.scope, job, 'Job');
  return job;
}

export async function getJobDetail(db: AppDb, auth: AuthContext, id: string) {
  const job = await loadJob(db, auth, id);
  const header = (
    await db.select(selection()).from(j).where(eq(j.id, id)).limit(1)
  )[0] as unknown as JobListRow;
  const wave = job.waveId
    ? ((await db.select().from(schema.waves).where(eq(schema.waves.id, job.waveId)).limit(1))[0] ?? null)
    : null;
  const rule =
    (wave?.waveRuleId ?? job.waveRuleId)
      ? ((
          await db
            .select({ id: schema.waveRules.id, name: schema.waveRules.name })
            .from(schema.waveRules)
            .where(eq(schema.waveRules.id, (wave?.waveRuleId ?? job.waveRuleId) as string))
            .limit(1)
        )[0] ?? null)
      : null;
  const orders = await dbAll<{
    id: string;
    code: string;
    status: string;
    customerName: string;
    storeOrderNumber: string | null;
    units: number;
    picked: number;
    packed: number;
    pendingTasks: number;
    startedTasks: number;
    completedTasks: number;
    pickShortStatus: string;
    carrier: string | null;
    hasLabel: number;
    clientName: string;
    released: number;
    cancelledTasks: number;
  }>(
    db,
    sql`SELECT o.id, o.code, o.status, o.customer_name AS "customerName", o.store_order_number AS "storeOrderNumber",
      COALESCE((SELECT SUM(l.quantity - l.cancelled_quantity) FROM order_lines l WHERE l.order_id = o.id), 0) AS units,
      COALESCE((SELECT SUM(l.picked_quantity) FROM order_lines l WHERE l.order_id = o.id), 0) AS picked,
      COALESCE((SELECT SUM(l.packed_quantity) FROM order_lines l WHERE l.order_id = o.id), 0) AS packed,
      (SELECT COUNT(*) FROM tasks t WHERE t.job_id = ${id} AND t.order_id = o.id AND t.status = 'Pending') AS "pendingTasks",
      (SELECT COUNT(*) FROM tasks t WHERE t.job_id = ${id} AND t.order_id = o.id AND t.status = 'Started') AS "startedTasks",
      (SELECT COUNT(*) FROM tasks t WHERE t.job_id = ${id} AND t.order_id = o.id AND t.status = 'Completed') AS "completedTasks",
      o.pick_short_status AS "pickShortStatus", o.carrier,
      (EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.label_type = 'Shipping Label' AND s.label_status = 'Active'))::int AS "hasLabel",
      (SELECT c.name FROM clients c WHERE c.id = o.client_id) AS "clientName",
      (SELECT COUNT(*) FROM tasks t WHERE t.job_id = ${id} AND t.order_id = o.id AND t.status = 'Cancelled') AS "cancelledTasks",
      -- Critic R4: an order whose tasks in this job are all cancelled is no longer in the job.
      ((NOT EXISTS (SELECT 1 FROM job_orders jo WHERE jo.job_id = ${id} AND jo.order_id = o.id)
        OR (EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = ${id} AND t.order_id = o.id)
            AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = ${id} AND t.order_id = o.id AND t.status <> 'Cancelled'))))::int AS released
    FROM shipment_orders o
    WHERE o.id IN (SELECT jo.order_id FROM job_orders jo WHERE jo.job_id = ${id}
                   UNION SELECT t.order_id FROM tasks t WHERE t.job_id = ${id} AND t.order_id IS NOT NULL)
    ORDER BY o.code`,
  );
  const tasks = await dbAll<{
    id: string;
    taskNo: number;
    taskType: string;
    status: string;
    sequence: number;
    orderId: string | null;
    orderCode: string | null;
    sku: string | null;
    productName: string | null;
    plannedQty: number;
    actualQty: number;
    sourceLocation: string | null;
    sourceLpn: string | null;
    targetLocation: string | null;
    targetLpn: string | null;
    walkingPathPriority: number | null;
    aisle: string | null;
    zone: string | null;
    pickShortStatus: string;
    assignee: string | null;
    executedBy: string | null;
    assigneeUserId: string | null;
    finishedAt: string | null;
    lotNumber: string | null;
    version: number;
  }>(
    db,
    sql`SELECT t.id, t.task_no AS "taskNo", t.task_type AS "taskType", t.status, t.sequence, t.order_id AS "orderId",
      (SELECT o.code FROM shipment_orders o WHERE o.id = t.order_id) AS "orderCode",
      p.sku, p.name AS "productName", t.planned_qty AS "plannedQty", t.actual_qty AS "actualQty",
      sl.code AS "sourceLocation", (SELECT lp.number FROM license_plates lp WHERE lp.id = t.source_lp_id) AS "sourceLpn",
      tl.code AS "targetLocation", (SELECT lp.number FROM license_plates lp WHERE lp.id = t.target_lp_id) AS "targetLpn",
      sl.walking_path_priority AS "walkingPathPriority", sl.aisle, sl.zone, t.pick_short_status AS "pickShortStatus",
      COALESCE((SELECT u.name FROM users u WHERE u.id = t.assignee_user_id), (SELECT u.name FROM users u WHERE u.id = t.executed_by_user_id)) AS assignee,
      (SELECT u.name FROM users u WHERE u.id = t.executed_by_user_id) AS "executedBy", t.assignee_user_id AS "assigneeUserId", t.finished_at AS "finishedAt", t.lot_number AS "lotNumber", t.version
    FROM tasks t LEFT JOIN products p ON p.id = t.product_id LEFT JOIN locations sl ON sl.id = t.source_location_id
      LEFT JOIN locations tl ON tl.id = t.target_location_id
    WHERE t.job_id = ${id} ORDER BY t.sequence, t.task_no`,
  );
  const progress = await jobsDomain.getJobProgress(
    db,
    { userId: null, source: 'read', scope: auth.scope },
    id,
  );
  // Critic R5: a cancelled job keeps its history. Orders released by the cancel still list (flagged
  // "released"), and the header counts agree with the tabs instead of the zeroed live counters.
  const cancelledTaskCount = tasks.filter((t) => t.status === 'Cancelled').length;
  const ai =
    (
      await aiJobFacts(db, [
        { id, jobType: job.jobType, orderCount: orders.filter((o) => !o.released).length },
      ])
    ).get(id) ?? null;
  const releasedOrderCount = orders.filter((o) => Boolean(o.released)).length;
  const history = {
    orderCount: orders.length,
    releasedOrderCount,
    taskCount: tasks.length,
    cancelledTaskCount,
    liveTaskCount: tasks.length - cancelledTaskCount,
  };
  // A live job counts only the orders still in it; a cancelled job shows what it held.
  const headerOrderCount = job.status === 'Cancelled' ? orders.length : orders.length - releasedOrderCount;
  return {
    job: {
      ...normalizeBools(header),
      orderCount: headerOrderCount,
      taskCount: tasks.length,
      operationTypeRaw: job.operationType,
      waveRuleId: rule?.id ?? null,
    } as JobListRow & { readonly operationTypeRaw: string; readonly waveRuleId: string | null },
    wave: wave
      ? { id: wave.id, waveNo: wave.waveNo, status: wave.status, runAt: wave.runAt, runBy: wave.runBy }
      : null,
    // REQ-11 (M07): a count job shows its count plan instead of a wave.
    countPlan: job.countPlanId
      ? ((await dbGet<{ id: string; code: string; status: string }>(
          db,
          sql`SELECT id, code, status FROM count_plans WHERE id = ${job.countPlanId}`,
        )) ?? null)
      : null,
    rule,
    ai,
    progress,
    history,
    phases: phaseProgress(tasks),
    orders: orders.map((o) => ({ ...o, hasLabel: Boolean(o.hasLabel), released: Boolean(o.released) })),
    tasks,
  };
}

/* ---------------------------------------------------------------- commands */

export const JOB_PERMISSIONS = {
  priority: 'fulfillment.job_management.update_priority',
  cancel: 'fulfillment.job_management.cancel',
  assign: 'fulfillment.job_management.assign',
  unassign: 'fulfillment.job_management.unassign',
  pickList: 'fulfillment.job_management.print_job_pick_list',
  content: 'fulfillment.job_management.print_job_content',
  packingList: 'fulfillment.job_management.print_packing_list',
  cartLayout: 'fulfillment.job_management.print_mobile_cart_layout',
  pickShort: 'fulfillment.job_management.print_pick_short_consolidation',
  label: 'fulfillment.shipment_orders.create_label',
} as const;

/** Assign / unassign may only touch jobs of one warehouse (Logiwa "Different Warehouses Selected"). */
export async function assertSameWarehouse(db: AppDb, ids: readonly string[]): Promise<void> {
  const rows = await db
    .select({ wh: j.warehouseId })
    .from(j)
    .where(
      sql`${qc(j.id)} IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  if (new Set(rows.map((r) => r.wh)).size > 1) {
    throw new AppError(
      'VALIDATION',
      'Assign and unassign can only be performed for jobs in the same warehouse. Please update your selection and try again.',
    );
  }
}

/** Job cancel with the full task cascade (see `jobs-commands.ts`). */
export { cancelJobs } from './jobs-commands';

/** Removes the order; when it was the job's last order the job closes (settleJob: Cancelled, with a change-log row). */
export async function removeOrder(db: AppDb, ctx: DomainCtx, jobId: string, orderId: string): Promise<void> {
  await withWriteTx(db, async (tx) => {
    await jobsDomain.removeOrderFromJob(tx, ctx, { jobId, orderId });
    await settleJob(tx, ctx, jobId);
  });
}

/** Marks the pick list printed (Pick List Status → Printed) with a change-log row. */
export async function markPickListPrinted(db: AppDb, ctx: DomainCtx, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const job = (await db.select().from(j).where(eq(j.id, id)).limit(1))[0];
    if (!job || job.pickListStatus === 'Printed') continue;
    await db
      .update(j)
      .set({ pickListStatus: 'Printed', updatedBy: ctx.userId, version: sql`${qc(j.version)} + 1` })
      .where(eq(j.id, id));
    await db.insert(schema.changeLog).values({
      entityType: 'job',
      entityId: id,
      entityCode: job.code,
      type: 'Update',
      field: 'pickListStatus',
      fieldLabel: 'Pick List Status',
      fromValue: job.pickListStatus,
      toValue: 'Printed',
      message: modifiedMessage('Pick List Status', 'Not Printed', 'Printed'),
      userId: ctx.userId,
      source: ctx.source,
    });
  }
}

/** Recomputes the job's label status from the active shipping labels of its orders. */
export async function refreshLabelStatus(db: AppDb, jobId: string): Promise<void> {
  const row = await dbGet<{ total: number; labeled: number }>(
    db,
    sql`SELECT COUNT(*) AS total,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = jo.order_id AND s.label_type = 'Shipping Label' AND s.label_status = 'Active') THEN 1 ELSE 0 END) AS labeled
    FROM job_orders jo WHERE jo.job_id = ${jobId}`,
  );
  const total = Number(row?.total ?? 0);
  const labeled = Number(row?.labeled ?? 0);
  const status = labeled === 0 ? 'No Label' : labeled >= total ? 'Labeled' : 'Partially Labeled';
  await db.update(j).set({ labelStatus: status }).where(eq(j.id, jobId));
}

export async function jobOrderIds(db: AppDb, jobId: string): Promise<string[]> {
  return (
    await db
      .select({ id: schema.jobOrders.orderId })
      .from(schema.jobOrders)
      .where(eq(schema.jobOrders.jobId, jobId))
  ).map((r) => r.id);
}

export async function jobsByIds(db: AppDb, auth: AuthContext, ids: readonly string[]) {
  return await mapSeq(ids, async (id) => await loadJob(db, auth, id));
}

export async function jobWarehouseIds(db: AppDb, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  return [
    ...new Set(
      (
        await db
          .select({ wh: j.warehouseId })
          .from(j)
          .where(
            and(
              sql`${qc(j.id)} IN (${sql.join(
                ids.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            ),
          )
      ).map((r) => r.wh),
    ),
  ];
}
