# KitStak workspace packages

Shared packages per [`docs/integration/BLUEPRINT.md`](../docs/integration/BLUEPRINT.md) §4.
All packages ship TypeScript source (exports point at `./src/*.ts(x)`) — there is no build step.

> **App wiring note (next stage — do not edit apps in this stage):** each app's
> `next.config.ts` must add
> `transpilePackages: ['@kitstak/ui', '@kitstak/config']`
> (extended with `@kitstak/auth`, `@kitstak/db`, `@kitstak/entitlements` as those land)
> so Next compiles the source-shipped packages. Apps will also switch
> `tsconfig.json` to `"extends": "@kitstak/config/tsconfig/base.json"` and import
> `@kitstak/ui/styles/tokens.css` from their `globals.css`.

## Packages

| Package           | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `@kitstak/config` | Shared tsconfig base and vitest defaults (thresholds, mocks).  |
| `@kitstak/ui`     | Canonical `tokens.css`, unified theme constants + init script, app icons and the app switcher (Portal, CRM, WMS, Projects, Pulse). |
| `@kitstak/auth`   | Shared Better Auth setup: one session across every app. |
| `@kitstak/db`     | Shared `core` schema, migrations and the WMS tenant schema lookup. |
| `@kitstak/entitlements` | Which org is licensed for which module (`crm`, `wms`, `projects`, `pulse`). |
| `@kitstak/pm-bridge` | Shared-database bridge into KitStak Projects (the `pm` schema) for CRM and WMS. |
| `@kitstak/pulse-bridge` | Shared-database bridge into KitStak Pulse (the `pulse` schema) for Portal, CRM, WMS and Projects: job profit for a linked record, client profit, workspace totals, a person's Pulse role, deep links and change events. See its README. |
| `@kitstak/programs-engine` | Pure money and planning engine for Programs: price resolution, accrual and posting, month charges, rollups, forecasts, variants, imports, schedules, runs, deal helpers, formatting and barcodes. No database, zero runtime dependencies. Pulse money and calendar math live here and Pulse re-exports them. See its README. |

Dependency direction: `config ← ui ← apps`. No package imports from an app.
