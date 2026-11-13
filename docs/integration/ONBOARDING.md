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

The portal's WMS rows are a 3-step rollup of the WMS panel's 5.

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
