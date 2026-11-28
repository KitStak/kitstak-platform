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
