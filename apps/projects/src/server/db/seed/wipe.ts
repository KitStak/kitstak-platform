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

/** Program rows (docs/programs/SPEC.md 7), children first. Tables a database does not have yet are skipped. */
const PROGRAM_TABLES = [
  'build_output',
  'program_ledger',
  'builds',
  'build_schedule_lines',
  'build_schedules',
  'price_card_lines',
  'price_card_rules',
  'price_card_versions',
  'program_one_time_charges',
  'program_closes',
  'program_variants',
  'program_attributes',
  'program_settings',
  'wizard_drafts',
] as const;

export async function wipeOrg(orgId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Program links in core (any edge with a Projects end) go with the program rows.
    const links = await tx.execute<{ ok: boolean }>(sql`select to_regclass('core.record_links') is not null as ok`);
    if (links.rows[0]?.ok) await tx.execute(sql`delete from core.record_links where org_id = ${orgId} and (from_type like 'pm\_%' or to_type like 'pm\_%')`);
    for (const table of PROGRAM_TABLES) {
      const exists = await tx.execute<{ ok: boolean }>(sql`select to_regclass(${`pm.${table}`}) is not null as ok`);
      if (!exists.rows[0]?.ok) continue;
      if (table === 'builds') await tx.execute(sql`delete from pm.builds where org_id = ${orgId} and task_id in (select id from pm.tasks where org_id = ${orgId})`);
      await tx.execute(sql`delete from ${sql.raw(`pm.${table}`)} where org_id = ${orgId}`);
    }
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
