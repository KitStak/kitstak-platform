# KitStak Platform

Unified monorepo for the KitStak product suite: a deeply integrated CRM and WMS
that run together as one platform or independently per license.

## Structure

```
apps/
  crm/        KitStak CRM (Next.js)
  wms/        KitStak WMS (Next.js)
packages/
  auth/       Shared Better Auth SSO (single session across all apps)
  db/         Shared core schema (orgs, users, customers, items, entitlements)
  ui/         Shared design system components
  config/     Shared tsconfig / eslint / tailwind presets
```

## Development

```bash
pnpm install
pnpm dev          # all apps
pnpm dev:crm      # CRM only (port 3100)
pnpm dev:wms      # WMS only (port 3000)
```

## Provenance

- `apps/crm` imported from https://github.com/KitStak/KitStakCRM (full history preserved via git subtree)
- `apps/wms` imported from https://github.com/KitStak/KitStakWMS (full history preserved via git subtree)
