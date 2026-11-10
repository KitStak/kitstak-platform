# M11 organization-billing — shared-change requests

## REQ-1 — Inactive clients out of `/api/me` contextOptions
- **File:** `src/app/api/me/route.ts` (`contextOptions`)
- **Change:** add `.where(eq(clients.status, "Active"))` to the client list (or return `status` per client so `ClientSelect` in `src/components/shared/entity-pickers.tsx` can drop Inactive ones).
- **Reason:** BUILD_PLAN M11 §2 "Inactive client status flows into the order wizard's client select, where the client is excluded". Today `ClientSelect` only excludes inactive clients when it passes `warehouseId` (M11's `/api/clients?f.warehouseId=in:<id>` returns Active clients only); without a warehouse it lists every client from `/api/me`.
- **Status:** applied (F-patch 2026-11-06): `/api/me` `contextOptions.clients` only lists Active clients.

## REQ-2 — Register `retailer` (and billing entities) as platform entity types
- **File:** `src/server/repositories/platform-entities.ts`
- **Change:** add `def("retailer", { label: "Retailer", table: s.retailers, id: s.retailers.id, code: s.retailers.name, view: ["settings.retailers.view"], edit: ["settings.retailers.edit"] })`; optionally `billing_contract` (s.billingContracts, code name, warehouse/client columns, `settings.billing.*`), `billing_report` (s.billingReports, code billNumber), `vas_operation` (s.vasOperations).
- **Reason:** Retailer documents and logos should be `attachments` / owned `files` (so other users can download them, BUILD_PLAN M11 §4). Until this lands M11 keeps document file ids in `retailers.custom_fields._documents` and logos are readable only by the uploader. Custom fields section for `retailer` also needs the entity type.
- **Status:** applied (F-patch 2026-11-06): `retailer`, `billing_contract`, `billing_report` and `vas_operation` registered in `platform-entities.ts` (attachments, files, tags and change-log access go through their view / edit permissions). If custom-field definitions keep their own entity enum, that enum still needs `retailer` (file a request with the exact file).

## REQ-3 — Export grid key for bill detailed lines
- **File:** `src/server/exports/grid-keys.ts`
- **Change:** add `["billing-report-lines", "Billing Report Lines", "/api/billing-reports/{id}/lines", "settings.billing_report.view", "M11", "billing-lines"]` with support for a path parameter taken from the export query (`reportId`), or let the generic provider accept `listPath` templates.
- **Reason:** Billing report Details › Detailed tab must offer Export As Excel (BUILD_PLAN M11 §9). The grid uses gridKey `billing-report-lines`, which the export runner does not know yet.
- **Status:** applied (F-patch 2026-11-06): `billing-report-lines` registered with listPath `/api/billing-reports/{reportId}/lines`; the generic export provider fills `{name}` placeholders from the export query (`resolveListPath`, safe-segment validated) and removes the param. Export with `reportId=<id>` in the query.
