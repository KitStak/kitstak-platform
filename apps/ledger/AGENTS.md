<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## KitStak Ledger rules

Spec: `docs/ledger/SPEC.md` (source of truth). Stack and layering copy `apps/pulse`. Dev port 3700.

- **Money**: whole cents in `bigint` (`src/lib/money.ts`), rounded once per line, half away from zero. Cents leave the server as decimal strings. No floats.
- **One writer of the books**: only `src/server/domain/posting.ts` inserts journal rows (ESLint rule plus `posting-writer.test.ts`). Rules are pure in
  `posting-rules.ts`, one builder per row of SPEC 4.4, each unit tested.
- **Database guard (R13)**: every domain export is `scoped(...)`; `asSystem(reason, fn)` callers are listed in `src/server/db-guard.test.ts`. Tests run
  with `LEDGER_DB_GUARD=1`.
- **Access**: the preview gate is `orgLedgerAccess` in `src/server/entitlements.ts` (SPEC 3.1). Roles and rights come from `@kitstak/ledger-bridge`; pages
  gate with `ledgerPage(path, nav)`, routes with `apiRoute(handler, { rights })`, actions in the domain with `requireRight`.
- **Words**: no em or en dashes, no double dashes, and never "billing" or "subscription" on screen (`copy-rules.test.ts`). Debit and credit only on the
  Journal, the chart of accounts and reports.
- **Migrations**: `drizzle/README.md`. **Seed**: `pnpm -F kitstak-ledger db:seed <org-slug>` (step 1, setup, in Phase 0).

Phase status: Phase 0 (scaffold) done. Every route of SPEC 6 renders its gate and empty state; screens fill in by phase (SPEC 13).
