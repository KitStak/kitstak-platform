# Foundation F0 — Tooling, dependencies, test harness (progress)

Plan: `docs/BUILD_PLAN.md` § F0 (lines 177-206). Status: **complete**.

- [x] Runtime deps (pinned exact): radix-ui, cmdk, react-hook-form, @hookform/resolvers,
      @tanstack/react-query, react-day-picker, @dnd-kit/core, @dnd-kit/sortable,
      @tanstack/react-virtual, @xyflow/react, exceljs, pdf-lib, bwip-js, nanoid
- [x] Dev deps: vitest 5, @vitest/coverage-v8, @testing-library/{react,dom,user-event}, jsdom,
      @playwright/test, @axe-core/playwright. `@types/node` -> 24 (vitest 5 peer).
      playwright / @playwright/test / playwright-core pinned to 1.55.0 = the chromium-1187 build
      already installed on this machine (no browser download needed).
- [x] Scripts: typecheck, test, test:watch, test:coverage, test:e2e, db:generate, db:migrate,
      db:seed, db:drop, db:reset (= db:drop -> db:migrate -> db:seed), db:verify, audit:dead-clicks.
      `db:push` removed (generated migrations replace it).
- [x] vitest.config.ts (node env default; `// @vitest-environment jsdom` per file; `@/` alias;
      `server-only` stubbed) + tests/setup/{vitest.setup,test-db,empty-module}.ts.
      `tests/setup/test-db.ts#createTestDb()` = in-memory SQLite with `drizzle/` migrations applied.
- [x] playwright.config.ts: baseURL http://localhost:3000 (E2E_BASE_URL), reuses the running server;
      projects auth-setup / e2e / dead-click-audit; output under .data/playwright (gitignored).
- [x] tests/e2e/fixtures: roles.ts, login.ts (API login, 429 retry), auth.setup.ts (storage state per
      role in .data/e2e-auth), auth.ts (adminPage/managerPage/operatorPage/viewerPage/asRole),
      a11y.ts (axe WCAG 2.1 A/AA helper), dead-click-{core,page,audit.spec}.ts, nav-routes.ts.
- [x] scripts/db-reset.ts + scripts/lib/drop-all.ts — drops all schema objects in-process
      (never deletes the DB file the dev server holds open).
- [x] next.config.ts: HSTS in production; legacy `?tab=` redirects (308), each enabled only once its
      destination page exists (re-evaluated at build / dev start) so current pages keep working.
- [x] .env.example documented; .env.local created with random SESSION_SECRET + CRON_SECRET.
- [x] src/instrumentation.ts (nodejs runtime only, SCHEDULER_ENABLED=0 opt-out, never blocks boot)
      + src/server/scheduler/index.ts no-op `startScheduler()` stub (F6 owns it).
- [x] Unit tests: tests/unit/foundation/*.test.ts(x) — 46 passing.
- [x] Verified: typecheck clean; `npm test` 46/46; lint 0 errors (22 pre-existing warnings);
      auth-setup project 4/4; dead-click audit runs (AUDIT_ROUTES=/clients finds 7 real dead
      controls in the baseline UI — expected until modules land).

## Handoffs / notes for later stages
- `db:migrate` runs `src/server/db/migrate.ts` (F1) and `db:verify` runs `scripts/verify-ledger.ts`
  (F8); both scripts are wired but those files belong to their stages.
- Running audit in Git Bash: set `MSYS_NO_PATHCONV=1` before `AUDIT_ROUTES=/orders`.
- Opt a control out of the audit with `data-audit-skip` only with a code comment explaining why.
