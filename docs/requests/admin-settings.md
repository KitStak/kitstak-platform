# M14 admin-settings — shared change requests

## REQ-1 Register the Screen Configuration grid export
- **File:** `src/server/exports/grid-keys.ts` (M14 block, after the `printouts` row)
- **Change:** add
  `["screen-configs", "Screen Configurations", "/api/screen-configs", "settings.screen_configuration.view", "M14", "screen-configs"],`
  No provider entry is needed (the generic provider exports what `GET /api/screen-configs` returns).
- **Reason:** `/settings/screen-configuration/receiving` uses `useGrid({ gridKey: "screen-configs" })`, so the grid footer shows "Export As Excel" (`ExportButton`). Without the registry row `POST /api/exports` rejects the unknown grid key.
- **Status:** applied (F-patch 2026-11-06): `screen-configs` row registered in `grid-keys.ts` (M14 block, after `printouts`). The export registry test requires one provider file per key, so a `null` stub `providers/screen-configs.ts` is wired in `providers.ts`; the generic provider exports what `GET /api/screen-configs` returns.

## REQ-2 Route registry entries for the new M14 sub-routes
- **File:** `src/config/route-registry.ts` (`EXTRA_ROUTES`)
- **Change:** add
  - `{ pattern: "/settings/printouts/[type]", label: "Printout List", owner: "M14", parent: "/settings/printouts", permission: "settings.printouts_labels.view" }`
  - `{ pattern: "/settings/printouts/[type]/new", label: "Create Printout", owner: "M14", parent: "/settings/printouts/[type]", permission: "settings.printouts_labels.create" }`
  - `{ pattern: "/settings/printouts/[type]/[id]", label: "Edit Printout", owner: "M14", parent: "/settings/printouts/[type]", permission: "settings.printouts_labels.edit" }`
  - `{ pattern: "/settings/screen-configuration/receiving", label: "Receiving Screen Configuration List", owner: "M14", parent: "/settings/screen-configuration", permission: "settings.screen_configuration.view" }`
  - `{ pattern: "/settings/screen-configuration/receiving/new", label: "Create Receiving Configuration", owner: "M14", parent: "/settings/screen-configuration/receiving", permission: "settings.screen_configuration.create" }`
  - `{ pattern: "/settings/screen-configuration/receiving/[id]", label: "Edit Receiving Configuration", owner: "M14", parent: "/settings/screen-configuration/receiving", permission: "settings.screen_configuration.edit" }`
- **Reason:** global search / route-coverage test / auto breadcrumbs. The pages already pass explicit breadcrumbs, so nothing is blocked meanwhile.
- **Status:** applied (F-patch 2026-11-06): the six `/settings/printouts/[type]…` and `/settings/screen-configuration/receiving…` entries added to `EXTRA_ROUTES` as listed, with the given permissions.
