# F8 — Foundation acceptance gate: progress

Run on 2026-11-05 against the shared dev server (http://localhost:3000) and a fresh `npm run db:reset`.

## Gate commands
- [x] `npm run db:reset` (about 1 min) followed by `npm run db:verify`: OK, "every invariant reconciles" (932 buckets, 3105 transactions).
- [x] `npm run typecheck`: clean.
- [x] `npm run lint`: 0 errors. There are 22 warnings, all `react-hooks/set-state-in-effect` or `incompatible-library`, and all in legacy module pages and the TanStack Virtual / RHF watch. The modules replace those pages.
- [x] `npm test`: green. The F6-noted instrumentation assertion was fixed, and the seed test cleanup timeout was raised.
- [x] `npx next build`: succeeds alongside the dev server, because Next 16 dev writes to `.next/dev`. Its 3 Turbopack warnings were fixed:
  - Moved instrumentation's Node-only code to `src/instrumentation-node.ts`.
  - Added `turbopackIgnore` to the dynamic paths in `src/server/files/files.ts`.

## F8 items
- [x] 1. Fresh-clone pipeline (attempt 2): the clone-equivalent file set (`git ls-files -co --exclude-standard`, no `.env.local`, no node_modules) was copied to a scratch dir and run end to end: `npm ci --ignore-scripts` (better-sqlite3 loads without a native build), db:reset, db:verify (932 buckets / 3105 tx reconcile), typecheck, lint (0 errors), `npm run build` and `npm test` (53 files / 498 tests) all exit 0. The first test run hit a vitest worker start timeout under machine load; `vitest.config.ts` now caps `maxWorkers: "50%"`.
- [x] 2. All 131 registered routes resolve with no error boundary, and each placeholder shows its label (`tests/e2e/foundation/acceptance.spec.ts`). The 11 legacy `?tab=` URLs return 308 to their routes. This needs a dev-server restart after the destination pages are added; touching `next.config.ts` triggers it.
- [x] 3. Access control (same spec):
  - The viewer sees no Settings menu.
  - A viewer on /settings/users lands on /forbidden.
  - A viewer POST /api/tags returns 403 FORBIDDEN.
  - A POST without the CSRF token returns 403 CSRF.
  - Deactivating a user makes /api/me return 401 and redirects pages to /login on the next request.
- [x] 4. /dev/ui critic review (attempt 2): reviewed in the browser and automated in `tests/e2e/foundation/dev-ui.spec.ts` (9/9 pass): every section and primitive present, all status-pill maps, no hydration/DOM-nesting errors; wizard linear mode locks steps 2-3 and per-step validation shows both errors and focuses SKU; free mode makes every step clickable with edit defaults; drawer (pills) variant present; grid shows 424 seeded orders (100/page) with search mode, filter builder (opens), saved views, Actions, column move handles, page sizes, CSV + async export, selection enabling bulk actions; viewer gets /forbidden. A human design critic may still add taste notes, but there is nothing functionally blocking.
- [x] 5. The dead-click audit passes on the shell (`AUDIT_ROUTES=/dashboard`). The audit now skips controls that are already current (`aria-selected` / `aria-pressed` = true), because re-selecting them is a no-op. The full-app crawl (every legacy module page) takes more than 20 min and is the job of each module's own gate.
- [x] 6. Domain scenario `tests/unit/foundation/domain/scenario.test.ts` passes, and the ledger is reconciled after every step.

## Other fixes
- `src/proxy.ts`: `/api/cron/` is now public, so the route's own CRON_SECRET bearer check runs (F7 note).

## Running the acceptance spec
`npm run db:reset && npx playwright test --project=e2e tests/e2e/foundation`

## Attempt 2 re-verification (2026-11-05)
- Worktree: typecheck clean, lint 0 errors (22 legacy warnings), `npm test` 53 files / 498 tests.
- `tests/e2e/foundation/acceptance.spec.ts`: 151 passed (routes, ?tab= redirects, access control, deactivation).
- Dead-click audit `AUDIT_ROUTES=/dashboard`: 5 passed.
- Full-app dead-click crawl over every legacy module page is intentionally left to each module's gate (F8.5 wording is the shell).

## Known non-blocking finding (for the shell / F4c owner)
- In dev, Next's instant-navigation validation logs "Could not validate `instant` ... An error occurred while attempting to validate instant UI" at `AppLayout` on full page loads. The (app) layout wraps every page inside the Suspense-ed `AuthedShell` (auth + redirect), so the page segment cannot render during validation. Dev-overlay warning only; build and runtime are unaffected. Fix options: move the auth gate beside `{children}` per `optimizing-the-static-shell.md` step 2, or set `export const instant = false` on the (app) layout.
