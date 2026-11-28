# KitStak Crew migrations (`crew` schema)

Hand written SQL with `--> statement-breakpoint` lines, applied in journal order by
`scripts/db-migrate.ts` (`pnpm --filter kitstak-crew db:migrate`) under advisory lock `7_202_611_506`,
recorded in `drizzle.__kitstak_crew_migrations`. Never `drizzle-kit push`. Applied files are
immutable: the runner refuses a changed hash, so add a new file instead.

Fresh database order: `@kitstak/db` (including `0012_core_vendors`), CRM, WMS, Projects, Pulse, then Crew last.

Every new table needs, in the same migration: `UNIQUE (org_id, id)`, composite FKs to crew parents,
RLS on with the `crew_org_isolation` policy, and nothing else (crew_app gets its grants through the
default privileges of 0000). `src/server/domain/rls.db.test.ts` fails otherwise.

## Log

- **0000_crew_init** (Phase 0). SPEC 5.1 (settings, member_roles, sites, site_rules, break_rules,
  areas, labor_classes), 5.2 (people, person_private, person_pay, person_wages, agency_links,
  agency_submissions) and 5.8 (attachments, activity, notifications, outbox_email, import_batches,
  import_rows, import_presets, user_prefs, sync_state, sync_runs, dismissals). Triggers: activity
  append only (`KC002`), vendor same org on people and agency_links (core.vendors has no
  `(org_id, id)` key). RLS on all 24 tables. The plain role `crew_app` with grants on crew and
  read policies on core.organization, core.member, core."user", plus read and write on
  core.vendors (policy `crew_app_own_org`). Does not touch the `core.entitlements` module CHECK.
  `sites.default_template_id` has no FK until 0001 makes `crew.shift_templates`.
- **0001_crew_user_delete** (Phase 1). `crew.activity_immutable` (KC002) now lets through the one
  UPDATE that ON DELETE SET NULL makes: `actor_id` going from a person to null with every other
  column unchanged (the Ledger 0002 fix). Before it, deleting any person who ever did something in
  Crew failed in every app. Any other change, or blanking plus another change, is still refused.
  Phase 1 itself needed no new table: 0000 already holds 5.1, 5.2 and 5.8. Because this file took
  the number 0001, the schedule migration of Phase 2 is `0002_crew_schedule` and each later phase
  moves up one (clock 0003, approvals 0004, attendance 0005, skills 0006, plan 0007). Append only
  tables of later phases (punches, punch edits) need the same person column rule in their trigger.
