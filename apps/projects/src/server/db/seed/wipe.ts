/**
 * Removes every `pm` row of one org so the seed can run again from a clean slate. Only the pm
 * schema is touched (CRM, WMS and core data stay as they are). Per-person UI preferences
 * (`pm.user_prefs`: theme, onboarding progress) are kept on purpose.
 *
 * Order matters: tasks reference statuses with ON DELETE RESTRICT, so tasks go before projects.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';

const ORG_TABLES_BEFORE_TASKS = [
  'integration_events',
  'notifications',
  'automation_runs',
  'form_submissions',
  'time_entries',
  'attachments',
  'comments',
  'task_dependencies',
  'task_labels',
  'watchers',
  'integration_links',
  'activity',
] as const;

const ORG_TABLES_AFTER_TASKS = [
  'automations',
  'forms',
  'templates',
  'saved_views',
  'dashboards',
  'goal_projects',
  'goal_key_results',
  'goals',
  'favorites',
  'recents',
  'projects',
  'labels',
  'custom_fields',
  'spaces',
] as const;

export async function wipeOrg(orgId: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of ORG_TABLES_BEFORE_TASKS) {
      if (table === 'integration_events') {
        // Added by a later migration; skip quietly if it isn't there yet.
        const exists = await tx.execute<{ ok: boolean }>(sql`select to_regclass('pm.integration_events') is not null as ok`);
        if (!exists.rows[0]?.ok) continue;
      }
      await tx.execute(sql`delete from ${sql.raw(`pm.${table}`)} where org_id = ${orgId}`);
    }
    await tx.execute(sql`delete from pm.tasks where org_id = ${orgId}`);
    for (const table of ORG_TABLES_AFTER_TASKS) {
      await tx.execute(sql`delete from ${sql.raw(`pm.${table}`)} where org_id = ${orgId}`);
    }
  });
}
