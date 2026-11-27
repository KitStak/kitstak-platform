/**
 * Scheduled work (SPEC section 1): the 15 minute tick and the daily cleanup. Each org runs in
 * its own try and catch, so one bad org never blocks the rest. The tick here covers the day
 * rollover (date based status rules) and alerts; sibling sync and bridge events plug in beside it.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { asSystem, scoped } from '@/server/db/scope';
import { orgHasPulseModule } from '@/server/entitlements';
import { rows, type DomainContext } from './_shared';
import { evaluateAlerts } from './alerts';
import { recomputeJobs } from './job-stats';

/** Acts for an org as "KitStak" (a system actor, treated as the workspace owner). */
export const systemContext = scoped(async function systemContext(orgId: string): Promise<DomainContext | null> {
  const [org] = await rows<{ slug: string; user_id: string | null }>(
    db,
    sql`SELECT o.slug, (SELECT m.user_id FROM core.member m WHERE m.organization_id = o.id ORDER BY (m.role LIKE '%owner%') DESC, m.created_at LIMIT 1) AS user_id
          FROM core.organization o WHERE o.id = ${orgId}`,
  );
  if (!org?.user_id) return null;
  return { orgId, orgSlug: org.slug, userId: org.user_id, userName: 'KitStak', orgRole: 'owner', actorKind: 'system' };
});

/** Orgs that use Pulse (they have a settings row), least recently ticked first. */
export async function orgsUsingPulse(): Promise<string[]> {
  const found = await asSystem('cron: list every workspace that uses Pulse', () => rows<{ org_id: string }>(db, sql`SELECT s.org_id FROM pulse.settings s ORDER BY (SELECT max(st.computed_at) FROM pulse.job_stats st WHERE st.org_id = s.org_id) NULLS FIRST`));
  return found.map((row) => row.org_id);
}

/**
 * One org's tick: rebuilds the numbers of open jobs so the date based rules (nothing logged for
 * days, due soon, finish after the due date) follow the calendar, then checks the alert rules.
 */
export const tickOrg = scoped(async function tickOrg(orgId: string): Promise<{ jobs: number; alerts: { created: number; updated: number; resolved: number } } | null> {
  if (!(await orgHasPulseModule(orgId))) return null;
  const ctx = await systemContext(orgId);
  if (!ctx) return null;
  const jobs = await rows<{ id: string }>(db, sql`SELECT id FROM pulse.jobs WHERE org_id = ${orgId} AND deleted_at IS NULL AND status IN ('active', 'on_hold')`);
  // Sibling sync first (bridge events, then any connected app that is stale), so the rollups below see it. Never throws.
  const { syncIfStale } = await import('./sync');
  await syncIfStale(ctx, 'cron');
  if (jobs.length > 0) await db.transaction((tx) => recomputeJobs(tx, ctx, jobs.map((job) => job.id)));
  return { jobs: jobs.length, alerts: await evaluateAlerts(ctx) };
});

/** The 15 minute tick over every org, inside a time budget. */
export async function runTick(budgetMs = 240_000): Promise<{ orgs: number; jobs: number; alertsCreated: number; failed: number }> {
  const started = Date.now();
  let orgs = 0;
  let jobs = 0;
  let alertsCreated = 0;
  let failed = 0;
  for (const orgId of await orgsUsingPulse()) {
    if (Date.now() - started > budgetMs) break;
    try {
      const result = await tickOrg(orgId);
      if (!result) continue;
      orgs += 1;
      jobs += result.jobs;
      alertsCreated += result.alerts.created;
    } catch (error) {
      failed += 1;
      console.error('[pulse] tick failed', { orgId, error });
    }
  }
  return { orgs, jobs, alertsCreated, failed };
}

/** Daily retention (SPEC 5.4): old import row bodies, report builds, read notifications, sync runs, bridge events, activity past 7 years. */
export async function runCleanup(): Promise<Record<string, number>> {
  const count = async (query: ReturnType<typeof sql>): Promise<number> => (await asSystem('cron: daily cleanup across workspaces', () => db.execute(query))).rowCount ?? 0;
  return {
    importRows: await count(sql`UPDATE pulse.import_rows r SET raw = NULL, parsed = NULL, "before" = NULL
                                 FROM pulse.import_batches b WHERE b.id = r.batch_id AND b.undo_until < now() AND (r.raw IS NOT NULL OR r.parsed IS NOT NULL OR r."before" IS NOT NULL)`),
    reportRuns: await count(sql`DELETE FROM pulse.report_runs WHERE created_at < now() - interval '90 days'`),
    notifications: await count(sql`DELETE FROM pulse.notifications WHERE read_at IS NOT NULL AND read_at < now() - interval '90 days'`),
    syncRuns: await count(sql`DELETE FROM pulse.sync_runs WHERE started_at < now() - interval '30 days'`),
    bridgeEvents: await count(sql`DELETE FROM pulse.bridge_events WHERE (processed_at IS NOT NULL AND processed_at < now() - interval '7 days') OR (processed_at IS NULL AND attempts >= 5 AND created_at < now() - interval '30 days')`),
    activity: await count(sql`DELETE FROM pulse.activity WHERE created_at < date_trunc('month', now() - interval '7 years')`),
  };
}
