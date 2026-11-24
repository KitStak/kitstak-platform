# KitStak Guided Onboarding — cross-app contract

One onboarding system spans portal, CRM and WMS. Durable state lives in
`core.onboarding_progress` (see `packages/db/src/schema/core/onboarding.ts`); everything
else is **derived live from real data**. This document is the binding contract all three
implementations follow — when an app drifts from it, the app is wrong.

## Step semantics (identical in all three apps)

Per-step precedence: **done (live-detected or stored `completed`) > skipped > locked >
ready**. Live detection always beats a stale skip row.

- `done` — detected from real rows (boards, deals, members, warehouses, …). UI: muted
  title (NO strikethrough), green check chip, right-aligned label `Done · detected`
  (plain `Done` for non-auto steps).
- `skipped` — explicit org-level choice. UI: strikethrough title (strikethrough means
  *skipped*, never *done*), dashed chip, `Undo skip` ghost action.
- `locked` — a prerequisite is neither done NOR skipped (skipping a prerequisite
  **unlocks** its dependents; the destination screens carry their own empty states).
  UI: lock chip + `Unlocks after <prerequisite title>`.
- `ready` — actionable. One primary CTA on the current/next step, secondary-style CTA on
  the rest. `Skip` is a ghost action: hover/focus-revealed on fine pointers, always
  visible (reduced emphasis) on coarse pointers.

## Progress + celebration (identical in all three apps)

- `doneCount` counts **done only**. Headline: `X of N complete`; remaining-minutes from
  ready+locked steps where estimates exist.
- Ring/bar percent = settled (done+skipped) / total, but **celebration requires
  `doneCount === total`**. All-settled-with-skips shows a quiet "wrapped up — N steps
  skipped" row with undo affordances, never confetti. Celebrations do not lie.
- One progress treatment: circular progress ring, primary tone until 100%, then success.
- One celebration: PartyPopper icon + confetti burst (token colors, hidden under
  `prefers-reduced-motion`) + headline + **secondary** Dismiss button. No raw emoji in
  headings.

## Rollout guard (seen marker)

The guide writes an org-level `guide` row (`status: 'completed'`) the first time it
renders in an **incomplete** state (via `next/server after()` — never inline in render).
Visibility rule: `visible = !dismissed && (!allDone || seenRow)`. An install/org that was
already fully set up before this feature shipped never sees the guide or a surprise
celebration.

**Portal exception:** the Portal's guide lives only in Organization settings
(`/settings/organization#setup`), where it always shows, with no dismiss control and no
confetti. The Portal home page (the app launcher) carries no setup card, so the Portal no
longer writes or reads the seen and dismissed markers. The welcome wizard sends owners and
admins to that settings section when they finish. CRM and WMS keep the rule above.

## Canonical step names

Portal is the contract; CRM/WMS echo it exactly where steps correspond:

| key | title |
| --- | --- |
| profile | Tell us about your business |
| invite_team | Invite your team |
| crm_workspace | Create your CRM workspace |
| crm_first_deal | Add your first deal |
| wms_warehouse | Create your warehouse |
| wms_locations (wms only) | Add storage locations |
| wms_client (wms only) | Add your first client |
| wms_catalog | Build your product catalog |
| wms_first_order | Create your first order |
| projects_first_project | Start your first project |
| projects_assign_task | Give someone a task |
| projects_connect | Connect work to a deal or order |
| pulse_labor_rate | Set your labor cost per hour |
| pulse_first_job | Add your first job |
| pulse_first_entry | Log a day of work |
| pulse_connect | Link a job to a deal or work order |

The portal's WMS rows are a 3-step rollup of the WMS panel's 5. Projects and Pulse steps
appear only when the org is licensed for that module, and always after the CRM and WMS
steps. A skip of a `projects_*` or `pulse_*` step is stored under scope `portal` (the
`core.onboarding_progress.scope` CHECK is still `portal | crm | wms`).

| step | requires | Portal deep link (carries `?setup=<key>`) |
| --- | --- | --- |
| pulse_labor_rate | none | Pulse `/labor?tab=rates` |
| pulse_first_job | none | Pulse `/jobs/new` |
| pulse_first_entry | pulse_first_job | Pulse `/log` |
| pulse_connect | pulse_first_job | Pulse `/jobs` |

## Detection predicates (keep in lockstep)

- invite_team: active members (role not prefixed `deactivated:`) > 1, OR a pending
  invitation with `expires_at > now()`.
- crm_workspace: non-deleted, non-archived `crm.boards` row for the org.
- crm_first_deal: non-deleted top-level `crm.items` row on a non-deleted, non-archived
  `kind='deals'` board.
- wms_*: `EXISTS` on `wms.warehouses` / `locations` / `clients` / `products` /
  `shipment_orders`. **Single-tenant**: these describe the one WMS install. The portal
  shows WMS steps only for orgs that genuinely use that install: the platform org (slug
  from `WMS_PLATFORM_ORG_SLUG`, default `kitstak`) or an org with a REAL entitlement row
  (`isEntitled`). The dev allow-all switch alone never surfaces WMS install state into
  an unrelated org's guide.
- projects_first_project: a live `pm.projects` row that is not a template and not the
  sample project. projects_assign_task: a live task with an assignee. projects_connect: a
  `pm.integration_links` row. All three sit behind `to_regclass('pm.projects')`.
- pulse_labor_rate: a live `pulse.labor_rates` row, OR `pulse.settings.default_loaded_rate_cents > 0`.
- pulse_first_job: a live `pulse.jobs` row with `is_sample = false`.
- pulse_first_entry: a live `pulse.production_entries` row with `is_sample = false`.
- pulse_connect: a `pulse.job_links` row. Offered only when CRM or WMS is also in the
  plan, so a Pulse only org never sees a step it cannot finish.
- The four Pulse counts come from `getSetupSignals` in `@kitstak/pulse-bridge`, which is
  guarded by `to_regclass('pulse.jobs')`: an install without Pulse returns `null` quietly.
- Every portal signal read degrades to `null` → step renders `todo`; a failed read never
  breaks the page. WMS panel likewise degrades (hides) if its probe fails.

## Wizard answers are consumed, not stored-and-forgotten

- `focus` filters which app steps appear.
- `teamSize: 'solo'` removes `invite_team` from the plan (it reappears if a member or
  invite is ever detected).
- `businessType` orders the plan (3pl/distributor → WMS steps first when focus=both;
  brand → CRM first) and tunes step descriptions.
- `startMode: 'import'` swaps the catalog CTA to the WMS Imports hub; `'sample'` points
  the CRM workspace CTA at the template center (sample data on by default there).

## In-context arrival

Guide CTAs append `?setup=<step_key>` to deep links. The CRM and WMS shells read it and
show a one-line dismissible setup callout ("Setup step: <title> — <one sentence>") so the
user is never dropped on a screen with no bridge back to the guide.

## Writes

Org-level rows only (`user_id IS NULL`), upserted against the partial unique index
(`target: [orgId, scope, stepKey]`, `targetWhere: user_id IS NULL`). Writers must hold an
owner/admin (portal/CRM) or company-settings (WMS) permission; viewers get a read-only
guide with no skip/dismiss affordances.
