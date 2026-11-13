# KitStak Projects migrations (`pm` schema)

Hand-written SQL, applied by `pnpm --filter kitstak-projects db:migrate` (`scripts/db-migrate.ts`).

- Only files listed in `meta/_journal.json` are applied, strictly in `idx` order.
- Applied tags are recorded with a content hash in `drizzle.__kitstak_projects_migrations`;
  editing an applied file aborts the run. Add a new migration instead.
- Each migration runs in its own transaction under a `pg_advisory_lock` (skipped with a warning on
  a transaction-mode pooler URL, port 6543 / `pgbouncer=true`; use the direct URL, `DIRECT_URL`).
- Statements are separated by `--> statement-breakpoint` lines.
- Every `pm` table has RLS enabled (no policies; the server role owns the tables).
- **Never run `drizzle-kit push`.** The Drizzle schema in `src/server/db/schema/` mirrors these files
  for typed queries only.
- Requires the shared platform tables first (`core.organization`, `core."user"`, `core.customers`):
  run `pnpm --filter @kitstak/db db:migrate` (and the CRM migrations) before this.

| File | Contents |
| --- | --- |
| `0000_pm_init.sql` | `pm` schema: spaces, projects, members, statuses, sections, milestones, labels, custom fields, tasks (+ full-text `search`), task labels, dependencies, watchers, comments, attachments, append-only activity log, time entries, notifications, goals + key results, saved views, dashboards, automations + runs, templates, forms + submissions, integration links, user prefs, favorites, recents. Widens the entitlement module CHECK to include `projects`. |
| `0001_integration_events.sql` | `pm.integration_events`: cross-app event inbox written by CRM/WMS through `@kitstak/pm-bridge` (deal stage changes, orders shipped, tasks created from a sibling app) and drained by Projects into automation events. |
| `0002_cycles_triage.sql` | `pm.cycles` (time-boxed cycles per project, numbered, auto rollover), `pm.cycle_tasks` (task membership history for burndown and scope change), `pm.triage_items` (intake queue: accept, decline, snooze, merge as duplicate). |
| `0003_record_triggers.sql` | `pm.record_triggers` (cross-app recipes: CRM deal won creates a project from a template, WMS receipt discrepancies and cycle count variance create tasks) and `pm.record_trigger_runs` (one run per trigger and record, with what was created). |
