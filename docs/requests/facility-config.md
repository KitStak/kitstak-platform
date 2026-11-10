# Requests from M10 facility-config

## REQ-1 — `fromZodError` must not put the raw field key in `error.message`
- **File:** `src/server/api/errors.ts`, `fromZodError`
- **Change:** build `message` from the first issue's message only (or "Fix the highlighted fields" when more than one field fails). Drop the `${path} — ` part. Keep `fieldErrors` as they are.
- **Reason:** drawers show `error.message` in toasts. Today `POST /api/lp-numbers` with SSCC18 and no client returns "Invalid request: clientId — Client is required for SSCC18 numbers", which shows the camelCase key to users. M10 works around it on the client with `friendlyErrorMessage` (`src/lib/grid-defs/facility/common.ts`). Every other module has the same leak.
- **Status:** applied (verified by F-patch 2026-11-06): `fromZodError` builds `message` from the first issue only (or "Fix the highlighted fields" when several fields fail); `fieldErrors` unchanged. `friendlyErrorMessage` can go.

## REQ-2 — make `locations.walking_path_priority` and `locations.column` nullable
- **File:** `src/server/db/schema/facility.ts` (`locations`), plus a migration
- **Change:** `walkingPathPriority: integer("walking_path_priority")` and `column: integer("column")`, with no `.notNull().default(0)`. `level` (text) is fine: M10 now stores `""` for blank.
- **Reason:** a blank walking path or column should be stored as null, not as a fake 0. Until this lands, M10 stores 0 and reads 0 back as "not set" (`unsetAsNull` in `src/lib/grid-defs/facility/locations.ts`). After it lands, M10 will drop the `?? 0` in `columnsFor`.
- **Status:** rejected: conflicts with the BUILD_PLAN F1 locations schema (`walkingPathPriority` and `column` are specified `.notNull().default(0)`), and "schema changes are additive". On SQLite, dropping NOT NULL means a full `locations` rebuild; the Drizzle migrator runs inside a transaction where `PRAGMA foreign_keys=OFF` does nothing, so `DROP TABLE locations` on the live DB would cascade-delete child rows (`onDelete: cascade`) or fail on the inventory FKs. It would also turn `number` into `number | null` in about 40 files across modules that are mid-flight, and change pick-path ordering (NULL sorts first). **Alternative:** keep 0 as "not set" (M10's `unsetAsNull` stays; show blank in the UI, store 0). If it still matters, it can go into the next schema baseline when a `db:reset` is allowed.
