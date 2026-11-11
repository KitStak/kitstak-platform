/**
 * Handheld Cycle Count jobs (M07, Logiwa mobile Cycle Count parity): "Your jobs" lists the open
 * count jobs assigned to the signed-in counter, "Job pool" the unassigned ones, and Take job
 * assigns a pool job to the counter (through `jobs.assign`, so tasks, change log and warehouse
 * checks follow the Job Management path). Only jobs of plans that are Ready To Count / Count
 * Started are listed, in the viewer's warehouses.
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { forbiddenError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { canAny } from "@/server/auth/permissions";
import { hasWarehouse } from "@/server/auth/scope";
import * as jobs from "@/server/domain/jobs";
import { DomainError } from "@/server/domain/errors";
import type { DomainCtx, Tx } from "@/server/domain/types";
import { COUNT_EXECUTE_PERMISSIONS, COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { recordCountEvent, userName } from "./counts-events";
import { dbAll } from "@/server/db/sql";

/** "others": open count jobs assigned to someone else, so an empty pool can say why a job is not listed. */
export const scanJobsQuerySchema = z.object({ view: z.enum(["mine", "pool", "others"]) });
export const takeJobSchema = z.object({ jobId: z.string().min(1).max(64) });

export interface ScanJobRow {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly priority: string;
  readonly planId: string;
  readonly planCode: string;
  readonly planStatus: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly assigneeUserId: string | null;
  readonly assigneeName: string | null;
  readonly taskCount: number;
  readonly doneCount: number;
  /** First locations still to count ("A-01-01, A-01-02 +3"). */
  readonly nextLocations: string | null;
  readonly remainingLocations: number;
  readonly createdAt: string;
}

/** Who may see each view: the Logiwa mobile page actions, or desktop count rights. */
export function scanViewAllowed(auth: AuthContext, view: "mine" | "pool"): boolean {
  if (auth.user.role === "admin") return true;
  const own = view === "mine" ? P.mobileYourJobs : P.mobileJobPool;
  return canAny(auth, [own, P.edit, P.updateInv] as never);
}

const PRIORITY_ORDER = sql.raw(`CASE j.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END`);

export async function listScanJobs(db: AppDb, auth: AuthContext, view: "mine" | "pool" | "others"): Promise<ScanJobRow[]> {
  // "others" is visible to whoever may see the pool (it only explains why the pool is short).
  const access = view === "others" ? "pool" : view;
  if (!scanViewAllowed(auth, access)) throw forbiddenError(view === "mine" ? "You can't view your count jobs" : "You can't view the count job pool");
  const who = view === "mine" ? sql`j.assigned_to_user_id = ${auth.user.id}`
    : view === "pool" ? sql`j.assigned_to_user_id IS NULL`
      : sql`j.assigned_to_user_id IS NOT NULL AND j.assigned_to_user_id <> ${auth.user.id}`;
  return await queryScanJobs(db, auth, who);
}

async function queryScanJobs(db: AppDb, auth: AuthContext, who: ReturnType<typeof sql>): Promise<ScanJobRow[]> {
  const rows = await dbAll<ScanJobRow>(db, sql`
    SELECT j.id, j.code, j.status, j.priority, j.created_at AS "createdAt", j.assigned_to_user_id AS "assigneeUserId", u.name AS "assigneeName",
      p.id AS "planId", p.code AS "planCode", p.status AS "planStatus", j.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
      (SELECT COUNT(*) FROM tasks t WHERE t.job_id = j.id AND t.status <> 'Cancelled') AS "taskCount",
      (SELECT COUNT(*) FROM tasks t WHERE t.job_id = j.id AND t.status = 'Completed') AS "doneCount",
      (SELECT COUNT(DISTINCT t.source_location_id) FROM tasks t WHERE t.job_id = j.id AND t.status IN ('Pending', 'Started')) AS "remainingLocations",
      (SELECT string_agg((code)::text, ', ' ORDER BY wp NULLS FIRST, code) FROM (SELECT lo.code AS code, MIN(lo.walking_path_priority) AS wp FROM tasks t JOIN locations lo ON lo.id = t.source_location_id
         WHERE t.job_id = j.id AND t.status IN ('Pending', 'Started') GROUP BY lo.code ORDER BY MIN(lo.walking_path_priority) NULLS FIRST, lo.code LIMIT 3) x) AS "nextLocations"
    FROM jobs j JOIN count_plans p ON p.id = j.count_plan_id JOIN warehouses w ON w.id = j.warehouse_id LEFT JOIN users u ON u.id = j.assigned_to_user_id
    WHERE j.status NOT IN ('Completed', 'Cancelled') AND p.status IN ('Ready To Count', 'Count Started') AND ${who}
    ORDER BY ${PRIORITY_ORDER}, j.created_at, j.code
    LIMIT 200`);
  return rows.filter((r) => hasWarehouse(auth.scope, r.warehouseId));
}

/** Take job: assigns an unassigned count job to the counter (Logiwa Job pool → Take job). */
export async function takeScanJob(tx: Tx, ctx: DomainCtx, auth: AuthContext, jobId: string): Promise<ScanJobRow> {
  if (!scanViewAllowed(auth, "pool")) throw forbiddenError("You can't take jobs from the count job pool");
  if (auth.user.role !== "admin" && !canAny(auth, COUNT_EXECUTE_PERMISSIONS as never)) throw forbiddenError("You can't enter counts, so you can't take a count job");
  const job = (await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1))[0];
  if (!job || !job.countPlanId || !hasWarehouse(auth.scope, job.warehouseId)) throw notFoundError("Count job");
  if (job.status === "Completed" || job.status === "Cancelled") throw new DomainError("INVALID_STATE", `Job ${job.code} is ${job.status.toLowerCase()}; pick another job.`);
  if (job.assignedToUserId && job.assignedToUserId !== auth.user.id) {
    throw new DomainError("CONFLICT", `Job ${job.code} was just taken by ${await userName(tx, job.assignedToUserId) ?? "another user"}. Refresh the job pool.`);
  }
  if (!job.assignedToUserId) {
    const res = await jobs.assign(tx, ctx, { jobIds: [job.id], userId: auth.user.id });
    const failed = res.failed[0];
    if (failed) throw new DomainError("INVALID_STATE", failed.message);
    const plan = (await tx.select({ id: schema.countPlans.id, code: schema.countPlans.code }).from(schema.countPlans).where(eq(schema.countPlans.id, job.countPlanId)).limit(1))[0];
    if (plan) await recordCountEvent(tx, ctx, { planId: plan.id, planCode: plan.code, text: `Count job ${job.code} taken from the job pool by ${await userName(tx, auth.user.id) ?? "a counter"}` });
  }
  const row = (await queryScanJobs(tx as unknown as AppDb, auth, sql`j.id = ${job.id}`))[0];
  if (!row) throw notFoundError("Count job");
  return row;
}
