# Shared packages

Code that more than one KitStak app needs lives here. The design behind them is in
[`docs/integration/BLUEPRINT.md`](../docs/integration/BLUEPRINT.md).

Every package ships TypeScript source (its `exports` point at `./src/*.ts(x)`), so there's no build
step. Each app lists the packages it uses under `transpilePackages` in its `next.config.ts`, and
Next compiles them along with the app.

| Package                 | What it's for                                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kitstak/config`       | The shared tsconfig base and Vitest defaults.                                                                                                                                     |
| `@kitstak/ui`           | Design tokens (`tokens.css`), the theme and its init script, logos, app icons and the app switcher.                                                                               |
| `@kitstak/auth`         | The Better Auth setup every app uses, so one session works everywhere.                                                                                                            |
| `@kitstak/db`           | The shared `core` schema, its migrations, and the lookup from an organization to its WMS schema.                                                                                  |
| `@kitstak/entitlements` | Which organization can open which app (`crm`, `wms`, `projects`, `pulse`).                                                                                                        |
| `@kitstak/billing`      | The one price catalog, quotes, plan state, the Stripe gateway, webhook sync into `core.entitlements`, and billing email. The catalog and quote are safe to import in the browser. |
| `@kitstak/mail`         | Platform email through Resend. Server only.                                                                                                                                       |
| `@kitstak/pm-bridge`    | Lets CRM and WMS read and link KitStak Projects data (the `pm` schema).                                                                                                           |
| `@kitstak/programs-engine` | The money and planning engine for Programs: prices, accrual, month charges, rollups, forecasts, variants, imports and schedules. No database. See [its README](programs-engine/README.md). |
| `@kitstak/pulse-bridge` | Lets Portal, CRM, WMS and Projects show Pulse job profit, client profit and deep links. See [its README](pulse-bridge/README.md).                                                 |

## Rules

- Dependencies point one way: apps import packages. A package never imports an app.
- The bridges take a database handle from the app calling them. They don't open connections of
  their own.
- If two apps need the same thing, it belongs here, not copied into both.
