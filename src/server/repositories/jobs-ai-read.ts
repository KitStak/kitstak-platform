/**
 * Read-side AI job facts (Job Management "AI job description", Task Details "AI job description" /
 * "AI task sequence", job detail). Derived from the stored task sequence, so the description always
 * matches the route the picker actually walks.
 */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import * as schema from "@/server/db/schema";
import { describeAiJob, isAiJobType, routeStats, savingsPct, type AiRouteStats, type PickLocation } from "./jobs-ai-optimizer";

export interface AiJobFacts extends AiRouteStats {
  readonly description: string;
  readonly savingsPct: number;
}

export function aiJobFacts(db: AppDb, jobs: readonly { id: string; jobType: unknown; orderCount?: unknown }[]): Map<string, AiJobFacts> {
  const ai = jobs.filter((r) => isAiJobType(typeof r.jobType === "string" ? r.jobType : null));
  const out = new Map<string, AiJobFacts>();
  if (ai.length === 0) return out;
  const t = schema.tasks;
  const l = schema.locations;
  const rows = db.select({ jobId: t.jobId, seq: t.sequence, id: l.id, code: l.code, aisle: l.aisle, rack: l.rack, bay: l.bay, walkingPathPriority: l.walkingPathPriority })
    .from(t).innerJoin(l, eq(t.sourceLocationId, l.id))
    .where(and(inArray(t.jobId, ai.map((r) => r.id)), eq(t.taskType, "Picking"), ne(t.status, "Cancelled")))
    .orderBy(asc(t.jobId), asc(t.sequence)).all();
  const byJob = new Map<string, PickLocation[]>();
  for (const r of rows) byJob.set(r.jobId, [...(byJob.get(r.jobId) ?? []), r]);
  for (const job of ai) {
    const stats = routeStats(byJob.get(job.id) ?? []);
    const orders = Number(job.orderCount ?? 0) || 0;
    out.set(job.id, { ...stats, savingsPct: savingsPct(stats), description: `${job.jobType as string} · ${describeAiJob(orders, stats)}` });
  }
  return out;
}

