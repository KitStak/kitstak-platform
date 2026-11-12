/**
 * Count plan integrity (M07). A plan may read "Inventory Updated" only when at least one of its
 * lines reached Inventory Updated. Plans that drifted there under the pre-round-3 implied-status
 * rule (only Recount Created / Cancelled lines left, nothing posted) are listed and repaired here:
 * the status is re-derived from the lines (Cancelled when nothing was posted) and the change is
 * written to the change log, so the plan grid never claims a post that did not happen.
 *
 * Run once against the dev DB with `npx tsx scripts/...` style wrappers, or call from tests.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { CountPlanStatus } from '@/lib/enums';
import { impliedPlanStatus } from '@/lib/grid-defs/counts/count-math';
import * as schema from '@/server/db/schema';
import { recordUpdate } from '@/server/domain/change-log';
import type { AppDb } from '@/server/api/db';
import type { DomainCtx, Tx } from '@/server/domain/types';
import { dbAll, dbRun, mapSeq } from '@/server/db/sql';
const raw = (s: string): SQL => sql.raw(s);

export interface CountPlanDrift {
  readonly id: string;
  readonly code: string;
  readonly status: CountPlanStatus;
  readonly expected: CountPlanStatus;
  readonly countTransactions: number;
}

/** Plans whose status says "Inventory Updated" although none of their lines was posted. */
export async function findCountPlanStatusDrift(tx: Tx): Promise<CountPlanDrift[]> {
  const rows = await tx
    .select({ id: schema.countPlans.id, code: schema.countPlans.code, status: schema.countPlans.status })
    .from(schema.countPlans)
    .where(
      and(
        eq(schema.countPlans.status, 'Inventory Updated'),
        sql`NOT EXISTS (SELECT 1 FROM count_plan_lines l WHERE l.plan_id = ${schema.countPlans.id} AND l.status = 'Inventory Updated')`,
      ),
    );
  return (
    await mapSeq(rows, async (r) => {
      const lines = await tx
        .select({ status: schema.countPlanLines.status })
        .from(schema.countPlanLines)
        .where(eq(schema.countPlanLines.planId, r.id));
      // Re-derive as if the plan were still open, so the open-plan rule decides the honest status.
      const expected =
        impliedPlanStatus(
          'Count Completed',
          lines.map((l) => l.status),
        ) ?? 'Cancelled';
      const txns =
        (
          await tx
            .select({ n: sql<number>`count(*)` })
            .from(schema.inventoryTransactions)
            .where(eq(schema.inventoryTransactions.countPlanId, r.id))
            .limit(1)
        )[0]?.n ?? 0;
      return {
        id: r.id,
        code: r.code,
        status: r.status as CountPlanStatus,
        expected: expected as CountPlanStatus,
        countTransactions: Number(txns),
      };
    })
  ).filter((d) => d.expected !== d.status && d.countTransactions === 0);
}

/** Repairs every drifted plan (status + change-log row). Returns the plans it changed. */
export async function repairCountPlanStatusDrift(tx: Tx, ctx: DomainCtx): Promise<CountPlanDrift[]> {
  const drift = await findCountPlanStatusDrift(tx);
  for (const d of drift) {
    await tx
      .update(schema.countPlans)
      .set({
        status: d.expected,
        inventoryUpdatedAt: null,
        inventoryUpdatedBy: null,
        updatedBy: ctx.userId,
        version: sql`${schema.countPlans.version} + 1`,
      })
      .where(eq(schema.countPlans.id, d.id));
    await recordUpdate(tx, ctx, {
      entityType: 'count_plan',
      entityId: d.id,
      entityCode: d.code,
      before: { status: d.status },
      after: { status: d.expected },
    });
  }
  return drift;
}

/* ------------------------------------------------------------ job counters */
export interface CountJobCounterDrift {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly taskCount: number;
  readonly expectedTaskCount: number;
  readonly completedTaskCount: number;
  readonly expectedCompletedTaskCount: number;
}

/**
 * Count jobs whose stored counters disagree with their task rows. The rule is `rollupJob`'s:
 * task_count = tasks that are not Cancelled, completed_task_count = Completed tasks.
 */
export async function findCountJobCounterDrift(tx: Tx | AppDb): Promise<CountJobCounterDrift[]> {
  return await dbAll<CountJobCounterDrift>(
    tx,
    sql`
    SELECT j.id, j.code, j.status, j.task_count AS "taskCount", j.completed_task_count AS "completedTaskCount",
      (SELECT COUNT(*) FROM tasks t WHERE t.job_id = j.id AND t.status <> 'Cancelled') AS "expectedTaskCount",
      (SELECT COUNT(*) FROM tasks t WHERE t.job_id = j.id AND t.status = 'Completed') AS "expectedCompletedTaskCount"
    FROM jobs j
    WHERE j.operation_type = 'Count'
      AND (j.task_count <> (SELECT COUNT(*) FROM tasks t WHERE t.job_id = j.id AND t.status <> 'Cancelled')
        OR j.completed_task_count <> (SELECT COUNT(*) FROM tasks t WHERE t.job_id = j.id AND t.status = 'Completed'))
    ORDER BY j.code`,
  );
}

/**
 * Re-derives the counters of every drifted count job from its tasks. Only the counters change
 * (no status move, so no lifecycle side effects); each fix writes a change-log row on the job.
 */
export async function repairCountJobCounterDrift(tx: Tx, ctx: DomainCtx): Promise<CountJobCounterDrift[]> {
  const drift = await findCountJobCounterDrift(tx);
  for (const d of drift) {
    await tx
      .update(schema.jobs)
      .set({
        taskCount: d.expectedTaskCount,
        completedTaskCount: d.expectedCompletedTaskCount,
        updatedBy: ctx.userId,
      })
      .where(eq(schema.jobs.id, d.id));
    await recordUpdate(tx, ctx, {
      entityType: 'job',
      entityId: d.id,
      entityCode: d.code,
      before: { taskCount: d.taskCount, completedTaskCount: d.completedTaskCount },
      after: { taskCount: d.expectedTaskCount, completedTaskCount: d.expectedCompletedTaskCount },
    });
  }
  return drift;
}

/* ------------------------------------------------- one open count per location */
export interface CountLocationOverlap {
  readonly locationId: string;
  readonly locationCode: string;
  /** Open plans (oldest first) with an open line on this location. */
  readonly plans: readonly {
    readonly id: string;
    readonly code: string;
    readonly status: string;
    readonly lineIds: readonly string[];
  }[];
}

const OPEN_PLAN_STATUSES = ['Pending', 'Ready To Count', 'Count Started', 'Count Completed'] as const;
const OPEN_LINE_STATUSES = ['Pending', 'Ready To Count', 'Count Started', 'Count Completed'] as const;

/**
 * Locations held by an open line of more than one open plan: the "one open count per location"
 * invariant enforced at create / edit time (counts-conflicts) since round 3. Rows created before
 * that rule are reported here so the invariant can be proven (and repaired) on any database.
 */
export async function findOpenCountOverlaps(tx: Tx | AppDb): Promise<CountLocationOverlap[]> {
  const rows = await dbAll<{
    locationId: string;
    locationCode: string;
    planId: string;
    planCode: string;
    planStatus: string;
    lineId: string;
    createdAt: string;
  }>(
    tx,
    sql`
    SELECT l.location_id AS "locationId", lo.code AS "locationCode", p.id AS "planId", p.code AS "planCode", p.status AS "planStatus", l.id AS "lineId", p.created_at AS "createdAt"
    FROM count_plan_lines l
    JOIN count_plans p ON p.id = l.plan_id
    JOIN locations lo ON lo.id = l.location_id
    WHERE l.location_id IS NOT NULL
      AND p.status IN (${sql.join(
        OPEN_PLAN_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      )})
      AND l.status IN (${sql.join(
        OPEN_LINE_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      )})
      AND l.location_id IN (
        SELECT l2.location_id FROM count_plan_lines l2 JOIN count_plans p2 ON p2.id = l2.plan_id
        WHERE l2.location_id IS NOT NULL
          AND p2.status IN (${sql.join(
            OPEN_PLAN_STATUSES.map((s) => sql`${s}`),
            sql`, `,
          )})
          AND l2.status IN (${sql.join(
            OPEN_LINE_STATUSES.map((s) => sql`${s}`),
            sql`, `,
          )})
        GROUP BY l2.location_id HAVING COUNT(DISTINCT l2.plan_id) > 1)
    ORDER BY lo.code, p.created_at, p.code`,
  );
  const byLoc = new Map<
    string,
    {
      locationCode: string;
      plans: Map<string, { id: string; code: string; status: string; lineIds: string[] }>;
    }
  >();
  for (const r of rows) {
    const loc = byLoc.get(r.locationId) ?? { locationCode: r.locationCode, plans: new Map() };
    const plan = loc.plans.get(r.planId) ?? {
      id: r.planId,
      code: r.planCode,
      status: r.planStatus,
      lineIds: [],
    };
    plan.lineIds.push(r.lineId);
    loc.plans.set(r.planId, plan);
    byLoc.set(r.locationId, loc);
  }
  return [...byLoc.entries()].map(([locationId, v]) => ({
    locationId,
    locationCode: v.locationCode,
    plans: [...v.plans.values()],
  }));
}

/**
 * Repair: the oldest open plan keeps each overlapping location; the newer plans' open lines on it
 * that were never counted (Pending / Ready To Count) are cancelled through the normal line cancel,
 * so their tasks, jobs and plan statuses roll up. Counted lines are never discarded: an overlap
 * where the newer line is already counted is returned in `kept` for a supervisor to resolve.
 */
export async function repairOpenCountOverlaps(
  tx: Tx,
  ctx: DomainCtx,
  cancelLines: (lineIds: readonly string[]) => void | Promise<void>,
): Promise<{ cancelledLineIds: string[]; kept: CountLocationOverlap[] }> {
  const cancelledLineIds: string[] = [];
  const kept: CountLocationOverlap[] = [];
  for (const o of await findOpenCountOverlaps(tx)) {
    const [, ...newer] = o.plans;
    const ids: string[] = [];
    let blocked = false;
    for (const p of newer) {
      for (const lineId of p.lineIds) {
        const line = (
          await tx
            .select({ status: schema.countPlanLines.status })
            .from(schema.countPlanLines)
            .where(eq(schema.countPlanLines.id, lineId))
            .limit(1)
        )[0];
        if (line && (line.status === 'Pending' || line.status === 'Ready To Count')) ids.push(lineId);
        else blocked = true;
      }
    }
    if (ids.length) {
      await cancelLines(ids);
      cancelledLineIds.push(...ids);
    }
    if (blocked) kept.push(o);
  }
  void ctx;
  return { cancelledLineIds, kept };
}

/**
 * Every count invariant as `db:verify` issues (`{ check, id, message }`, the VerifyIssue shape), so
 * `scripts/verify-ledger.ts` wires all three checks with one call (docs/requests/counts.md REQ-21 / REQ-26).
 */
export async function countIntegrityIssues(
  tx: Tx | AppDb,
): Promise<{ readonly check: string; readonly id: string; readonly message: string }[]> {
  const plans = (await findCountPlanStatusDrift(tx as Tx)).map((d) => ({
    check: 'count_plan_status_drift',
    id: d.code,
    message: `Plan is ${d.status} but should be ${d.expected} (${d.countTransactions} Count transactions)`,
  }));
  const jobs = (await findCountJobCounterDrift(tx)).map((d) => ({
    check: 'count_job_counter_drift',
    id: d.code,
    message: `Tasks ${d.completedTaskCount}/${d.taskCount} stored, ${d.expectedCompletedTaskCount}/${d.expectedTaskCount} from task rows`,
  }));
  const overlaps = (await findOpenCountOverlaps(tx)).map((o) => ({
    check: 'open_count_overlap',
    id: o.locationCode,
    message: `Held by ${o.plans.length} open count plans: ${o.plans.map((p) => `${p.code} (${p.status})`).join(', ')}`,
  }));
  const users = (await findInventoryUpdateUserGaps(tx)).map((g) => ({
    check: 'count_inventory_update_user',
    id: g.code,
    message: g.storedValue
      ? `Inventory Update User stored as "${g.storedValue}" (not a user id)`
      : 'Inventory Updated with no Inventory Update User',
  }));
  return [...plans, ...jobs, ...overlaps, ...users];
}

/* ------------------------------------------------- inventory update user */
export interface InventoryUpdateUserGap {
  readonly table: 'count_plans' | 'count_plan_lines';
  readonly id: string;
  readonly code: string;
  readonly storedValue: string | null;
}

/**
 * Inventory Updated plans / lines whose `inventory_updated_by` is empty or is not a user id
 * (the pre-fix seed stored the actor email). Every live update path writes `ctx.userId`.
 */
export async function findInventoryUpdateUserGaps(tx: Tx | AppDb): Promise<InventoryUpdateUserGap[]> {
  return await dbAll<InventoryUpdateUserGap>(
    tx,
    sql`
    SELECT 'count_plans' AS "table", p.id, p.code, p.inventory_updated_by AS "storedValue" FROM count_plans p
    WHERE p.status = 'Inventory Updated' AND (p.inventory_updated_by IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.inventory_updated_by))
    UNION ALL
    SELECT 'count_plan_lines', l.id, p.code, l.inventory_updated_by FROM count_plan_lines l JOIN count_plans p ON p.id = l.plan_id
    WHERE l.status = 'Inventory Updated' AND (l.inventory_updated_by IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = l.inventory_updated_by))`,
  );
}

/**
 * Backfills `inventory_updated_by` with a user id: an email is mapped to its user; an empty
 * value takes the actor of the plan's last Count ledger posting, else the plan's last updater.
 * Returns how many plan and line rows it changed.
 */
export async function repairInventoryUpdateUser(tx: Tx): Promise<{ plans: number; lines: number }> {
  const resolved = (col: string, planCol: string): SQL =>
    raw(`COALESCE(
      (SELECT u.id FROM users u WHERE u.email = ${col}),
      (SELECT t.user_id FROM inventory_transactions t WHERE t.count_plan_id = ${planCol} AND EXISTS (SELECT 1 FROM users u2 WHERE u2.id = t.user_id) ORDER BY t.at DESC LIMIT 1),
      (SELECT u3.id FROM users u3 WHERE u3.id = (SELECT p2.updated_by FROM count_plans p2 WHERE p2.id = ${planCol})))`);
  const gap = (col: string): string =>
    `(${col} IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ${col}))`;
  const plans = await dbRun(
    tx,
    sql`UPDATE count_plans SET inventory_updated_by = ${resolved('count_plans.inventory_updated_by', 'count_plans.id')}
    WHERE status = 'Inventory Updated' AND ${raw(gap('count_plans.inventory_updated_by'))}`,
  );
  const lines = await dbRun(
    tx,
    sql`UPDATE count_plan_lines SET inventory_updated_by = ${resolved('count_plan_lines.inventory_updated_by', 'count_plan_lines.plan_id')}
    WHERE status = 'Inventory Updated' AND ${raw(gap('count_plan_lines.inventory_updated_by'))}`,
  );
  return { plans: Number(plans.rowCount ?? 0), lines: Number(lines.rowCount ?? 0) };
}
