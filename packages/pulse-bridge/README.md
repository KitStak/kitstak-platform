# @kitstak/pulse-bridge

How Portal, CRM, WMS and Projects read KitStak Pulse. One shared Postgres, no HTTP between
apps: each app calls these functions on its own server with its own Drizzle executor. Raw SQL
only, peer dependency `drizzle-orm` only, plain JSON results. Modelled on `@kitstak/pm-bridge`.

## Rules every function follows

- **Never throws on a read.** When the `pulse` schema is missing, a result is
  `{ available: false, reason: 'not_installed' }`. When the person has no Pulse role it is
  `{ available: false, reason: 'no_access' }`. The host shows nothing in both cases.
- **Answers for one person.** Every read takes `{ orgId, userId }` and resolves that person's
  Pulse role with `resolvePulseAccess` (an explicit Pulse role, else their warehouse role, else
  their workspace role). The same rule as Pulse itself: `apps/pulse` has a test that walks every
  input through both resolvers.
- **Hides money on the server.** Without the right to see money every `*Cents` and margin field
  is `null` and the result carries `moneyHidden: true`.
- **Works out nothing.** Job figures come from `pulse.job_stats` and period figures from
  `pulse.fact_days`, the rollups Pulse keeps for its own screens. A margin is profit over
  revenue in basis points, rounded half away from zero in SQL, the one rounding rule of Pulse.
- **Licensing is the caller's job.** Check the org's `pulse` entitlement before you call.

## Reads

| Function | Returns |
| --- | --- |
| `pulseAvailability(db)` | `{ installed, events }`, cached for a minute |
| `resolvePulseAccess(db, who)` | `{ role, seesMoney, seesWages, canLog, canManageJobs, source }` |
| `getOrgSummary(db, who, { from, to }?)` | open jobs, at risk, losing, revenue, cost, profit, margin (default: this month so far) |
| `getJobsForRecord(db, who, { type, id })` | the jobs tied to a CRM deal or account, a work order, a shipment order, a warehouse client, a shared customer or a project, worst health first, with totals |
| `getJobSummaries(db, who, { type, ids })` | the worst job of each record, for list columns, in one query |
| `getClientProfit(db, who, ref, options?)` | a client's profit for a date range (default 30 days), found by Pulse client id, `core.customers` id or CRM account item id, plus open jobs and an optional month trend |
| `listJobsNeedingAttention(db, who, { limit })` | active jobs that are losing money or at risk |
| `getAttentionCount(db, who)` | open alerts, for a badge |
| `getSetupSignals(db, orgId)` | counts for the Portal setup guide (no money, no person) |

## The one write

`emitBridgeEvent(db, { orgId }, { kind, targetId, payload })` leaves a note in
`pulse.bridge_events` (`wms_work_order_changed`, `crm_deal_stage_changed`, `pm_time_logged`).
Pulse answers it on its next page load or cron tick. It never throws, does nothing when Pulse is
not installed, runs in its own savepoint, and a burst for one record collapses into one row, so
it is safe inside a host write transaction.

## Links and words

- `pulseUrls(base)` (also `@kitstak/pulse-bridge/urls`, safe in client code): `job`, `log`,
  `newJobFromDeal`, `newJobFromWorkOrder`, `newJobFromProject`, `byLink`, `client`,
  `jobsAtRisk`, `connectedApps`. A DTO's `path` goes through `urls.path(path)`.
- `@kitstak/pulse-bridge/format`: `formatCents`, `formatMarginBp`, `formatQuantity`,
  `statusTone` (fixed `en-US` locale, so server and browser print the same text).
- `@kitstak/pulse-bridge/types`: the DTOs and `PULSE_STATUS_LABELS`, the five words every app
  uses for a job's health.

## Using it in an app

Add `"@kitstak/pulse-bridge": "workspace:*"` to the app's `package.json` and the package name
to `transpilePackages` in `next.config.ts`. Pass your Drizzle database or transaction as
`db as unknown as BridgeExecutor`. See `apps/crm/src/server/services/pulse-bridge.ts`,
`apps/wms/src/server/pulse/bridge.ts`, `apps/projects/src/server/integrations/pulse-profit.ts`
and `apps/portal/src/server/onboarding.ts`.

## Tests

`pnpm --filter @kitstak/pulse-bridge test`. `bridge.test.ts` is pure. `bridge.db.test.ts` runs
against the local database when it answers and is skipped otherwise: totals equal the sum of
their rows to the cent, money is hidden for a person who may not see it, a stranger gets
"no access", and an event collapses. It writes nothing that it does not roll back.
