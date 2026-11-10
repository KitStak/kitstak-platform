/**
 * Search provider "jobs" (Jobs). Matches job code and wave number inside the caller's
 * warehouse/client scope (scopedWhere); M03 may replace it with a repository-backed one.
 */
import { and, desc, or, type SQL } from "drizzle-orm";
import { scopedWhere } from "@/server/auth/scope";
import { jobs } from "@/server/db/schema";
import { COUNT_ALL, containsText, matchRank } from "../match";
import { hitRank, listSearchHref, type SearchContext, type SearchProvider } from "../types";

function where({ auth, q }: Pick<SearchContext, "auth" | "q">): SQL {
  const text = or(containsText(jobs.code, q), containsText(jobs.waveNumber, q)) as SQL;
  const scope = scopedWhere(jobs, auth.scope);
  return scope ? (and(text, scope) as SQL) : text;
}

function ordersLabel(count: number): string {
  return `${count} ${count === 1 ? "order" : "orders"}`;
}

export const provider: SearchProvider = {
  key: "jobs",
  label: "Jobs",
  singular: "Job",
  owner: "foundation",
  configured: true,
  permission: "fulfillment.job_management.view",
  seeAllHref: (q) => listSearchHref("/jobs", q),
  count: (ctx) => ctx.db.select({ n: COUNT_ALL }).from(jobs).where(where(ctx)).get()?.n ?? 0,
  search: (ctx) =>
    ctx.db
      .select({ id: jobs.id, code: jobs.code, waveNumber: jobs.waveNumber, status: jobs.status, jobType: jobs.jobType, orderCount: jobs.orderCount })
      .from(jobs)
      .where(where(ctx))
      .orderBy(matchRank(jobs.code, ctx.q), desc(jobs.code))
      .limit(ctx.limit)
      .all()
      .map((j) => ({
        id: j.id,
        title: j.code,
        subtitle: `${j.jobType} · ${ordersLabel(j.orderCount)}`,
        status: { label: j.status, domain: "job" },
        href: `/jobs/${j.id}`,
        rank: hitRank(ctx.q, [j.code, j.waveNumber]),
      })),
};
