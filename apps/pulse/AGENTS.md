<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## KitStak Pulse rules

- Read `docs/pulse/SPEC.md` and `docs/pulse/CONTRACTS.md` first. Contracts are authoritative for folder ownership, function names and DTOs.
- Data access goes through `src/server/domain/*` (first argument `ctx: DomainContext`; permission checks, activity log, money hiding). Never query `pulse.*` from components or routes directly.
- Mutations: server actions in `src/server/actions/*` (return `ActionResult` through `runAction`). Reads for client components: same origin `/api/v1/*` via hooks in `src/lib/hooks/use-data.ts`. The API sends no CORS headers; sibling apps use `@kitstak/pulse-bridge`.
- Money is integer cents (`bigint`) and all money math lives in `src/lib/money.ts` with `BigInt`. Never use floats for money. Dates are `YYYY-MM-DD` strings. Every row is scoped by `org_id` (`core.organization.id`).
- Money hiding happens on the server: DTO builders take `canSeeMoney` and `canSeeWages` and return `null` money fields with `moneyHidden: true`. Never store money inside a sentence.
- Every page sends a Content-Security-Policy with a per request nonce (`src/proxy.ts`, `src/server/http/csp.ts`). An inline script needs the nonce, nothing loads from another origin, and no page is built ahead of time (CONTRACTS section 12, rule 14).
- Every `pulse` table has a row level security policy on `org_id` (`drizzle/0007_rls_policies.sql`). A new table needs its policy in the migration that makes it; `rls.db.test.ts` fails without one.
- The database guard (CONTRACTS section 12, rule 13): with `PULSE_DB_GUARD=1` (on in tests) `db` runs every statement as the plain role `pulse_app` for one workspace. Declare every exported data function that takes a `DomainContext` or an org id as `export const name = scoped(async function name(ctx, ...) { ... })` (`@/server/db/scope`). A statement with no scope is refused. Cross workspace work goes through `asSystem('<reason>', fn)`, sibling schemas through `siblingDb`; both are allow listed in `src/server/db-guard.test.ts`.
- Schema changes: add a new `drizzle/000N_*.sql` + journal entry + mirror in `src/server/db/schema`. Applied migrations are immutable. Never `drizzle-kit push`. Pulse migrates last (see `drizzle/README.md`).
- Sibling data (CRM, WMS, Projects) is read fail soft through `src/server/integrations/*`: guard with `to_regclass`, catch everything, hide the UI when the app is absent. Pulse must work with nothing else installed.
- Visual language = Portal, CRM and Projects: tokens from `@kitstak/ui`, primitives from `@/components/ui`, page frame from `@/components/layout/page`, Pulse building blocks from `@/components/pulse`. Navigation lives in `src/lib/nav.ts` (sidebar, mobile drawer and command palette all read it).
- Routes are thin: `src/app/(app)/<route>/page.tsx` imports a page from `src/features/<area>`. Use the builders in `src/lib/routes.ts`, never string literals.
- Client components import other client components by file path, not through a feature `index.ts` (indexes may export server pages).
- Copy: plain words an 8th grader knows, short sentences, and never an em dash, en dash or double dash. Use commas, periods or colons; ranges read "to". Use the on screen words from the table at the top of the spec ("Extra services", "Target pace", "Real cost of an hour"). ESLint and `src/lib/copy-rules.test.ts` enforce the dash rule.
- Margins have two names on screen: "Job margin" and "Company margin". Any other margin goes inside "How we got this". Timestamps in client components use `RelativeTime` or `LocalTime` from `@/components/pulse/local-time`, so the server and the browser print the same first paint.
- No placeholders, TODOs, lorem ipsum or dead buttons. Every empty state teaches: what this is, why it matters, and the next action.
- Dev servers: port 3500, personal servers 3501 to 3520 with `NEXT_DIST_DIR=.next/<name>`. Do not run `pnpm build` while dev servers are up.
