/**
 * Scheduled work (docs/ledger/SPEC.md 1, 3.3, 5.7). Cross workspace by design, so each step runs
 * under `asSystem` with its reason; every org fan out checks the preview gate first.
 *   tick    (every 5 minutes) people who left an org lose their Ledger role row.
 *   cleanup (daily)           import raw rows after the 7 day undo window, read notifications
 *                             after 90 days, sync runs after 30 days, processed bridge events
 *                             after 7 days (failed after 30).
 * The sync outbox, reminders, recurring runs and promise checks join the tick with their phases.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { asSystem } from '@/server/db/scope';
import { orgLedgerAccess } from '@/server/entitlements';

const count = (result: { rowCount?: number | null }): number => result.rowCount ?? 0;

export async function runTick(): Promise<{ readonly orgs: number; readonly rolesRemoved: number }> {
  return asSystem('cron tick: fan out over every org with Ledger', async () => {
    const orgs = await db.execute<{ id: string; slug: string }>(sql`select o.id, o.slug from core.organization o where exists (select 1 from ledger.settings s where s.org_id = o.id)`);
    const open = orgs.rows.filter((org) => orgLedgerAccess(org) === 'full').map((org) => org.id);
    if (open.length === 0) return { orgs: 0, rolesRemoved: 0 };
    const removed = await db.execute(
      sql`delete from ledger.member_roles r
           where r.org_id in (${sql.join(open.map((id) => sql`${id}::uuid`), sql`, `)})
             and not exists (select 1 from core.member m where m.organization_id = r.org_id and m.user_id = r.user_id)`,
    );
    return { orgs: open.length, rolesRemoved: count(removed) };
  });
}

export async function runCleanup(): Promise<Record<string, number>> {
  return asSystem('cron cleanup: retention across every org', async () => {
    const rows = await db.execute(sql`update ledger.import_rows r set raw = null from ledger.import_batches b where b.id = r.batch_id and r.raw is not null and b.created_at < now() - interval '7 days'`);
    const notes = await db.execute(sql`delete from ledger.notifications where read_at is not null and read_at < now() - interval '90 days'`);
    const runs = await db.execute(sql`delete from ledger.sync_runs where started_at < now() - interval '30 days'`);
    const events = await db.execute(
      sql`delete from ledger.bridge_events where (processed_at is not null and processed_at < now() - interval '7 days') or (parked_at is not null and parked_at < now() - interval '30 days')`,
    );
    return { importRowsCleared: count(rows), notificationsRemoved: count(notes), syncRunsRemoved: count(runs), bridgeEventsRemoved: count(events) };
  });
}
