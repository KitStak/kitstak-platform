/**
 * M03 integrity checks for `npm run db:verify` (requested from foundation: R5-2 in
 * docs/requests/fulfillment-jobs.md). Every count must be 0 on a healthy database.
 *
 *   wave_jobs_created_mismatch — waves whose `jobs_created` differs from the jobs stamped with the wave.
 *   dead_live_jobs             — Pending / Started jobs that have tasks but none of them open.
 *   stale_job_orders           — live-job order links whose order has no live task left in the job.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { Tx } from "@/server/domain/types";

export interface JobsInvariantReport {
  readonly wave_jobs_created_mismatch: number;
  readonly dead_live_jobs: number;
  readonly stale_job_orders: number;
}

const n = (db: AppDb | Tx, q: ReturnType<typeof sql>): number => Number(db.get<{ n: number }>(q)?.n ?? 0);

export function jobsInvariants(db: AppDb | Tx): JobsInvariantReport {
  return {
    wave_jobs_created_mismatch: n(db, sql`SELECT COUNT(*) AS n FROM waves w WHERE w.jobs_created <> (SELECT COUNT(*) FROM jobs j WHERE j.wave_id = w.id)`),
    dead_live_jobs: n(db, sql`SELECT COUNT(*) AS n FROM jobs j WHERE j.status IN ('Pending', 'Started', 'In Progress')
      AND EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = j.id)
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = j.id AND t.status IN ('Pending', 'Started'))`),
    stale_job_orders: n(db, sql`SELECT COUNT(*) AS n FROM job_orders jo JOIN jobs j ON j.id = jo.job_id
      WHERE j.status IN ('Pending', 'Started', 'In Progress')
      AND EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = jo.job_id AND t.order_id = jo.order_id)
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.job_id = jo.job_id AND t.order_id = jo.order_id AND t.status <> 'Cancelled')`),
  };
}
