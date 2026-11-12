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
| `@kitstak/ui`     | Canonical `tokens.css`, unified theme constants + init script. |

Dependency direction: `config ← ui ← apps`. No package imports from an app.
