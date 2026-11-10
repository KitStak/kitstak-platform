# Foundation F1 — Database schema (progress)

Plan: `docs/BUILD_PLAN.md` § F1 (lines 207-1281). Status: **complete**.

- [x] `src/server/db/columns.ts`: nowIso, pk, requiredPk, bool, json, stamps, customFields, EMPTY_JSON_ARRAY/OBJECT
- [x] `src/lib/enums.ts`: every F1.2 enum, plus BILLING_*, CHANNEL_*, CARRIER_*, IMPORT_STATUSES, BG_TASK_*,
      legacy enums for kept columns, GRID_FILTER_OPS, RULE_COMPARATORS, type aliases, `isOneOf()` guard
- [x] `src/lib/domain-types.ts`: zod schemas plus inferred types for FilterCondition, RuleCondition, OrderByClause,
      AddressValue, JobTypeSettings, ClientSettings (28 switches), ChannelSettings, CarrierSettings,
      UserPreferences, and `parseSettings()`, which fills defaults from sparse stored JSON
- [x] `src/server/db/schema/*.ts`: identity, org, platform, catalog, facility, inventory, outbound, shipping,
      inbound, returns, work, counts, kitting, automation, integrations, billing. That is 110 tables.
- [x] `src/server/db/schema.ts` is now a barrel that re-exports every domain file
- [x] F1.3 additive changes to existing tables. Every legacy column is kept. Enums are widened: SO status, priority,
      PO type, job status, and `jobs.job_type`, which is now plain text.
- [x] Indexes and FKs as specified, plus a few extra lookup indexes
- [x] `drizzle/0000_foundation_schema.sql` + `drizzle/meta/*`, generated with `npm run db:generate`
- [x] `src/server/db/migrate.ts`: exports `runMigrations(sqlite)` / `migrateFile()`; the CLI is `db:migrate`
- [x] Tests: `tests/unit/foundation-f1/*.test.ts` (15 tests)
- [x] Verified: `npm run db:reset` (drop, migrate, seed) is green and repeatable; `tsc --noEmit` is clean; the full
      vitest suite passes 61/61; eslint is clean on F1 files; login plus /dashboard, /orders, /inventory,
      /products, /jobs and /receiving return 200, and every list API returns seeded data.

## Deviations / notes for later stages
- **`inventory.client_id` is nullable in the DB.** The plan says NOT NULL, but the legacy seed (F2-owned)
  inserts inventory without it, and the stage had to keep that seed working. The ledger (F3) must always
  set it, and `db:verify` (F8) should assert it is non-null. A later schema stage can then tighten it to
  NOT NULL with a regenerated migration, after F2 sets it in the seed.
- **`inventory.bucket_key`** is NOT NULL and unique. Rows written outside the ledger get a placeholder,
  `legacy:<uuid>` (`LEGACY_BUCKET_KEY_PREFIX`). The F2 seed should compute real bucket keys, and so should the F3 ledger.
- **`jobs.id` uses `requiredPk()`**, so it has no `$defaultFn`. The legacy seed reads `JobInsert.id` as a string
  before inserting. Every other table uses `pk()`, which generates a UUID default.
- **`lookup_unique_idx`** uses `CASE WHEN x IS NULL THEN '' ELSE x END` on client_id and warehouse_id. Without it,
  global (NULL-scoped) lookup values would not be unique. It uses CASE rather than coalesce because drizzle-kit
  splits index expressions on commas.
- Additional unique indexes: `warehouses_code_idx`, `clients_code_idx`, `password_reset_token_idx`.
- `receipts` lives in `schema/inbound.ts`, and `audit_log` lives in `schema/identity.ts`.
- Schema files use **relative** imports, not `@/`, so drizzle-kit can load them.
- JSON settings columns are typed with the zod *input* types (`ClientSettingsInput` etc.), because the stored
  values are sparse. Read them through `parseSettings(schema, row.settings)` to get the complete object.
- Changing the schema: edit `schema/*.ts`, then run `npm run db:generate` and commit the new `drizzle/` files.
  Never use push.
