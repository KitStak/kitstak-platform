# KitStak Platform

Unified monorepo for the KitStak product suite: Portal, CRM, WMS, Projects and Pulse,
deeply integrated, running together as one platform or independently per license.

## Structure

```
apps/
  portal/     KitStak Portal: launcher, billing and organization (Next.js, port 3300)
  crm/        KitStak CRM: pipelines, boards and automations (Next.js, port 3100)
  wms/        KitStak WMS: receiving, inventory and shipping (Next.js, port 3000)
  projects/   KitStak Projects: projects, tasks and timelines (Next.js, port 3400)
  pulse/      KitStak Pulse: profit by job, client and service (Next.js, port 3500)
  web/        Marketing site (Next.js)
packages/
  auth/           Shared Better Auth SSO (single session across all apps)
  db/             Shared core schema (orgs, users, customers, items, entitlements)
  entitlements/   Which org is licensed for which module (crm, wms, projects, pulse)
  ui/             Shared design system: tokens, logo, app icons, app switcher, handoff
  pm-bridge/      Shared-database bridge into Projects for the sibling apps
  pulse-bridge/   Shared-database bridge into Pulse: job and client profit for the sibling apps
  config/         Shared tsconfig / eslint / tailwind presets
```

Each app has its own Postgres schema in one shared database (`core`, `crm`, `wms`, `pm`, `pulse`)
and runs on its own or bundled with the others. App docs: `docs/projects/`, `docs/pulse/`.

## Development

```bash
pnpm install
pnpm dev            # all apps
pnpm dev:portal     # Portal only (port 3300)
pnpm dev:crm        # CRM only (port 3100)
pnpm dev:wms        # WMS only (port 3000)
pnpm dev:projects   # Projects only (port 3400)
pnpm dev:pulse      # Pulse only (port 3500)
```

## Provenance

- `apps/crm` imported from https://github.com/KitStak/KitStakCRM (full history preserved via git subtree)
- `apps/wms` imported from https://github.com/KitStak/KitStakWMS (full history preserved via git subtree)
