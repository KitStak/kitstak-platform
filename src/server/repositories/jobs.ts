import { and, count, desc, eq, like, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { likePattern, offsetOf, type ListResult } from "./shared";

const { jobs, users, clients } = schema;

export type JobStatus = (typeof jobs.$inferSelect)["status"];
export type JobType = (typeof jobs.$inferSelect)["jobType"];

export const JOB_STATUSES = ["Pending", "In Progress", "Completed", "Cancelled"] as const;

export const JOB_TYPES = [
  "Single Unit Orders",
  "Multi Item Orders",
  "B2B Order Picking",
  "Cycle Count",
  "Dynamic Replenishment",
] as const;

export interface JobListParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: JobStatus;
  jobType?: JobType;
}

export interface JobListRow {
  id: string;
  code: string;
  jobType: JobType;
  status: JobStatus;
  priority: string;
  clientName: string | null;
  assigneeName: string | null;
  orderCount: number;
  unitCount: number;
  completedUnits: number;
  waveNumber: string | null;
  ruleName: string | null;
  createdAt: string;
  completedAt: string | null;
}

export function listJobs(params: JobListParams): ListResult<JobListRow> {
  const conds: Array<SQL | undefined> = [];
  if (params.status) conds.push(eq(jobs.status, params.status));
  if (params.jobType) conds.push(eq(jobs.jobType, params.jobType));
  if (params.search) {
    const p = likePattern(params.search);
    conds.push(or(like(jobs.code, p), like(jobs.waveNumber, p), like(jobs.ruleName, p)));
  }
  const where = and(...conds);
  const rows = db
    .select({
      id: jobs.id,
      code: jobs.code,
      jobType: jobs.jobType,
      status: jobs.status,
      priority: jobs.priority,
      clientName: clients.name,
      assigneeName: users.name,
      orderCount: jobs.orderCount,
      unitCount: jobs.unitCount,
      completedUnits: jobs.completedUnits,
      waveNumber: jobs.waveNumber,
      ruleName: jobs.ruleName,
      createdAt: jobs.createdAt,
      completedAt: jobs.completedAt,
    })
    .from(jobs)
    .leftJoin(users, eq(jobs.assignedToUserId, users.id))
    .leftJoin(clients, eq(jobs.clientId, clients.id))
    .where(where)
    .orderBy(desc(jobs.createdAt))
    .limit(params.pageSize)
    .offset(offsetOf(params.page, params.pageSize))
    .all();
  const total = db.select({ n: count() }).from(jobs).where(where).get()?.n ?? 0;
  return { rows, total };
}
